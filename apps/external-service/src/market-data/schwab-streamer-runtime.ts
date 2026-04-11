import fs from "node:fs";
import path from "node:path";
import { Pool, type PoolClient } from "pg";

import type { AppConfig } from "../config.js";
import type { AppLogger } from "../lib/logger.js";
import {
  SchwabStreamerSession,
  type SchwabStreamerPreferences,
  type SharedStreamerState,
  type WebSocketFactory,
} from "./streamer.js";
import { parseSharedStateNotification, readJsonFile } from "./universe-utils.js";
import type { MarketDataQuote } from "./types.js";

interface ProviderMetricsLike {
  lastSharedStateNotificationAt: string | null;
  fallbackUsage: Record<string, number>;
}

interface SchwabStreamerRuntimeConfig {
  config: AppConfig;
  logger: AppLogger;
  providerMetrics: ProviderMetricsLike;
  credentialsConfigured: () => boolean;
  accessTokenProvider: () => Promise<string>;
  preferencesProvider: () => Promise<SchwabStreamerPreferences>;
  websocketFactory?: WebSocketFactory;
}

export class SchwabStreamerRuntime {
  private readonly logger: AppLogger;
  private readonly config: AppConfig;
  private readonly providerMetrics: ProviderMetricsLike;
  private readonly credentialsConfigured: () => boolean;
  private readonly accessTokenProvider: () => Promise<string>;
  private readonly preferencesProvider: () => Promise<SchwabStreamerPreferences>;
  private readonly websocketFactory?: WebSocketFactory;
  private readonly streamerPgLockKey: number;
  private readonly configuredRole: "auto" | "leader" | "follower" | "disabled";
  private activeRole: "leader" | "follower" | "disabled";
  private readonly sharedStateBackend: "file" | "postgres";
  private readonly sharedStatePath: string;
  private readonly streamerEnabled: boolean;
  private streamer: SchwabStreamerSession | null = null;
  private pool: Pool | null = null;
  private dbReadyPromise: Promise<void> | null = null;
  private leaderLockClient: PoolClient | null = null;
  private sharedStateListenerClient: PoolClient | null = null;
  private sharedStateCache: SharedStreamerState | null = null;
  private sharedStateCacheMtimeMs: number | null = null;
  private runtimeReadyPromise: Promise<void> | null = null;

  constructor(config: SchwabStreamerRuntimeConfig) {
    this.logger = config.logger;
    this.config = config.config;
    this.providerMetrics = config.providerMetrics;
    this.credentialsConfigured = config.credentialsConfigured;
    this.accessTokenProvider = config.accessTokenProvider;
    this.preferencesProvider = config.preferencesProvider;
    this.websocketFactory = config.websocketFactory;
    this.streamerPgLockKey = this.config.SCHWAB_STREAMER_PG_LOCK_KEY;
    this.configuredRole = this.config.SCHWAB_STREAMER_ROLE;
    this.activeRole = this.configuredRole === "auto" ? "follower" : this.configuredRole;
    this.sharedStateBackend = this.config.SCHWAB_STREAMER_SHARED_STATE_BACKEND;
    this.sharedStatePath = this.config.SCHWAB_STREAMER_SHARED_STATE_PATH;
    this.streamerEnabled = !["0", "false", "no", "off"].includes(
      this.config.SCHWAB_STREAMER_ENABLED.trim().toLowerCase(),
    );
    if (this.streamerEnabled && this.activeRole === "leader" && this.credentialsConfigured()) {
      this.streamer = this.createStreamer();
    }
  }

  getConfiguredRole(): "auto" | "leader" | "follower" | "disabled" {
    return this.configuredRole;
  }

  getActiveRole(): "leader" | "follower" | "disabled" {
    return this.activeRole;
  }

  getStreamerPgLockKey(): number {
    return this.streamerPgLockKey;
  }

  getSharedStateBackend(): "file" | "postgres" {
    return this.sharedStateBackend;
  }

  getSharedStatePath(): string {
    return this.sharedStatePath;
  }

  isStreamerEnabled(): boolean {
    return this.streamerEnabled;
  }

  getStreamer(): SchwabStreamerSession | null {
    return this.streamer;
  }

  isLeaderLockHeld(): boolean {
    return Boolean(this.leaderLockClient);
  }

  async getSharedStateUpdatedAt(): Promise<string | null> {
    return (await this.readSharedState())?.updatedAt ?? null;
  }

  async startup(): Promise<void> {
    if (this.runtimeReadyPromise) {
      return this.runtimeReadyPromise;
    }
    this.runtimeReadyPromise = (async () => {
      if (this.sharedStateBackend === "postgres" || this.configuredRole === "auto") {
        await this.ensureDB();
      }
      if (this.sharedStateBackend === "postgres") {
        await this.setupSharedStateListener();
      }
      if (this.configuredRole === "auto") {
        const acquired = await this.tryAcquireLeadership();
        this.activeRole = acquired ? "leader" : "follower";
      }
      if (this.streamerEnabled && this.activeRole === "leader" && !this.streamer && this.credentialsConfigured()) {
        this.streamer = this.createStreamer();
      }
    })();
    try {
      await this.runtimeReadyPromise;
    } catch (error) {
      this.runtimeReadyPromise = null;
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    this.streamer?.close();
    this.streamer = null;
    if (this.sharedStateListenerClient) {
      try {
        await this.sharedStateListenerClient.query("UNLISTEN market_data_streamer_state_changed");
      } catch (error) {
        this.logger.error("Unable to unlisten market-data shared state channel", error);
      } finally {
        this.sharedStateListenerClient.release();
        this.sharedStateListenerClient = null;
      }
    }
    if (this.leaderLockClient) {
      try {
        await this.leaderLockClient.query("SELECT pg_advisory_unlock($1)", [this.streamerPgLockKey]);
      } catch (error) {
        this.logger.error("Unable to release Schwab streamer advisory lock", error);
      } finally {
        this.leaderLockClient.release();
        this.leaderLockClient = null;
      }
    }
    if (this.pool) {
      await this.pool.end().catch((error) => {
        this.logger.error("Unable to close market-data pool", error);
      });
      this.pool = null;
      this.dbReadyPromise = null;
    }
  }

  async enforceFailurePolicy(): Promise<void> {
    if (!this.streamer) {
      return;
    }
    const health = this.streamer.getHealth();
    if (!health) {
      return;
    }
    if (health.failurePolicy !== "max_connections_exceeded" || this.activeRole !== "leader") {
      return;
    }
    this.logger.error("Demoting Schwab streamer leader after CLOSE_CONNECTION / max connection policy");
    this.streamer.close();
    this.streamer = null;
    if (this.leaderLockClient) {
      try {
        await this.leaderLockClient.query("SELECT pg_advisory_unlock($1)", [this.streamerPgLockKey]);
      } catch (error) {
        this.logger.error("Unable to release Schwab streamer advisory lock during demotion", error);
      } finally {
        this.leaderLockClient.release();
        this.leaderLockClient = null;
      }
    }
    this.activeRole = "follower";
  }

  async readSharedState(): Promise<SharedStreamerState | null> {
    if (this.sharedStateBackend === "file" && this.sharedStateCache) {
      try {
        const fileMtimeMs = fs.statSync(this.sharedStatePath).mtimeMs;
        if (this.sharedStateCacheMtimeMs != null && fileMtimeMs <= this.sharedStateCacheMtimeMs) {
          return this.sharedStateCache;
        }
      } catch {
        return this.sharedStateCache;
      }
    } else if (this.sharedStateCache) {
      return this.sharedStateCache;
    }
    if (this.sharedStateBackend === "postgres") {
      if (!this.pool) {
        return null;
      }
      try {
        const result = await this.pool.query<{ payload: SharedStreamerState }>(
          "SELECT payload FROM market_data_streamer_state WHERE stream_name = $1",
          ["schwab_market_data"],
        );
        this.sharedStateCache = result.rows[0]?.payload ?? null;
        return this.sharedStateCache;
      } catch (error) {
        this.logger.error("Unable to read shared Schwab streamer state from Postgres", error);
        return null;
      }
    }
    this.sharedStateCache = readJsonFile<SharedStreamerState>(this.sharedStatePath);
    try {
      this.sharedStateCacheMtimeMs = fs.statSync(this.sharedStatePath).mtimeMs;
    } catch {
      this.sharedStateCacheMtimeMs = null;
    }
    return this.sharedStateCache;
  }

  async readSharedQuote(symbol: string): Promise<MarketDataQuote | null> {
    if (this.activeRole !== "follower") {
      return null;
    }
    const snapshot = await this.readSharedQuoteSnapshot(symbol);
    if (!snapshot) {
      return null;
    }
    if (snapshot.stalenessSeconds > Math.round(this.config.SCHWAB_STREAMER_QUOTE_TTL_MS / 1000)) {
      return null;
    }
    this.recordSharedStateFallbackSuccess();
    return snapshot.quote;
  }

  async readSharedFuturesQuote(symbol: string): Promise<MarketDataQuote | null> {
    if (this.activeRole !== "follower") {
      return null;
    }
    const snapshot = await this.readSharedFuturesQuoteSnapshot(symbol);
    if (!snapshot) {
      return null;
    }
    if (snapshot.stalenessSeconds > Math.round(this.config.SCHWAB_STREAMER_QUOTE_TTL_MS / 1000)) {
      return null;
    }
    this.recordSharedStateFallbackSuccess();
    return snapshot.quote;
  }

  async readAfterHoursSharedQuote(symbol: string): Promise<{ quote: MarketDataQuote; stalenessSeconds: number } | null> {
    const snapshot = await this.readSharedQuoteSnapshot(symbol);
    return this.filterAfterHoursSnapshot(snapshot);
  }

  async readAfterHoursSharedFuturesQuote(
    symbol: string,
  ): Promise<{ quote: MarketDataQuote; stalenessSeconds: number } | null> {
    const snapshot = await this.readSharedFuturesQuoteSnapshot(symbol);
    return this.filterAfterHoursSnapshot(snapshot);
  }

  async readSharedChart(symbol: string): Promise<Record<string, unknown> | null> {
    if (this.activeRole !== "follower") {
      return null;
    }
    const state = await this.readSharedState();
    const chart = state?.charts?.[symbol];
    if (!chart?.receivedAt || !chart.point) {
      return null;
    }
    const ageSeconds = this.secondsSince(chart.receivedAt);
    if (ageSeconds == null || ageSeconds > Math.round(this.config.SCHWAB_STREAMER_QUOTE_TTL_MS / 1000)) {
      return null;
    }
    this.recordSharedStateFallbackSuccess();
    return chart.point as unknown as Record<string, unknown>;
  }

  private createStreamer(): SchwabStreamerSession {
    return new SchwabStreamerSession({
      logger: this.logger,
      websocketFactory: this.websocketFactory,
      accessTokenProvider: this.accessTokenProvider,
      preferencesProvider: this.preferencesProvider,
      connectTimeoutMs: this.config.SCHWAB_STREAMER_CONNECT_TIMEOUT_MS,
      freshnessTtlMs: this.config.SCHWAB_STREAMER_QUOTE_TTL_MS,
      subscriptionSoftCap: this.config.SCHWAB_STREAMER_SYMBOL_SOFT_CAP,
      cacheSoftCap: this.config.SCHWAB_STREAMER_CACHE_SOFT_CAP,
      subscriptionFields: this.config.SCHWAB_STREAMER_EQUITY_FIELDS,
      accountActivityEnabled: !["0", "false", "no", "off"].includes(
        this.config.SCHWAB_STREAMER_ACCOUNT_ACTIVITY_ENABLED.trim().toLowerCase(),
      ),
      reconnectJitterMs: this.config.SCHWAB_STREAMER_RECONNECT_JITTER_MS,
      stateSink: (state) => {
        void this.writeSharedState(state);
      },
    });
  }

  private async ensureDB(): Promise<void> {
    if (this.dbReadyPromise) {
      return this.dbReadyPromise;
    }
    this.dbReadyPromise = (async () => {
      const pool = new Pool({
        connectionString: process.env.CORTANA_DATABASE_URL ?? this.config.CORTANA_DATABASE_URL,
        max: 5,
        idleTimeoutMillis: 30 * 60 * 1000,
      });
      const client = await pool.connect();
      try {
        await client.query("SELECT 1");
        await client.query(`
          CREATE TABLE IF NOT EXISTS market_data_streamer_state (
            stream_name text PRIMARY KEY,
            payload jsonb NOT NULL,
            updated_at timestamptz NOT NULL DEFAULT now()
          )
        `);
      } finally {
        client.release();
      }
      this.pool = pool;
    })();
    return this.dbReadyPromise;
  }

  private async tryAcquireLeadership(): Promise<boolean> {
    if (!this.pool) {
      return false;
    }
    if (this.leaderLockClient) {
      return true;
    }
    const client = await this.pool.connect();
    try {
      const result = await client.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock($1) AS acquired", [
        this.streamerPgLockKey,
      ]);
      if (result.rows[0]?.acquired) {
        this.leaderLockClient = client;
        return true;
      }
      client.release();
      return false;
    } catch (error) {
      client.release();
      throw error;
    }
  }

  private async setupSharedStateListener(): Promise<void> {
    if (!this.pool || this.sharedStateListenerClient) {
      return;
    }
    const client = await this.pool.connect();
    client.on("notification", (message) => {
      this.providerMetrics.lastSharedStateNotificationAt = new Date().toISOString();
      const payload = parseSharedStateNotification(message.payload);
      if (
        payload?.updatedAt &&
        this.sharedStateCache?.updatedAt &&
        this.sharedStateCache.updatedAt >= payload.updatedAt
      ) {
        return;
      }
      void this.refreshSharedStateCacheFromBackend();
    });
    await client.query("LISTEN market_data_streamer_state_changed");
    this.sharedStateListenerClient = client;
    await this.refreshSharedStateCacheFromBackend();
  }

  private async writeSharedState(state: SharedStreamerState): Promise<void> {
    if (this.sharedStateBackend === "postgres") {
      if (!this.pool) {
        return;
      }
      try {
        await this.pool.query(
          `
            INSERT INTO market_data_streamer_state (stream_name, payload, updated_at)
            VALUES ($1, $2::jsonb, now())
            ON CONFLICT (stream_name)
            DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()
          `,
          ["schwab_market_data", JSON.stringify(state)],
        );
        await this.pool.query("SELECT pg_notify('market_data_streamer_state_changed', $1)", [
          JSON.stringify({
            updatedAt: state.updatedAt,
            quoteCount: Object.keys(state.quotes).length,
            chartCount: Object.keys(state.charts).length,
          }),
        ]);
      } catch (error) {
        this.logger.error("Unable to persist shared Schwab streamer state to Postgres", error);
      }
      this.sharedStateCache = state;
      this.sharedStateCacheMtimeMs = null;
      return;
    }
    try {
      fs.mkdirSync(path.dirname(this.sharedStatePath), { recursive: true });
      fs.writeFileSync(this.sharedStatePath, JSON.stringify(state, null, 2));
      this.sharedStateCache = state;
      this.sharedStateCacheMtimeMs = fs.statSync(this.sharedStatePath).mtimeMs;
    } catch (error) {
      this.logger.error("Unable to persist shared Schwab streamer state", error);
    }
  }

  private async refreshSharedStateCacheFromBackend(): Promise<void> {
    if (this.sharedStateBackend !== "postgres" || !this.pool) {
      return;
    }
    try {
      const result = await this.pool.query<{ payload: SharedStreamerState }>(
        "SELECT payload FROM market_data_streamer_state WHERE stream_name = $1",
        ["schwab_market_data"],
      );
      this.sharedStateCache = result.rows[0]?.payload ?? null;
      this.sharedStateCacheMtimeMs = null;
    } catch (error) {
      this.logger.error("Unable to refresh shared Schwab streamer state cache", error);
    }
  }

  private recordSharedStateFallbackSuccess(): void {
    this.providerMetrics.fallbackUsage.shared_state = (this.providerMetrics.fallbackUsage.shared_state ?? 0) + 1;
  }

  private async readSharedQuoteSnapshot(
    symbol: string,
  ): Promise<{ quote: MarketDataQuote; stalenessSeconds: number } | null> {
    const state = await this.readSharedState();
    const quote = state?.quotes?.[symbol];
    if (!quote?.receivedAt || !quote.quote) {
      return null;
    }
    const stalenessSeconds = this.secondsSince(quote.receivedAt);
    if (stalenessSeconds == null) {
      return null;
    }
    return {
      quote: quote.quote,
      stalenessSeconds,
    };
  }

  private async readSharedFuturesQuoteSnapshot(
    symbol: string,
  ): Promise<{ quote: MarketDataQuote; stalenessSeconds: number } | null> {
    const state = await this.readSharedState();
    const quote = state?.futuresQuotes?.[symbol];
    if (!quote?.receivedAt || !quote.quote) {
      return null;
    }
    const stalenessSeconds = this.secondsSince(quote.receivedAt);
    if (stalenessSeconds == null) {
      return null;
    }
    return {
      quote: quote.quote,
      stalenessSeconds,
    };
  }

  private filterAfterHoursSnapshot(
    snapshot: { quote: MarketDataQuote; stalenessSeconds: number } | null,
  ): { quote: MarketDataQuote; stalenessSeconds: number } | null {
    if (!snapshot) {
      return null;
    }
    if (this.isRegularHoursSession()) {
      return null;
    }
    const freshTtlSeconds = Math.round(this.config.SCHWAB_STREAMER_QUOTE_TTL_MS / 1000);
    const afterHoursTtlSeconds = Math.round(this.config.SCHWAB_STREAMER_AFTER_HOURS_QUOTE_TTL_MS / 1000);
    if (afterHoursTtlSeconds <= freshTtlSeconds) {
      return null;
    }
    if (snapshot.stalenessSeconds <= freshTtlSeconds || snapshot.stalenessSeconds > afterHoursTtlSeconds) {
      return null;
    }
    this.recordSharedStateFallbackSuccess();
    return snapshot;
  }

  private isRegularHoursSession(reference = new Date()): boolean {
    const parts = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      hour: "numeric",
      hour12: false,
      timeZone: "America/New_York",
    }).formatToParts(reference);
    const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? NaN);
    const isWeekday = !["Sat", "Sun"].includes(weekday);
    return isWeekday && Number.isFinite(hour) && hour >= 9 && hour < 16;
  }

  private secondsSince(value: string | null | undefined): number | null {
    if (!value) {
      return null;
    }
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) {
      return null;
    }
    return Math.max(Math.round((Date.now() - parsed) / 1000), 0);
  }
}
