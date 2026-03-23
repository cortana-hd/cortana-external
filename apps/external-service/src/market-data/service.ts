import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";

import type { AppConfig } from "../config.js";
import { HttpError, readJsonResponse } from "../lib/http.js";
import type { AppLogger } from "../lib/logger.js";
import { createLogger } from "../lib/logger.js";
import {
  compareHistoryRows,
  compareQuotes,
  mapAlpacaTimeframe,
  mapSchwabPeriod,
  normalizeHistoryInterval,
  normalizeHistoryProvider,
  type HistoryInterval,
  type HistoryProvider,
} from "./history-utils.js";
import {
  buildUnavailableCompare,
  marketDataErrorResponse,
  normalizeAlpacaBarLimit,
  normalizeAlpacaDataUrl,
  normalizeMarketSymbol,
  parseBatchSymbols,
  resolveQuery,
} from "./route-utils.js";
import { normalizeSchwabQuoteEnvelope, type SchwabQuoteEnvelope } from "./schwab-normalizers.js";
import { buildRiskPayload, type RiskPayloadResult } from "./risk-stack.js";
import {
  extractCoinMarketCapSymbol,
  mapCoinMarketCapInterval,
  normalizeCoinMarketCapFundamentals,
  normalizeCoinMarketCapHistory,
  normalizeCoinMarketCapMetadata,
  normalizeCoinMarketCapQuote,
  pickCoinMarketCapInfoEntry,
  resolveCoinMarketCapTimeRange,
} from "./coinmarketcap-client.js";
import {
  SchwabStreamerSession,
  type SchwabStreamerPreferences,
  type SharedStreamerState,
  type WebSocketFactory,
} from "./streamer.js";
import { UniverseArtifactManager, type UniverseAuditEntry } from "./universe-manager.js";
import type {
  MarketDataComparison,
  MarketDataGenericPayload,
  MarketDataHistory,
  MarketDataHistoryPoint,
  MarketDataQuote,
  MarketDataResponse,
  MarketDataRiskHistory,
  MarketDataRiskHistoryPoint,
  MarketDataRiskSnapshot,
  MarketDataRouteResult,
  MarketDataSnapshot,
  MarketDataStatus,
  MarketDataUniverse,
} from "./types.js";
import {
  dedupe,
  parseSharedStateNotification,
  parseUniverseSourceLadder,
  readJsonFile,
} from "./universe-utils.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const DEFAULT_INTERVAL = "1d";
type FetchImpl = typeof fetch;

interface MarketDataServiceConfig {
  config?: AppConfig;
  logger?: AppLogger;
  fetchImpl?: FetchImpl;
  websocketFactory?: WebSocketFactory;
}

interface ServiceMetadata {
  source: string;
  status: MarketDataStatus;
  degradedReason?: string | null;
  stalenessSeconds: number | null;
}

interface HistoryFetchResult extends ServiceMetadata {
  rows: MarketDataHistoryPoint[];
}

interface QuoteFetchResult extends ServiceMetadata {
  quote: MarketDataQuote;
}

interface SnapshotFetchResult extends ServiceMetadata {
  snapshot: MarketDataSnapshot;
}

interface JsonRecord {
  [key: string]: unknown;
}

interface CachedTokenPayload {
  accessToken?: string;
  expiresAt?: number;
  refreshToken?: string;
  refreshTokenIssuedAt?: string | null;
  lastAuthorizationCodeAt?: string | null;
}

interface PendingSchwabAuthState {
  value: string;
  createdAt: number;
}

interface AlpacaKeys {
  key_id: string;
  secret_key: string;
  data_url: string;
}

interface ProviderMetrics {
  lastSuccessfulSchwabRestAt: string | null;
  lastSuccessfulUniverseRefreshAt: string | null;
  lastSharedStateNotificationAt: string | null;
  tokenRefreshInFlight: boolean;
  lastTokenRefreshAt: string | null;
  lastTokenRefreshFailureAt: string | null;
  schwabTokenStatus: "ready" | "human_action_required";
  schwabTokenReason: string | null;
  lastSchwabFailureAt: string | null;
  schwabConsecutiveFailures: number;
  schwabCooldownUntil: string | null;
  sourceUsage: Record<string, number>;
  fallbackUsage: Record<string, number>;
}

interface CryptoDailyCacheEntry {
  symbol: string;
  refreshedAt: string;
  quote: MarketDataQuote;
  fundamentals: Record<string, unknown>;
  metadata: Record<string, unknown>;
  rows: MarketDataHistoryPoint[];
}

interface CryptoDailyCacheFile {
  updatedAt: string;
  symbols: Record<string, CryptoDailyCacheEntry>;
}

export class MarketDataService {
  private readonly logger: AppLogger;
  private readonly fetchImpl: FetchImpl;
  private readonly config: AppConfig;
  private readonly requestTimeoutMs: number;
  private readonly cacheDir: string;
  private readonly schwabFailureThreshold: number;
  private readonly schwabCooldownMs: number;
  private readonly universeSeedPath: string;
  private readonly universeSourceLadder: string[];
  private readonly universeRemoteJsonUrl: string;
  private readonly universeLocalJsonPath: string | null;
  private readonly schwabTokenPath: string;
  private readonly configuredStreamerRole: "auto" | "leader" | "follower" | "disabled";
  private activeStreamerRole: "leader" | "follower" | "disabled";
  private readonly streamerPgLockKey: number;
  private readonly streamerSharedStateBackend: "file" | "postgres";
  private readonly streamerSharedStatePath: string;
  private readonly streamerEnabled: boolean;
  private readonly universeManager: UniverseArtifactManager;
  private streamer: SchwabStreamerSession | null = null;
  private readonly providerMetrics: ProviderMetrics = {
    lastSuccessfulSchwabRestAt: null,
    lastSuccessfulUniverseRefreshAt: null,
    lastSharedStateNotificationAt: null,
    tokenRefreshInFlight: false,
    lastTokenRefreshAt: null,
    lastTokenRefreshFailureAt: null,
    schwabTokenStatus: "ready",
    schwabTokenReason: null,
    lastSchwabFailureAt: null,
    schwabConsecutiveFailures: 0,
    schwabCooldownUntil: null,
    sourceUsage: {},
    fallbackUsage: {},
  };
  private schwabCooldownUntilMs = 0;
  private tokenRefreshPromise: Promise<string> | null = null;
  private pool: Pool | null = null;
  private dbReadyPromise: Promise<void> | null = null;
  private leaderLockClient: PoolClient | null = null;
  private sharedStateListenerClient: PoolClient | null = null;
  private sharedStateCache: SharedStreamerState | null = null;
  private sharedStateCacheMtimeMs: number | null = null;
  private runtimeReadyPromise: Promise<void> | null = null;
  private pendingSchwabAuthState: PendingSchwabAuthState | null = null;

  constructor(config: MarketDataServiceConfig = {}) {
    this.logger = config.logger ?? createLogger("market-data");
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.config = config.config ?? ({
      PORT: 3033,
      MARKET_DATA_CACHE_DIR: ".cache/market_data",
      MARKET_DATA_REQUEST_TIMEOUT_MS: 30_000,
      MARKET_DATA_UNIVERSE_SEED_PATH: "backtester/data/universe.py",
      MARKET_DATA_UNIVERSE_SOURCE_LADDER: "python_seed",
      MARKET_DATA_UNIVERSE_REMOTE_JSON_URL: "",
      MARKET_DATA_UNIVERSE_LOCAL_JSON_PATH: "",
      MARKET_DATA_SCHWAB_FAILURE_THRESHOLD: 3,
      MARKET_DATA_SCHWAB_COOLDOWN_MS: 20_000,
      COINMARKETCAP_API_KEY: "",
      COINMARKETCAP_API_BASE_URL: "https://pro-api.coinmarketcap.com",
      SCHWAB_CLIENT_ID: "",
      SCHWAB_CLIENT_SECRET: "",
      SCHWAB_REFRESH_TOKEN: "",
      SCHWAB_AUTH_URL: "https://api.schwabapi.com/v1/oauth/authorize",
      SCHWAB_REDIRECT_URL: "https://127.0.0.1:8182/auth/schwab/callback",
      SCHWAB_TOKEN_PATH: ".cache/market_data/schwab-token.json",
      SCHWAB_API_BASE_URL: "https://api.schwabapi.com",
      SCHWAB_TOKEN_URL: "https://api.schwabapi.com/v1/oauth/token",
      SCHWAB_USER_PREFERENCES_URL: "",
      SCHWAB_STREAMER_ENABLED: "1",
      SCHWAB_STREAMER_ROLE: "leader",
      SCHWAB_STREAMER_PG_LOCK_KEY: 814021,
      SCHWAB_STREAMER_SHARED_STATE_BACKEND: "postgres",
      SCHWAB_STREAMER_SHARED_STATE_PATH: ".cache/market_data/schwab-streamer-state.json",
      SCHWAB_STREAMER_CONNECT_TIMEOUT_MS: 5_000,
      SCHWAB_STREAMER_QUOTE_TTL_MS: 15_000,
      SCHWAB_STREAMER_SYMBOL_SOFT_CAP: 250,
      SCHWAB_STREAMER_CACHE_SOFT_CAP: 500,
      SCHWAB_STREAMER_EQUITY_FIELDS: "0,1,2,3,8,19,20,32,34,42",
      SCHWAB_STREAMER_ACCOUNT_ACTIVITY_ENABLED: "1",
      SCHWAB_STREAMER_RECONNECT_JITTER_MS: 500,
      FRED_API_KEY: "",
      WHOOP_CLIENT_ID: "",
      WHOOP_CLIENT_SECRET: "",
      WHOOP_REDIRECT_URL: "http://localhost:3033/auth/callback",
      WHOOP_TOKEN_PATH: "whoop_tokens.json",
      WHOOP_DATA_PATH: "whoop_data.json",
      TONAL_EMAIL: "",
      TONAL_PASSWORD: "",
      TONAL_TOKEN_PATH: "tonal_tokens.json",
      TONAL_DATA_PATH: "tonal_data.json",
      ALPACA_KEYS_PATH: "",
      ALPACA_TARGET_ENVIRONMENT: "live",
      CORTANA_DATABASE_URL: "postgres://localhost:5432/cortana?sslmode=disable",
      EXTERNAL_SERVICE_TLS_PORT: 8182,
      EXTERNAL_SERVICE_TLS_CERT_PATH: "",
      EXTERNAL_SERVICE_TLS_KEY_PATH: "",
    } satisfies AppConfig);
    this.requestTimeoutMs = this.config.MARKET_DATA_REQUEST_TIMEOUT_MS;
    this.cacheDir = resolveRepoPath(this.config.MARKET_DATA_CACHE_DIR);
    this.schwabFailureThreshold = this.config.MARKET_DATA_SCHWAB_FAILURE_THRESHOLD;
    this.schwabCooldownMs = this.config.MARKET_DATA_SCHWAB_COOLDOWN_MS;
    this.universeSeedPath = resolveRepoPath(this.config.MARKET_DATA_UNIVERSE_SEED_PATH);
    this.universeSourceLadder = parseUniverseSourceLadder(this.config.MARKET_DATA_UNIVERSE_SOURCE_LADDER);
    this.universeRemoteJsonUrl = this.config.MARKET_DATA_UNIVERSE_REMOTE_JSON_URL.trim();
    this.universeLocalJsonPath = resolveOptionalRepoPath(this.config.MARKET_DATA_UNIVERSE_LOCAL_JSON_PATH);
    this.schwabTokenPath = resolveRepoPath(this.config.SCHWAB_TOKEN_PATH);
    this.configuredStreamerRole = this.config.SCHWAB_STREAMER_ROLE;
    this.activeStreamerRole = this.configuredStreamerRole === "auto" ? "follower" : this.configuredStreamerRole;
    this.streamerPgLockKey = this.config.SCHWAB_STREAMER_PG_LOCK_KEY;
    this.streamerSharedStateBackend = this.config.SCHWAB_STREAMER_SHARED_STATE_BACKEND;
    this.streamerSharedStatePath = resolveRepoPath(this.config.SCHWAB_STREAMER_SHARED_STATE_PATH);
    this.streamerEnabled = !["0", "false", "no", "off"].includes(
      this.config.SCHWAB_STREAMER_ENABLED.trim().toLowerCase(),
    );
    this.universeManager = new UniverseArtifactManager({
      cacheDir: this.cacheDir,
      sourceLadder: this.universeSourceLadder,
      remoteJsonUrl: this.universeRemoteJsonUrl,
      localJsonPath: this.universeLocalJsonPath,
      seedPath: this.universeSeedPath,
      logger: this.logger,
      fetchJson: this.fetchJson.bind(this),
    });
    if (this.streamerEnabled && this.activeStreamerRole === "leader" && this.isSchwabConfigured()) {
      this.streamer = this.createStreamer(config.websocketFactory);
    }
  }

  async checkHealth(): Promise<Record<string, unknown>> {
    await this.ensureRuntimeReady();
    await this.enforceStreamerFailurePolicy();
    const sharedState = await this.readSharedStreamerState();
    const streamerHealth = this.streamer?.getHealth() ?? sharedState?.health ?? null;
    return {
      status: "healthy",
      providers: {
        coinmarketcap: this.isCoinMarketCapConfigured() ? "configured" : "disabled",
        schwab: this.isSchwabConfigured() ? "configured" : "disabled",
        schwabStreamer: this.streamer ? "enabled" : "disabled",
        schwabStreamerMeta: streamerHealth,
        schwabStreamerRole: this.activeStreamerRole,
        schwabStreamerRoleConfigured: this.configuredStreamerRole,
        schwabStreamerPgLockKey: this.streamerPgLockKey,
        schwabStreamerSharedStateBackend: this.streamerSharedStateBackend,
        schwabStreamerSharedStatePath: this.streamerSharedStatePath,
        schwabStreamerSharedStateUpdatedAt: sharedState?.updatedAt ?? null,
        schwabTokenStatus: this.providerMetrics.schwabTokenStatus,
        schwabTokenReason: this.providerMetrics.schwabTokenReason,
        fred: this.config.FRED_API_KEY ? "configured" : "unauthenticated",
        universeSeedPath: this.universeSeedPath,
        universeSourceLadder: this.universeSourceLadder,
        universeRemoteJsonUrl: this.universeRemoteJsonUrl || null,
        universeLocalJsonPath: this.universeLocalJsonPath,
        providerMetrics: this.providerMetrics,
      },
    };
  }

  async startup(): Promise<void> {
    await this.ensureRuntimeReady();
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

  async handleSchwabAuthUrl(): Promise<MarketDataRouteResult<Record<string, unknown>>> {
    const clientId = this.config.SCHWAB_CLIENT_ID.trim();
    const clientSecret = this.config.SCHWAB_CLIENT_SECRET.trim();
    if (!clientId || !clientSecret) {
      return {
        status: 503,
        body: marketDataErrorResponse("schwab oauth is not configured", "degraded", {
          reason: "SCHWAB_CLIENT_ID and SCHWAB_CLIENT_SECRET are required",
        }),
      };
    }

    const state = crypto.randomUUID();
    this.pendingSchwabAuthState = {
      value: state,
      createdAt: Date.now(),
    };

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: this.config.SCHWAB_REDIRECT_URL,
      response_type: "code",
      state,
    });

    return {
      status: 200,
      body: {
        source: "service",
        status: "ok",
        degradedReason: null,
        stalenessSeconds: 0,
        data: {
          url: `${this.config.SCHWAB_AUTH_URL}?${params.toString()}`,
          state,
          callbackUrl: this.config.SCHWAB_REDIRECT_URL,
          tokenPath: this.schwabTokenPath,
        },
      },
    };
  }

  async handleSchwabAuthCallback(request: Request): Promise<MarketDataRouteResult<Record<string, unknown>>> {
    const url = new URL(request.url);
    const error = url.searchParams.get("error");
    if (error) {
      return {
        status: 400,
        body: marketDataErrorResponse("schwab oauth error", "error", {
          reason: `${error}${url.searchParams.get("error_description") ? `: ${url.searchParams.get("error_description")}` : ""}`,
        }),
      };
    }

    const code = (url.searchParams.get("code") ?? "").trim();
    if (!code) {
      return {
        status: 400,
        body: marketDataErrorResponse("schwab oauth callback missing code", "error", {
          reason: "code query parameter is required",
        }),
      };
    }

    const state = (url.searchParams.get("state") ?? "").trim();
    if (!this.isValidSchwabAuthState(state)) {
      return {
        status: 400,
        body: marketDataErrorResponse("schwab oauth state mismatch", "error", {
          reason: "Start again from /auth/schwab/url and complete the browser flow without restarting the service.",
        }),
      };
    }

    try {
      const token = await this.exchangeSchwabAuthorizationCode(code);
      this.pendingSchwabAuthState = null;
      return {
        status: 200,
        body: {
          source: "service",
          status: "ok",
          degradedReason: null,
          stalenessSeconds: 0,
          data: {
            message: "Schwab tokens saved successfully.",
            tokenPath: this.schwabTokenPath,
            hasRefreshToken: Boolean(token.refreshToken),
            expiresAt: token.expiresAt ? new Date(token.expiresAt).toISOString() : null,
            callbackUrl: this.config.SCHWAB_REDIRECT_URL,
          },
        },
      };
    } catch (error) {
      return {
        status: 502,
        body: marketDataErrorResponse("schwab token exchange failed", "degraded", {
          reason: summarizeError(error),
        }),
      };
    }
  }

  async handleSchwabAuthStatus(): Promise<MarketDataRouteResult<Record<string, unknown>>> {
    const cached = this.readCachedSchwabToken();
    const refreshToken = this.getSchwabRefreshToken(cached);
    return {
      status: 200,
      body: {
        source: "service",
        status: "ok",
        degradedReason: null,
        stalenessSeconds: 0,
        data: {
          clientConfigured: this.hasSchwabClientCredentials(),
          refreshTokenPresent: Boolean(refreshToken),
          tlsConfigured: Boolean(
            this.config.EXTERNAL_SERVICE_TLS_CERT_PATH.trim() && this.config.EXTERNAL_SERVICE_TLS_KEY_PATH.trim(),
          ),
          tokenPath: this.schwabTokenPath,
          redirectUrl: this.config.SCHWAB_REDIRECT_URL,
          authUrl: this.config.SCHWAB_AUTH_URL,
          accessTokenExpiresAt:
            cached?.expiresAt && cached.expiresAt > 0 ? new Date(cached.expiresAt).toISOString() : null,
          refreshTokenIssuedAt: cached?.refreshTokenIssuedAt ?? null,
          lastAuthorizationCodeAt: cached?.lastAuthorizationCodeAt ?? null,
          pendingStateIssuedAt:
            this.pendingSchwabAuthState != null ? new Date(this.pendingSchwabAuthState.createdAt).toISOString() : null,
        },
      },
    };
  }

  async handleHistory(request: Request, rawSymbol: string, compareWith?: string): Promise<MarketDataRouteResult<MarketDataHistory>> {
    await this.ensureRuntimeReady();
    const symbol = normalizeMarketSymbol(rawSymbol);
    if (!symbol) {
      return { status: 400, body: marketDataErrorResponse("invalid symbol", "error", { reason: "symbol required" }) };
    }

    const period = resolveQuery(request.url, "period", "1y");
    const rawInterval = resolveQuery(request.url, "interval", DEFAULT_INTERVAL);
    const interval = normalizeHistoryInterval(rawInterval);
    if (!interval) {
      return {
        status: 400,
        body: marketDataErrorResponse("invalid interval", "error", {
          reason: `unsupported interval '${rawInterval}'; supported intervals are 1d, 1wk, and 1mo`,
        }),
      };
    }
    const rawProvider = resolveQuery(request.url, "provider", "service");
    if (rawProvider.trim().toLowerCase() === "yahoo") {
      return {
        status: 400,
        body: marketDataErrorResponse("invalid provider", "error", {
          reason: "unsupported provider 'yahoo'; supported providers are service, schwab, and alpaca",
        }),
      };
    }
    const provider = normalizeHistoryProvider(rawProvider);
    if (!provider) {
        return {
          status: 400,
          body: marketDataErrorResponse("invalid provider", "error", {
            reason: `unsupported provider '${rawProvider}'; supported providers are service, schwab, and alpaca`,
          }),
        };
      }
    try {
      const primary = await this.fetchPrimaryHistory(symbol, period, interval, provider);
      this.recordSourceUsage(primary.source);
      const compareProvider = resolveCompareProvider(compareWith);
      if (compareProvider === null) {
        return {
          status: 400,
          body: marketDataErrorResponse("invalid compare provider", "error", {
            reason: "unsupported compare_with provider; supported providers are schwab and alpaca",
          }),
        };
      }
      const compare = await this.buildHistoryComparison(symbol, period, interval, compareProvider ?? undefined, primary.rows);
      return {
        status: 200,
        body: {
          source: primary.source,
          status: primary.status,
          degradedReason: primary.degradedReason ?? null,
          stalenessSeconds: primary.stalenessSeconds,
          data: { symbol, period, interval, rows: primary.rows, comparisonHint: compare?.source },
          ...(compare ? { compare_with: compare } : {}),
        },
      };
    } catch (error) {
      return this.toErrorRoute<MarketDataHistory>(error, {
        symbol,
        period,
        interval,
        rows: [],
      });
    }
  }

  async handleQuote(_request: Request, rawSymbol: string, compareWith?: string): Promise<MarketDataRouteResult<MarketDataQuote>> {
    await this.ensureRuntimeReady();
    const symbol = normalizeMarketSymbol(rawSymbol);
    if (!symbol) {
      return { status: 400, body: marketDataErrorResponse("invalid symbol", "error", { reason: "symbol required" }) };
    }

    try {
      const primary = await this.fetchPrimaryQuote(symbol);
      this.recordSourceUsage(primary.source);
      const compareProvider = resolveCompareProvider(compareWith);
      if (compareProvider === null) {
        return {
          status: 400,
          body: marketDataErrorResponse("invalid compare provider", "error", {
            reason: "unsupported compare_with provider; supported providers are schwab and alpaca",
          }),
        };
      }
      const compare = await this.buildQuoteComparison(symbol, compareProvider ?? undefined, primary.quote);
      return {
        status: 200,
        body: {
          source: primary.source,
          status: primary.status,
          degradedReason: primary.degradedReason ?? null,
          stalenessSeconds: primary.stalenessSeconds,
          data: primary.quote,
          ...(compare ? { compare_with: compare } : {}),
        },
      };
    } catch (error) {
      return this.toErrorRoute<MarketDataQuote>(error, { symbol });
    }
  }

  async handleQuoteBatch(request: Request): Promise<MarketDataRouteResult<Record<string, unknown>>> {
    await this.ensureRuntimeReady();
    const symbols = parseBatchSymbols(request.url);
    if (!symbols.length) {
      return { status: 400, body: marketDataErrorResponse("invalid symbols", "error", { reason: "symbols query is required" }) };
    }
    const compareWith = resolveQuery(request.url, "compare_with", "").trim() || undefined;
    const compareProvider = resolveCompareProvider(compareWith);
    if (compareProvider === null) {
      return {
        status: 400,
        body: marketDataErrorResponse("invalid compare provider", "error", {
          reason: "unsupported compare_with provider; supported providers are schwab and alpaca",
        }),
      };
    }
    const items = await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const primary = await this.fetchPrimaryQuote(symbol);
          this.recordSourceUsage(primary.source);
          const compare = await this.buildQuoteComparison(symbol, compareProvider ?? undefined, primary.quote);
          return {
            symbol,
            source: primary.source,
            status: primary.status,
            degradedReason: primary.degradedReason ?? null,
            stalenessSeconds: primary.stalenessSeconds,
            data: primary.quote,
            ...(compare ? { compare_with: compare } : {}),
          };
        } catch (error) {
          return {
            symbol,
            source: "service",
            status: "error",
            degradedReason: summarizeError(error),
            stalenessSeconds: null,
            data: { symbol },
          };
        }
      }),
    );
    return this.toBatchRouteResult(items);
  }

  async handleSnapshot(
    _request: Request,
    rawSymbol: string,
    compareWith?: string,
  ): Promise<MarketDataRouteResult<MarketDataSnapshot>> {
    await this.ensureRuntimeReady();
    const symbol = normalizeMarketSymbol(rawSymbol);
    if (!symbol) {
      return { status: 400, body: marketDataErrorResponse("invalid symbol", "error", { reason: "symbol required" }) };
    }

    try {
      const primary = await this.fetchPrimarySnapshot(symbol);
      this.recordSourceUsage(primary.source);
      const compareProvider = resolveCompareProvider(compareWith);
      if (compareProvider === null) {
        return {
          status: 400,
          body: marketDataErrorResponse("invalid compare provider", "error", {
            reason: "unsupported compare_with provider; supported providers are schwab and alpaca",
          }),
        };
      }
      const compare = await this.buildQuoteComparison(symbol, compareProvider ?? undefined, primary.snapshot.quote as MarketDataQuote | undefined);
      return {
        status: 200,
        body: {
          source: primary.source,
          status: primary.status,
          degradedReason: primary.degradedReason ?? null,
          stalenessSeconds: primary.stalenessSeconds,
          data: primary.snapshot,
          ...(compare ? { compare_with: compare } : {}),
        },
      };
    } catch (error) {
      return this.toErrorRoute<MarketDataSnapshot>(error, { symbol, quote: {}, fundamentals: {}, metadata: {} });
    }
  }

  async handleHistoryBatch(request: Request): Promise<MarketDataRouteResult<Record<string, unknown>>> {
    await this.ensureRuntimeReady();
    const symbols = parseBatchSymbols(request.url);
    if (!symbols.length) {
      return { status: 400, body: marketDataErrorResponse("invalid symbols", "error", { reason: "symbols query is required" }) };
    }

    const period = resolveQuery(request.url, "period", "1y");
    const rawInterval = resolveQuery(request.url, "interval", DEFAULT_INTERVAL);
    const interval = normalizeHistoryInterval(rawInterval);
    if (!interval) {
      return {
        status: 400,
        body: marketDataErrorResponse("invalid interval", "error", {
          reason: `unsupported interval '${rawInterval}'; supported intervals are 1d, 1wk, and 1mo`,
        }),
      };
    }
    const rawProvider = resolveQuery(request.url, "provider", "service");
    if (rawProvider.trim().toLowerCase() === "yahoo") {
      return {
        status: 400,
        body: marketDataErrorResponse("invalid provider", "error", {
          reason: "unsupported provider 'yahoo'; supported providers are service, schwab, and alpaca",
        }),
      };
    }
    const provider = normalizeHistoryProvider(rawProvider);
    if (!provider) {
        return {
          status: 400,
          body: marketDataErrorResponse("invalid provider", "error", {
            reason: `unsupported provider '${rawProvider}'; supported providers are service, schwab, and alpaca`,
          }),
        };
      }
    const compareWith = resolveQuery(request.url, "compare_with", "").trim() || undefined;
    const items = await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const primary = await this.fetchPrimaryHistory(symbol, period, interval, provider);
          this.recordSourceUsage(primary.source);
          const compare = await this.buildHistoryComparison(symbol, period, interval, compareWith, primary.rows);
          return {
            symbol,
            source: primary.source,
            status: primary.status,
            degradedReason: primary.degradedReason ?? null,
            stalenessSeconds: primary.stalenessSeconds,
            data: {
              symbol,
              period,
              interval,
              rows: primary.rows,
              comparisonHint: compare?.source,
            },
            ...(compare ? { compare_with: compare } : {}),
          };
        } catch (error) {
          return {
            symbol,
            source: "service",
            status: "error",
            degradedReason: summarizeError(error),
            stalenessSeconds: null,
            data: { symbol, period, interval, rows: [] },
          };
        }
      }),
    );
    return this.toBatchRouteResult(items);
  }

  async handleFundamentals(
    request: Request,
    rawSymbol: string,
    compareWith?: string,
  ): Promise<MarketDataRouteResult<MarketDataGenericPayload>> {
    const symbol = normalizeMarketSymbol(rawSymbol);
    if (!symbol) {
      return { status: 400, body: marketDataErrorResponse("invalid symbol", "error", { reason: "symbol required" }) };
    }

    try {
      const asOfDate = resolveQuery(request.url, "as_of_date", "");
      const primary = await this.fetchPrimaryFundamentals(symbol, asOfDate || undefined);
      this.recordSourceUsage(primary.source);
      const compareProvider = resolveCompareProvider(compareWith);
      if (compareProvider === null) {
        return {
          status: 400,
          body: marketDataErrorResponse("invalid compare provider", "error", {
            reason: "unsupported compare_with provider; supported providers are schwab and alpaca",
          }),
        };
      }
      const compare = compareProvider ? buildUnavailableCompare(compareProvider, "comparison is only implemented for history/quote paths") : undefined;
      return {
        status: 200,
        body: {
          source: primary.source,
          status: primary.status,
          degradedReason: primary.degradedReason ?? null,
          stalenessSeconds: primary.stalenessSeconds,
          data: { symbol, payload: primary.payload },
          ...(compare ? { compare_with: compare } : {}),
        },
      };
    } catch (error) {
      return this.toErrorRoute<MarketDataGenericPayload>(error, { symbol, payload: {} });
    }
  }

  async handleMetadata(
    _request: Request,
    rawSymbol: string,
    compareWith?: string,
  ): Promise<MarketDataRouteResult<MarketDataGenericPayload>> {
    const symbol = normalizeMarketSymbol(rawSymbol);
    if (!symbol) {
      return { status: 400, body: marketDataErrorResponse("invalid symbol", "error", { reason: "symbol required" }) };
    }

    try {
      const payload = await this.fetchPrimaryMetadata(symbol);
      const compareProvider = resolveCompareProvider(compareWith);
      if (compareProvider === null) {
        return {
          status: 400,
          body: marketDataErrorResponse("invalid compare provider", "error", {
            reason: "unsupported compare_with provider; supported providers are schwab and alpaca",
          }),
        };
      }
      const compare = compareProvider ? buildUnavailableCompare(compareProvider, "comparison is only implemented for history/quote paths") : undefined;
      return {
        status: 200,
        body: {
          source: "service",
          status: "ok",
          degradedReason: null,
          stalenessSeconds: 0,
          data: { symbol, payload },
          ...(compare ? { compare_with: compare } : {}),
        },
      };
    } catch (error) {
      return this.toErrorRoute<MarketDataGenericPayload>(error, { symbol, payload: {} });
    }
  }

  async handleCryptoRefresh(request: Request): Promise<MarketDataRouteResult<Record<string, unknown>>> {
    const rawSymbols = resolveQuery(request.url, "symbols", "BTC,ETH");
    const force = resolveQuery(request.url, "force", "0").trim().toLowerCase();
    const symbols = [
      ...new Set(
        rawSymbols
          .split(",")
          .map((value) => extractCoinMarketCapSymbol(value))
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    if (!symbols.length) {
      return {
        status: 400,
        body: marketDataErrorResponse("invalid symbols", "error", {
          reason: "direct crypto symbols are required; example symbols=BTC,ETH",
        }),
      };
    }
    if (!this.isCoinMarketCapConfigured()) {
      return {
        status: 503,
        body: marketDataErrorResponse("coinmarketcap unavailable", "degraded", {
          reason: "COINMARKETCAP_API_KEY is required for direct crypto refresh",
        }),
      };
    }
    try {
      const result = await this.refreshCryptoDailyCache(symbols, ["1", "true", "yes", "on"].includes(force));
      return {
        status: 200,
        body: {
          source: "service",
          status: "ok",
          degradedReason: null,
          stalenessSeconds: 0,
          data: result,
        },
      };
    } catch (error) {
      return this.toErrorRoute<Record<string, unknown>>(error, { symbols, refreshed: [] });
    }
  }

  async handleNews(
    _request: Request,
    rawSymbol: string,
    compareWith?: string,
  ): Promise<MarketDataRouteResult<MarketDataGenericPayload>> {
    const symbol = normalizeMarketSymbol(rawSymbol);
    if (!symbol) {
      return { status: 400, body: marketDataErrorResponse("invalid symbol", "error", { reason: "symbol required" }) };
    }
    void compareWith;
    return {
      status: 501,
      body: marketDataErrorResponse("news unavailable", "unavailable", {
        reason: "market-data news has been removed; no Schwab replacement is available",
      }),
    };
  }

  async handleUniverseBase(): Promise<MarketDataRouteResult<MarketDataUniverse>> {
    try {
      const payload = await this.loadOrRefreshUniverseArtifact(false);
      return {
        status: 200,
        body: {
          source: payload.source,
          status: "ok",
          degradedReason: null,
          stalenessSeconds: this.secondsSince(payload.updatedAt),
          data: payload,
        },
      };
    } catch (error) {
      return this.toErrorRoute<MarketDataUniverse>(error, { symbols: [], source: "error", updatedAt: null });
    }
  }

  async handleUniverseRefresh(): Promise<MarketDataRouteResult<MarketDataUniverse>> {
    try {
      const payload = await this.loadOrRefreshUniverseArtifact(true);
      return {
        status: 200,
        body: {
          source: payload.source,
          status: "ok",
          degradedReason: null,
          stalenessSeconds: 0,
          data: payload,
        },
      };
    } catch (error) {
      return this.toErrorRoute<MarketDataUniverse>(error, { symbols: [], source: "error", updatedAt: null });
    }
  }

  async handleRiskHistory(request: Request): Promise<MarketDataRouteResult<MarketDataRiskHistory>> {
    await this.ensureRuntimeReady();
    const days = Math.max(parseInt(resolveQuery(request.url, "days", "90"), 10) || 90, 5);
    try {
      const payload = await this.buildRiskPayload(days);
      return {
        status: 200,
        body: {
          source: payload.meta.source,
          status: payload.meta.status,
          degradedReason: payload.meta.degradedReason ?? null,
          stalenessSeconds: payload.meta.stalenessSeconds,
          data: { rows: payload.rows as unknown as Array<Record<string, unknown>> },
        },
      };
    } catch (error) {
      return this.toErrorRoute<MarketDataRiskHistory>(error, { rows: [] });
    }
  }

  async handleRiskSnapshot(): Promise<MarketDataRouteResult<MarketDataRiskSnapshot>> {
    await this.ensureRuntimeReady();
    try {
      const payload = await this.buildRiskPayload(200);
      const latest = payload.rows[payload.rows.length - 1];
      const warnings = payload.warning ? [payload.warning] : [];
      const snapshot: MarketDataRiskSnapshot = {
        snapshotDate: latest?.date ?? new Date().toISOString(),
        mFactor: latest?.fear_greed ?? 50,
        vix: latest?.vix,
        putCall: latest?.put_call,
        hySpread: latest?.hy_spread,
        fearGreed: latest?.fear_greed,
        hySpreadSource: payload.hySpreadSource,
        hySpreadFallback: payload.hySpreadFallback,
        hySpreadWarning: payload.warning,
        warnings,
      };
      return {
        status: 200,
        body: {
          source: payload.meta.source,
          status: payload.meta.status,
          degradedReason: payload.meta.degradedReason ?? null,
          stalenessSeconds: payload.meta.stalenessSeconds,
          data: snapshot,
        },
      };
    } catch (error) {
      return this.toErrorRoute<MarketDataRiskSnapshot>(error, {
        snapshotDate: new Date().toISOString(),
        mFactor: 50,
        warnings: [],
      });
    }
  }

  async handleOps(): Promise<MarketDataRouteResult<Record<string, unknown>>> {
    await this.ensureRuntimeReady();
    await this.enforceStreamerFailurePolicy();
    const health = await this.checkHealth();
    const latestUniverse = readJsonFile<MarketDataUniverse>(path.join(this.cacheDir, "base-universe.json"));
    const universeAudit = this.readUniverseAudit(5);
    const serviceOperatorState = this.currentServiceOperatorState();
    return {
      status: 200,
      body: {
        source: "service",
        status: "ok",
        degradedReason: null,
        stalenessSeconds: 0,
        data: {
          streamerRoleConfigured: this.configuredStreamerRole,
          streamerRoleActive: this.activeStreamerRole,
          streamerLockHeld: Boolean(this.leaderLockClient),
          serviceOperatorState,
          serviceOperatorAction: this.currentServiceOperatorAction(),
          sharedStateBackend: this.streamerSharedStateBackend,
          sharedStateUpdatedAt: this.sharedStateCache?.updatedAt ?? (await this.readSharedStreamerState())?.updatedAt ?? null,
          providerMetrics: this.providerMetrics,
          health,
          universe: {
            latest: latestUniverse,
            audit: universeAudit,
            ownership: {
              artifactPath: path.join(this.cacheDir, "base-universe.json"),
              auditPath: path.join(this.cacheDir, "base-universe-audit.jsonl"),
              sourceLadder: this.universeSourceLadder,
              refreshPolicy: "TS owns the artifact refresh path; python_seed is a terminal fallback only.",
            },
          },
        },
      },
    };
  }

  async handleReady(): Promise<MarketDataRouteResult<Record<string, unknown>>> {
    try {
      const health = await this.checkHealth();
      const streamerMeta =
        (((health.providers as Record<string, unknown> | undefined)?.schwabStreamerMeta as Record<string, unknown> | undefined) ?? {});
      const streamerOperatorState = String(streamerMeta.operatorState ?? "healthy");
      const serviceOperatorState = this.currentServiceOperatorState();
      const operatorState = serviceOperatorState !== "healthy" ? serviceOperatorState : streamerOperatorState;
      const ready = !["human_action_required", "max_connections_blocked"].includes(operatorState);
      return {
        status: ready ? 200 : 503,
        body: {
          source: "service",
          status: ready ? "ok" : "degraded",
          degradedReason: ready ? null : `service not ready (${operatorState})`,
          stalenessSeconds: 0,
          data: {
            ready,
            checkedAt: new Date().toISOString(),
            operatorState,
            operatorAction:
              serviceOperatorState !== "healthy"
                ? this.currentServiceOperatorAction()
                : (streamerMeta.operatorAction ?? "No operator action required."),
          },
        },
      };
    } catch (error) {
      return this.toErrorRoute(error, {
        ready: false,
        checkedAt: new Date().toISOString(),
      });
    }
  }

  async handleUniverseAudit(request: Request): Promise<MarketDataRouteResult<Record<string, unknown>>> {
    const limit = Math.max(parseInt(resolveQuery(request.url, "limit", "20"), 10) || 20, 1);
    const audit = this.readUniverseAudit(limit);
    return {
      status: 200,
      body: {
        source: "service",
        status: "ok",
        degradedReason: null,
        stalenessSeconds: 0,
        data: { entries: audit },
      },
    };
  }

  private async fetchPrimaryHistory(
    symbol: string,
    period: string,
    interval: HistoryInterval,
    provider: HistoryProvider = "service",
  ): Promise<HistoryFetchResult> {
    if (extractCoinMarketCapSymbol(symbol)) {
      if (provider !== "service") {
        throw new Error(`provider '${provider}' is not supported for crypto symbol ${symbol}`);
      }
      if (!this.isCoinMarketCapConfigured()) {
        throw new Error("CoinMarketCap API key is not configured");
      }
      const rows = await this.fetchCoinMarketCapHistory(symbol, period, interval);
      return { source: "coinmarketcap", status: "ok", stalenessSeconds: 0, rows };
    }
    if (provider === "schwab") {
      if (!this.isSchwabConfigured()) {
        throw new Error("Schwab credentials are not configured");
      }
      const rows = await this.fetchSchwabHistory(symbol, period, interval);
      return { source: "schwab", status: "ok", stalenessSeconds: 0, rows };
    }
    if (provider === "alpaca") {
      const rows = await this.fetchAlpacaHistory(symbol, period, interval);
      return { source: "alpaca", status: "ok", stalenessSeconds: 0, rows };
    }

    if (this.isSchwabConfigured()) {
      if (this.shouldSkipSchwabRest()) {
        throw new Error(this.currentSchwabRestSkipReason());
      }
      try {
        const rows = await this.fetchSchwabHistory(symbol, period, interval);
        return { source: "schwab", status: "ok", stalenessSeconds: 0, rows };
      } catch (error) {
        this.recordSchwabRestFailure(error);
        this.logger.error(`Schwab history failed for ${symbol}`, error);
        throw error;
      }
    }
    throw new Error("Schwab credentials are not configured");
  }

  private async fetchPrimaryQuote(symbol: string): Promise<QuoteFetchResult> {
    await this.enforceStreamerFailurePolicy();
    if (extractCoinMarketCapSymbol(symbol)) {
      if (!this.isCoinMarketCapConfigured()) {
        throw new Error("CoinMarketCap API key is not configured");
      }
      const quote = await this.fetchCoinMarketCapQuote(symbol);
      return { source: "coinmarketcap", status: "ok", stalenessSeconds: 0, quote };
    }
    const reasons: string[] = [];
    const isFuturesSymbol = symbol.startsWith("/");
    if (this.isSchwabConfigured()) {
      try {
        const streamed = isFuturesSymbol ? await this.streamer?.getFuturesQuote(symbol) : await this.streamer?.getQuote(symbol);
        if (streamed?.price != null) {
          return { source: "schwab_streamer", status: "ok", stalenessSeconds: 0, quote: streamed };
        }
      } catch (error) {
        reasons.push(`Schwab streamer failed: ${summarizeError(error)}`);
      }
      const shared = isFuturesSymbol ? await this.readSharedStreamerFuturesQuote(symbol) : await this.readSharedStreamerQuote(symbol);
      if (shared?.price != null) {
        return { source: "schwab_streamer_shared", status: "ok", stalenessSeconds: 0, quote: shared };
      }
      if (isFuturesSymbol) {
        throw new Error(reasons[0] ?? `No live Schwab futures quote available for ${symbol}`);
      }
      if (this.shouldSkipSchwabRest()) {
        throw new Error(this.currentSchwabRestSkipReason());
      }
      try {
        const quote = await this.fetchSchwabQuote(symbol);
        return { source: "schwab", status: "ok", stalenessSeconds: 0, quote };
      } catch (error) {
        this.recordSchwabRestFailure(error);
        this.logger.error(`Schwab quote failed for ${symbol}`, error);
        throw error;
      }
    }
    throw new Error("Schwab credentials are not configured");
  }

  private async fetchPrimarySnapshot(symbol: string): Promise<SnapshotFetchResult> {
    await this.enforceStreamerFailurePolicy();
    const quote = await this.fetchPrimaryQuote(symbol);
    const chartEquity =
      symbol.startsWith("/")
        ? null
        : (await this.streamer?.getChartEquity(symbol).catch(() => null)) ?? (await this.readSharedStreamerChart(symbol));
    const [metadata, fundamentals] = await Promise.all([
      symbol.startsWith("/") ? Promise.resolve({}) : this.fetchPrimaryMetadata(symbol).catch(() => ({})),
      symbol.startsWith("/") ? Promise.resolve({}) : this.fetchPrimaryFundamentals(symbol).then((result) => result.payload).catch(() => ({})),
    ]);
    return {
      source: quote.source,
      status: quote.status,
      degradedReason: quote.degradedReason ?? null,
      stalenessSeconds: quote.stalenessSeconds,
      snapshot: {
        symbol,
        quote: quote.quote as unknown as Record<string, unknown>,
        metadata,
        fundamentals,
        ...(chartEquity ? { chartEquity } : {}),
      },
    };
  }

  private async fetchPrimaryFundamentals(
    symbol: string,
    asOfDate?: string,
  ): Promise<ServiceMetadata & { payload: Record<string, unknown> }> {
    if (extractCoinMarketCapSymbol(symbol)) {
      if (!this.isCoinMarketCapConfigured()) {
        throw new Error("CoinMarketCap API key is not configured");
      }
      const payload = await this.fetchCoinMarketCapFundamentals(symbol);
      return {
        source: "coinmarketcap",
        status: "ok",
        degradedReason: null,
        stalenessSeconds: 0,
        payload,
      };
    }
    const reasons: string[] = [];
    const targetAsOfDate = asOfDate || new Date().toISOString().slice(0, 10);
    let schwabPayload: Record<string, unknown> = {};
    if (this.isSchwabConfigured()) {
      if (this.shouldSkipSchwabRest()) {
        reasons.push(this.currentSchwabRestSkipReason());
      } else {
        try {
          schwabPayload = (await this.fetchSchwabQuoteEnvelope(symbol, targetAsOfDate)).fundamentals;
        } catch (error) {
          this.recordSchwabRestFailure(error);
          reasons.push(summarizeError(error));
          this.logger.error(`Schwab fundamentals failed for ${symbol}`, error);
        }
      }
    }
    if (Object.keys(schwabPayload).length) {
      return {
        source: "schwab",
        status: reasons.length ? "degraded" : "ok",
        degradedReason: reasons.length ? reasons[0] : null,
        stalenessSeconds: 0,
        payload: schwabPayload,
      };
    }
    throw new Error(reasons[0] ?? `Unable to fetch fundamentals for ${symbol}`);
  }

  private async fetchPrimaryMetadata(symbol: string): Promise<Record<string, unknown>> {
    if (extractCoinMarketCapSymbol(symbol)) {
      if (!this.isCoinMarketCapConfigured()) {
        throw new Error("CoinMarketCap API key is not configured");
      }
      return this.fetchCoinMarketCapMetadata(symbol);
    }
    const reasons: string[] = [];
    let schwabPayload: Record<string, unknown> = {};
    if (this.isSchwabConfigured()) {
      if (this.shouldSkipSchwabRest()) {
        reasons.push(this.currentSchwabRestSkipReason());
      } else {
        try {
          schwabPayload = (await this.fetchSchwabQuoteEnvelope(symbol)).metadata;
        } catch (error) {
          this.recordSchwabRestFailure(error);
          reasons.push(summarizeError(error));
        }
      }
    }
    if (Object.keys(schwabPayload).length) {
      return schwabPayload;
    }
    throw new Error(reasons[0] ?? `Unable to fetch metadata for ${symbol}`);
  }

  private async buildHistoryComparison(
    symbol: string,
    period: string,
    interval: HistoryInterval,
    compareWith: string | undefined,
    primaryRows: MarketDataHistoryPoint[],
  ): Promise<MarketDataComparison | undefined> {
    const source = compareWith;
    if (!source) {
      return undefined;
    }

    try {
      let rows: MarketDataHistoryPoint[];
      if (source === "schwab") {
        if (!this.isSchwabConfigured()) {
          return buildUnavailableCompare(source, "Schwab credentials are not configured");
        }
        rows = await this.fetchSchwabHistory(symbol, period, interval);
      } else if (source === "alpaca") {
        rows = await this.fetchAlpacaHistory(symbol, period, interval);
      } else {
        return buildUnavailableCompare(source, "Unsupported comparison provider");
      }

      return {
        source,
        available: true,
        mismatchSummary: compareHistoryRows(primaryRows, rows),
        stalenessSeconds: 0,
      };
    } catch (error) {
      return buildUnavailableCompare(source, summarizeError(error));
    }
  }

  private async buildQuoteComparison(
    symbol: string,
    compareWith: string | undefined,
    primaryQuote: MarketDataQuote | undefined,
  ): Promise<MarketDataComparison | undefined> {
    const source = compareWith;
    if (!source || !primaryQuote) {
      return undefined;
    }

    try {
      let quote: MarketDataQuote;
      if (source === "schwab") {
        if (!this.isSchwabConfigured()) {
          return buildUnavailableCompare(source, "Schwab credentials are not configured");
        }
        quote = await this.fetchSchwabQuote(symbol);
      } else if (source === "alpaca") {
        quote = await this.fetchAlpacaQuote(symbol);
      } else {
        return buildUnavailableCompare(source, "Unsupported comparison provider");
      }

      return {
        source,
        available: true,
        mismatchSummary: compareQuotes(primaryQuote, quote),
        stalenessSeconds: 0,
      };
    } catch (error) {
      return buildUnavailableCompare(source, summarizeError(error));
    }
  }

  private hasSchwabClientCredentials(): boolean {
    return Boolean(this.config.SCHWAB_CLIENT_ID.trim() && this.config.SCHWAB_CLIENT_SECRET.trim());
  }

  private isSchwabConfigured(): boolean {
    return Boolean(this.hasSchwabClientCredentials() && this.getSchwabRefreshToken(this.readCachedSchwabToken()));
  }

  private isValidSchwabAuthState(state: string): boolean {
    if (!state || !this.pendingSchwabAuthState) {
      return false;
    }
    const ageMs = Date.now() - this.pendingSchwabAuthState.createdAt;
    if (ageMs > 10 * 60 * 1000) {
      this.pendingSchwabAuthState = null;
      return false;
    }
    return this.pendingSchwabAuthState.value === state;
  }

  private async fetchSchwabStreamerPreferences(): Promise<SchwabStreamerPreferences> {
    const token = await this.getSchwabAccessToken();
    const defaultUrl = `${this.config.SCHWAB_API_BASE_URL.replace(/\/+$/, "")}/trader/v1/userPreference`;
    const url = this.config.SCHWAB_USER_PREFERENCES_URL.trim() || defaultUrl;
    const payload = await this.fetchJson<JsonRecord | JsonRecord[]>(url, {
      headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
    });
    const root = Array.isArray(payload) ? ((payload[0] as JsonRecord | undefined) ?? {}) : payload;
    const streamerInfo = ((Array.isArray(root.streamerInfo) ? root.streamerInfo[0] : root.streamerInfo) as JsonRecord | undefined) ?? root;
    const prefs: SchwabStreamerPreferences = {
      streamerSocketUrl: firstString(streamerInfo.streamerSocketUrl, streamerInfo.socketUrl, streamerInfo.streamerUrl) ?? "",
      schwabClientCustomerId: firstString(
        streamerInfo.schwabClientCustomerId,
        root.schwabClientCustomerId,
        root.accountId,
      ) ?? "",
      schwabClientCorrelId: firstString(streamerInfo.schwabClientCorrelId, root.schwabClientCorrelId) ?? "",
      schwabClientChannel: firstString(streamerInfo.schwabClientChannel, root.schwabClientChannel) ?? "",
      schwabClientFunctionId: firstString(streamerInfo.schwabClientFunctionId, root.schwabClientFunctionId) ?? "",
    };
    if (
      !prefs.streamerSocketUrl ||
      !prefs.schwabClientCustomerId ||
      !prefs.schwabClientCorrelId ||
      !prefs.schwabClientChannel ||
      !prefs.schwabClientFunctionId
    ) {
      throw new Error("Schwab user preferences did not include complete streamer connection details");
    }
    this.recordSchwabRestSuccess();
    return prefs;
  }

  private createStreamer(websocketFactory?: WebSocketFactory): SchwabStreamerSession {
    return new SchwabStreamerSession({
      logger: this.logger,
      websocketFactory,
      accessTokenProvider: () => this.getSchwabAccessToken(),
      preferencesProvider: () => this.fetchSchwabStreamerPreferences(),
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
        void this.writeSharedStreamerState(state);
      },
    });
  }

  private async enforceStreamerFailurePolicy(): Promise<void> {
    const streamer = this.streamer;
    if (!streamer) {
      return;
    }
    const health = streamer.getHealth();
    if (!health) {
      return;
    }
    if (health.failurePolicy !== "max_connections_exceeded" || this.activeStreamerRole !== "leader") {
      return;
    }
    this.logger.error("Demoting Schwab streamer leader after CLOSE_CONNECTION / max connection policy");
    streamer.close();
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
    this.activeStreamerRole = "follower";
  }

  private async ensureRuntimeReady(): Promise<void> {
    if (this.runtimeReadyPromise) {
      return this.runtimeReadyPromise;
    }
    this.runtimeReadyPromise = (async () => {
      if (this.streamerSharedStateBackend === "postgres" || this.configuredStreamerRole === "auto") {
        await this.ensureDB();
      }
      if (this.streamerSharedStateBackend === "postgres") {
        await this.setupSharedStateListener();
      }
      if (this.configuredStreamerRole === "auto") {
        const acquired = await this.tryAcquireStreamerLeadership();
        this.activeStreamerRole = acquired ? "leader" : "follower";
      }
      if (this.streamerEnabled && this.activeStreamerRole === "leader" && !this.streamer && this.isSchwabConfigured()) {
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

  private async tryAcquireStreamerLeadership(): Promise<boolean> {
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

  private async fetchSchwabHistory(symbol: string, period: string, interval: HistoryInterval): Promise<MarketDataHistoryPoint[]> {
    const token = await this.getSchwabAccessToken();
    const params = mapSchwabPeriod(period, interval);
    const url = new URL(`${this.config.SCHWAB_API_BASE_URL.replace(/\/+$/, "")}/marketdata/v1/pricehistory`);
    url.searchParams.set("symbol", symbol);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
    const payload = await this.fetchJson<JsonRecord>(url.toString(), {
      headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
    });
    const candles = ((payload.candles as JsonRecord[] | undefined) ?? []).map((candle) => ({
      timestamp: new Date(Number(candle.datetime ?? 0)).toISOString(),
      open: toNumber(candle.open) ?? NaN,
      high: toNumber(candle.high) ?? NaN,
      low: toNumber(candle.low) ?? NaN,
      close: toNumber(candle.close) ?? NaN,
      volume: toNumber(candle.volume) ?? NaN,
    }));
    const rows = candles.filter((row) => !Object.values(row).some((value) => typeof value === "number" && Number.isNaN(value)));
    if (!rows.length) {
      throw new Error(`Schwab returned no candles for ${symbol}`);
    }
    this.recordSchwabRestSuccess();
    return rows;
  }

  private async fetchSchwabQuote(symbol: string): Promise<MarketDataQuote> {
    return (await this.fetchSchwabQuoteEnvelope(symbol)).quote;
  }

  private async fetchSchwabQuoteEnvelope(symbol: string, asOfDate?: string): Promise<SchwabQuoteEnvelope> {
    const token = await this.getSchwabAccessToken();
    const url = new URL(`${this.config.SCHWAB_API_BASE_URL.replace(/\/+$/, "")}/marketdata/v1/quotes`);
    url.searchParams.set("symbols", symbol);
    url.searchParams.set("fields", "quote,fundamental");
    const payload = await this.fetchJson<JsonRecord>(url.toString(), {
      headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
    });
    const envelope = normalizeSchwabQuoteEnvelope(payload, symbol, asOfDate || new Date().toISOString().slice(0, 10));
    this.recordSchwabRestSuccess();
    return envelope;
  }

  private async fetchAlpacaHistory(
    symbol: string,
    period: string,
    interval: HistoryInterval = DEFAULT_INTERVAL,
  ): Promise<MarketDataHistoryPoint[]> {
    const keys = await this.getAlpacaKeys();
    const url = new URL(`${keys.data_url}/v2/stocks/${encodeURIComponent(symbol)}/bars`);
    url.searchParams.set("timeframe", mapAlpacaTimeframe(interval));
    url.searchParams.set("limit", String(normalizeAlpacaBarLimit(period)));
    url.searchParams.set("adjustment", "raw");
    url.searchParams.set("feed", "iex");
    const payload = await this.fetchJson<JsonRecord>(url.toString(), {
      headers: {
        "APCA-API-KEY-ID": keys.key_id,
        "APCA-API-SECRET-KEY": keys.secret_key,
        accept: "application/json",
      },
    });
    const rows = ((payload.bars as JsonRecord[] | undefined) ?? [])
      .map((bar) => ({
        timestamp: String(bar.t ?? ""),
        open: toNumber(bar.o) ?? NaN,
        high: toNumber(bar.h) ?? NaN,
        low: toNumber(bar.l) ?? NaN,
        close: toNumber(bar.c) ?? NaN,
        volume: toNumber(bar.v) ?? NaN,
      }))
      .filter(
        (row) =>
          Boolean(row.timestamp) &&
          !Object.values(row).some((value) => typeof value === "number" && Number.isNaN(value)),
      );
    if (!rows.length) {
      throw new Error(`Alpaca returned no bars for ${symbol}`);
    }
    return rows;
  }

  private async fetchAlpacaQuote(symbol: string): Promise<MarketDataQuote> {
    const keys = await this.getAlpacaKeys();
    const tradeUrl = `${keys.data_url}/v2/stocks/${encodeURIComponent(symbol)}/trades/latest?feed=iex`;
    const tradePayload = await this.fetchJson<JsonRecord>(tradeUrl, {
      headers: {
        "APCA-API-KEY-ID": keys.key_id,
        "APCA-API-SECRET-KEY": keys.secret_key,
        accept: "application/json",
      },
    });
    const trade = (tradePayload.trade as JsonRecord | undefined) ?? {};
    const price = toNumber(trade.p);
    if (price == null) {
      throw new Error(`Alpaca returned no trade price for ${symbol}`);
    }
    return {
      symbol,
      price,
      timestamp: typeof trade.t === "string" ? trade.t : new Date().toISOString(),
      currency: "USD",
    };
  }

  private isCoinMarketCapConfigured(): boolean {
    return Boolean(this.config.COINMARKETCAP_API_KEY.trim());
  }

  private async fetchCoinMarketCapQuote(symbol: string): Promise<MarketDataQuote> {
    const cached = this.readCryptoDailyCacheEntry(symbol);
    if (cached && isSameUtcDay(cached.refreshedAt, new Date().toISOString())) {
      return cached.quote;
    }
    const entry = await this.fetchCoinMarketCapLatestEntry(symbol);
    const quote = normalizeCoinMarketCapQuote(entry, symbol);
    await this.maybeRefreshCryptoDailyCacheFromLiveEntry(symbol, entry);
    return quote;
  }

  private async fetchCoinMarketCapFundamentals(symbol: string): Promise<Record<string, unknown>> {
    const cached = this.readCryptoDailyCacheEntry(symbol);
    if (cached && isSameUtcDay(cached.refreshedAt, new Date().toISOString())) {
      return cached.fundamentals;
    }
    const entry = await this.fetchCoinMarketCapLatestEntry(symbol);
    const fundamentals = normalizeCoinMarketCapFundamentals(entry, symbol);
    await this.maybeRefreshCryptoDailyCacheFromLiveEntry(symbol, entry);
    return fundamentals;
  }

  private async fetchCoinMarketCapMetadata(symbol: string): Promise<Record<string, unknown>> {
    const cached = this.readCryptoDailyCacheEntry(symbol);
    if (cached && isSameUtcDay(cached.refreshedAt, new Date().toISOString())) {
      return cached.metadata;
    }
    const entry = await this.fetchCoinMarketCapLatestEntry(symbol);
    const infoEntry = await this.fetchCoinMarketCapInfoEntry(symbol, firstString(entry.slug));
    const metadata = normalizeCoinMarketCapMetadata(entry, infoEntry, symbol);
    await this.writeCryptoDailyCacheEntry(symbol, entry, infoEntry);
    return metadata;
  }

  private async fetchCoinMarketCapHistory(
    symbol: string,
    period: string,
    interval: HistoryInterval,
  ): Promise<MarketDataHistoryPoint[]> {
    const cached = this.readCryptoDailyCacheEntry(symbol);
    if (cached?.rows?.length) {
      const rows = this.filterCryptoHistoryRows(cached.rows, period, interval);
      if (rows.length) {
        return rows;
      }
    }
    const entry = await this.fetchCoinMarketCapLatestEntry(symbol);
    const coinId = toNumber(entry.id);
    if (coinId == null) {
      throw new Error(`CoinMarketCap returned no canonical id for ${symbol}`);
    }
    const { timeStart, timeEnd } = resolveCoinMarketCapTimeRange(period);
    const payload = await this.fetchCoinMarketCapJson<JsonRecord>("/v1/cryptocurrency/quotes/historical", {
      id: String(coinId),
      convert: "USD",
      interval: mapCoinMarketCapInterval(interval),
      time_start: timeStart,
      time_end: timeEnd,
    });
    const quotes = Array.isArray((payload.data as JsonRecord | undefined)?.quotes)
      ? (((payload.data as JsonRecord).quotes as JsonRecord[]) ?? [])
      : [];
    const rows = normalizeCoinMarketCapHistory(quotes, symbol);
    if (!rows.length) {
      throw new Error(`CoinMarketCap returned no historical quotes for ${symbol}`);
    }
    return rows;
  }

  private async fetchCoinMarketCapLatestEntry(symbol: string): Promise<JsonRecord> {
    const cmcSymbol = extractCoinMarketCapSymbol(symbol);
    if (!cmcSymbol) {
      throw new Error(`CoinMarketCap does not support non-crypto symbol ${symbol}`);
    }
    const payload = await this.fetchCoinMarketCapJson<JsonRecord>("/v1/cryptocurrency/quotes/latest", {
      symbol: cmcSymbol,
      convert: "USD",
    });
    const data = (payload.data as JsonRecord | undefined) ?? {};
    const entry = data[cmcSymbol];
    if (entry && !Array.isArray(entry) && typeof entry === "object") {
      return entry as JsonRecord;
    }
    if (Array.isArray(entry) && entry[0] && typeof entry[0] === "object") {
      return entry[0] as JsonRecord;
    }
    throw new Error(`CoinMarketCap returned no quote payload for ${symbol}`);
  }

  private async maybeRefreshCryptoDailyCacheFromLiveEntry(symbol: string, entry: JsonRecord): Promise<void> {
    const cached = this.readCryptoDailyCacheEntry(symbol);
    if (cached && isSameUtcDay(cached.refreshedAt, new Date().toISOString())) {
      return;
    }
    const infoEntry = await this.fetchCoinMarketCapInfoEntry(symbol, firstString(entry.slug)).catch(() => undefined);
    await this.writeCryptoDailyCacheEntry(symbol, entry, infoEntry);
  }

  private async fetchCoinMarketCapInfoEntry(symbol: string, preferredSlug?: string): Promise<JsonRecord | undefined> {
    const cmcSymbol = extractCoinMarketCapSymbol(symbol);
    if (!cmcSymbol) {
      return undefined;
    }
    const payload = await this.fetchCoinMarketCapJson<JsonRecord>("/v2/cryptocurrency/info", {
      symbol: cmcSymbol,
    });
    const data = (payload.data as JsonRecord | undefined) ?? {};
    return pickCoinMarketCapInfoEntry(data[cmcSymbol], preferredSlug);
  }

  private async refreshCryptoDailyCache(symbols: string[], force: boolean): Promise<Record<string, unknown>> {
    const cache = this.readCryptoDailyCache();
    const refreshed: Array<Record<string, unknown>> = [];
    const today = new Date().toISOString();
    for (const symbol of symbols) {
      const existing = cache.symbols[symbol];
      if (!force && existing && isSameUtcDay(existing.refreshedAt, today)) {
        refreshed.push({ symbol, status: "skipped", refreshedAt: existing.refreshedAt, rowCount: existing.rows.length });
        continue;
      }
      const entry = await this.fetchCoinMarketCapLatestEntry(symbol);
      const infoEntry = await this.fetchCoinMarketCapInfoEntry(symbol, firstString(entry.slug));
      const updated = this.buildCryptoDailyCacheEntry(symbol, entry, infoEntry, existing?.rows ?? []);
      cache.symbols[symbol] = updated;
      refreshed.push({ symbol, status: "refreshed", refreshedAt: updated.refreshedAt, rowCount: updated.rows.length });
    }
    cache.updatedAt = new Date().toISOString();
    this.writeCryptoDailyCache(cache);
    return {
      updatedAt: cache.updatedAt,
      symbols,
      refreshed,
      artifactPath: this.cryptoDailyCachePath(),
    };
  }

  private readCryptoDailyCacheEntry(symbol: string): CryptoDailyCacheEntry | null {
    return this.readCryptoDailyCache().symbols[normalizeCryptoCacheKey(symbol)] ?? null;
  }

  private readCryptoDailyCache(): CryptoDailyCacheFile {
    const artifactPath = this.cryptoDailyCachePath();
    try {
      const raw = fs.readFileSync(artifactPath, "utf8");
      const parsed = JSON.parse(raw) as CryptoDailyCacheFile;
      return {
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
        symbols: parsed && typeof parsed.symbols === "object" && parsed.symbols ? parsed.symbols : {},
      } as CryptoDailyCacheFile;
    } catch {
      return { updatedAt: new Date(0).toISOString(), symbols: {} };
    }
  }

  private writeCryptoDailyCache(cache: CryptoDailyCacheFile): void {
    try {
      fs.mkdirSync(this.cacheDir, { recursive: true });
      fs.writeFileSync(this.cryptoDailyCachePath(), JSON.stringify(cache, null, 2));
    } catch (error) {
      this.logger.error("Unable to persist crypto daily cache", error);
    }
  }

  private async writeCryptoDailyCacheEntry(symbol: string, entry: JsonRecord, infoEntry?: JsonRecord): Promise<void> {
    const cache = this.readCryptoDailyCache();
    const cacheKey = normalizeCryptoCacheKey(symbol);
    cache.symbols[cacheKey] = this.buildCryptoDailyCacheEntry(cacheKey, entry, infoEntry, cache.symbols[cacheKey]?.rows ?? []);
    cache.updatedAt = new Date().toISOString();
    this.writeCryptoDailyCache(cache);
  }

  private buildCryptoDailyCacheEntry(
    symbol: string,
    entry: JsonRecord,
    infoEntry: JsonRecord | undefined,
    existingRows: MarketDataHistoryPoint[],
  ): CryptoDailyCacheEntry {
    const quote = normalizeCoinMarketCapQuote(entry, symbol);
    const fundamentals = normalizeCoinMarketCapFundamentals(entry, symbol);
    const metadata = normalizeCoinMarketCapMetadata(entry, infoEntry, symbol);
    const refreshedAt = quote.timestamp || new Date().toISOString();
    const dailyRow: MarketDataHistoryPoint = {
      timestamp: startOfUtcDayIso(refreshedAt),
      open: quote.price ?? 0,
      high: quote.price ?? 0,
      low: quote.price ?? 0,
      close: quote.price ?? 0,
      volume: quote.volume ?? 0,
    };
    const rows = upsertDailyHistoryRow(existingRows, dailyRow).slice(-400);
    return {
      symbol,
      refreshedAt,
      quote,
      fundamentals,
      metadata,
      rows,
    };
  }

  private filterCryptoHistoryRows(
    rows: MarketDataHistoryPoint[],
    period: string,
    interval: HistoryInterval,
  ): MarketDataHistoryPoint[] {
    const cutoff = resolveCoinMarketCapTimeRange(period).timeStart;
    const cutoffMs = Date.parse(cutoff);
    const filtered = rows.filter((row) => Date.parse(row.timestamp) >= cutoffMs).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    if (interval === "1d") {
      return filtered;
    }
    return compressHistoryRows(filtered, interval);
  }

  private cryptoDailyCachePath(): string {
    return path.join(this.cacheDir, "crypto-daily-cache.json");
  }

  private async fetchCoinMarketCapJson<T>(endpoint: string, params: Record<string, string>): Promise<T> {
    const apiKey = this.config.COINMARKETCAP_API_KEY.trim();
    if (!apiKey) {
      throw new Error("CoinMarketCap API key is not configured");
    }
    const url = new URL(`${this.config.COINMARKETCAP_API_BASE_URL.replace(/\/+$/, "")}${endpoint}`);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    let payload: JsonRecord;
    try {
      payload = await this.fetchJson<JsonRecord>(url.toString(), {
        headers: {
          "X-CMC_PRO_API_KEY": apiKey,
          accept: "application/json",
        },
      });
    } catch (error) {
      if (error instanceof HttpError) {
        const parsed = this.tryParseCoinMarketCapErrorPayload(error.body);
        if (parsed) {
          throw new Error(parsed);
        }
      }
      throw error;
    }
    const status = (payload.status as JsonRecord | undefined) ?? {};
    const errorCode = toNumber(status.error_code) ?? 0;
    if (errorCode !== 0) {
      const message = firstString(status.error_message) ?? "CoinMarketCap request failed";
      if (errorCode === 1006 && endpoint.includes("/historical")) {
        throw new Error("CoinMarketCap historical quotes are not available on the configured API plan");
      }
      throw new Error(message);
    }
    return payload as T;
  }

  private tryParseCoinMarketCapErrorPayload(rawBody: string): string | null {
    try {
      const payload = JSON.parse(rawBody) as JsonRecord;
      const status = (payload.status as JsonRecord | undefined) ?? {};
      const errorCode = toNumber(status.error_code) ?? 0;
      const message = firstString(status.error_message);
      if (!errorCode && !message) {
        return null;
      }
      if (errorCode === 1006) {
        return "CoinMarketCap historical quotes are not available on the configured API plan";
      }
      return message ?? `CoinMarketCap request failed (${errorCode})`;
    } catch {
      return null;
    }
  }

  private async getAlpacaKeys(): Promise<AlpacaKeys> {
    const envKeyId = (process.env.ALPACA_KEY ?? process.env.ALPACA_KEY_ID ?? "").trim();
    const envSecret = (process.env.ALPACA_SECRET_KEY ?? "").trim();
    const envDataUrl = (process.env.ALPACA_DATA_URL ?? "").trim();
    if (envKeyId && envSecret) {
      return {
        key_id: envKeyId,
        secret_key: envSecret,
        data_url: normalizeAlpacaDataUrl(envDataUrl || "https://data.alpaca.markets"),
      };
    }

    const keyPath = (process.env.ALPACA_KEYS_PATH ?? this.config.ALPACA_KEYS_PATH ?? "").trim() || path.join(os.homedir(), "Desktop", "services", "alpaca_keys.json");
    try {
      const raw = await fs.promises.readFile(keyPath, "utf8");
      const parsed = JSON.parse(raw) as JsonRecord;
      const keyId = String(parsed.key_id ?? "").trim();
      const secret = String(parsed.secret_key ?? "").trim();
      const dataUrl = normalizeAlpacaDataUrl(String(parsed.data_url ?? "https://data.alpaca.markets"));
      if (!keyId || !secret) {
        throw new Error("alpaca keys file is missing credentials");
      }
      return { key_id: keyId, secret_key: secret, data_url: dataUrl };
    } catch (error) {
      throw new Error(`Alpaca credentials unavailable: ${summarizeError(error)}`);
    }
  }

  private async getSchwabAccessToken(): Promise<string> {
    const cached = this.readCachedSchwabToken();
    if (cached?.accessToken && cached.expiresAt && cached.expiresAt > Date.now() + 60_000) {
      return cached.accessToken;
    }
    if (this.tokenRefreshPromise) {
      return this.tokenRefreshPromise;
    }

    this.providerMetrics.tokenRefreshInFlight = true;
    this.tokenRefreshPromise = (async () => {
      const refreshToken = this.getSchwabRefreshToken(cached);
      if (!refreshToken) {
        throw new Error("Schwab refresh token is not configured. Complete the OAuth flow first.");
      }
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      });
      const auth = Buffer.from(`${this.config.SCHWAB_CLIENT_ID}:${this.config.SCHWAB_CLIENT_SECRET}`).toString("base64");
      const response = await this.fetchResponse(this.config.SCHWAB_TOKEN_URL, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body,
      });
      let payload: JsonRecord;
      try {
        payload = await readJsonResponse<JsonRecord>(response);
      } catch (error) {
        this.providerMetrics.lastTokenRefreshFailureAt = new Date().toISOString();
        if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
          this.providerMetrics.schwabTokenStatus = "human_action_required";
          this.providerMetrics.schwabTokenReason = "Schwab refresh token was rejected. Re-authorize the developer app and update the refresh token.";
          throw new Error("Schwab refresh token rejected (401/403). Manual re-authentication is required.");
        }
        this.recordSchwabRestFailure(error);
        throw error;
      }
      const accessToken = String(payload.access_token ?? "").trim();
      const expiresIn = Number(payload.expires_in ?? 1800);
      const nextRefreshToken = String(payload.refresh_token ?? refreshToken).trim();
      if (!accessToken) {
        throw new Error("Schwab token refresh returned no access token");
      }
      this.writeCachedSchwabToken({
        accessToken,
        expiresAt: Date.now() + Math.max(expiresIn - 60, 60) * 1000,
        refreshToken: nextRefreshToken,
        refreshTokenIssuedAt: cached?.refreshTokenIssuedAt ?? new Date().toISOString(),
        lastAuthorizationCodeAt: cached?.lastAuthorizationCodeAt ?? null,
      });
      this.providerMetrics.lastTokenRefreshAt = new Date().toISOString();
      this.providerMetrics.schwabTokenStatus = "ready";
      this.providerMetrics.schwabTokenReason = null;
      this.recordSchwabRestSuccess();
      return accessToken;
    })();
    try {
      return await this.tokenRefreshPromise;
    } finally {
      this.tokenRefreshPromise = null;
      this.providerMetrics.tokenRefreshInFlight = false;
    }
  }

  private async exchangeSchwabAuthorizationCode(code: string): Promise<CachedTokenPayload> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.config.SCHWAB_REDIRECT_URL,
    });
    const auth = Buffer.from(`${this.config.SCHWAB_CLIENT_ID}:${this.config.SCHWAB_CLIENT_SECRET}`).toString("base64");
    const response = await this.fetchResponse(this.config.SCHWAB_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body,
    });
    const payload = await readJsonResponse<JsonRecord>(response);
    const accessToken = String(payload.access_token ?? "").trim();
    const refreshToken = String(payload.refresh_token ?? "").trim();
    const expiresIn = Number(payload.expires_in ?? 1800);
    if (!accessToken || !refreshToken) {
      throw new Error("Schwab authorization code exchange returned incomplete token data");
    }
    const token: CachedTokenPayload = {
      accessToken,
      expiresAt: Date.now() + Math.max(expiresIn - 60, 60) * 1000,
      refreshToken,
      refreshTokenIssuedAt: new Date().toISOString(),
      lastAuthorizationCodeAt: new Date().toISOString(),
    };
    this.writeCachedSchwabToken(token);
    this.providerMetrics.lastTokenRefreshAt = new Date().toISOString();
    this.providerMetrics.schwabTokenStatus = "ready";
    this.providerMetrics.schwabTokenReason = null;
    this.recordSchwabRestSuccess();
    return token;
  }

  private readCachedSchwabToken(): CachedTokenPayload | null {
    try {
      const raw = fs.readFileSync(this.schwabTokenPath, "utf8");
      const payload = JSON.parse(raw) as CachedTokenPayload;
      if (!payload || (typeof payload !== "object")) {
        return null;
      }
      return payload;
    } catch {
      return null;
    }
  }

  private writeCachedSchwabToken(payload: CachedTokenPayload): void {
    try {
      fs.mkdirSync(path.dirname(this.schwabTokenPath), { recursive: true });
      fs.writeFileSync(this.schwabTokenPath, JSON.stringify(payload, null, 2));
    } catch (error) {
      this.logger.error("Unable to persist Schwab token cache", error);
    }
  }

  private getSchwabRefreshToken(cached: CachedTokenPayload | null): string {
    return String(cached?.refreshToken ?? this.config.SCHWAB_REFRESH_TOKEN ?? "").trim();
  }

  private async loadOrRefreshUniverseArtifact(forceRefresh: boolean): Promise<MarketDataUniverse> {
    const payload = await this.universeManager.loadOrRefreshArtifact(forceRefresh);
    this.providerMetrics.lastSuccessfulUniverseRefreshAt = payload.updatedAt;
    return payload;
  }

  private async buildRiskPayload(days: number): Promise<RiskPayloadResult> {
    return buildRiskPayload({
      days,
      fredApiKey: this.config.FRED_API_KEY,
      fetchSchwabHistory: (symbol, period, interval) => this.fetchSchwabHistory(symbol, period, interval),
      fetchJson: this.fetchJson.bind(this),
      fetchResponse: this.fetchResponse.bind(this),
    });
  }

  private async fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchResponse(url, { ...init }, this.requestTimeoutMs);
    if (!response.ok) {
      const body = await response.text();
      throw new HttpError(`HTTP ${response.status}`, response.status, body);
    }
    return (await response.json()) as T;
  }

  private async fetchResponse(input: string | URL, init: RequestInit = {}, timeoutMs = this.requestTimeoutMs): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.fetchImpl(input, { ...init, signal: init.signal ?? controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  private recordSchwabRestSuccess(): void {
    this.providerMetrics.lastSuccessfulSchwabRestAt = new Date().toISOString();
    this.providerMetrics.lastSchwabFailureAt = null;
    this.providerMetrics.schwabConsecutiveFailures = 0;
    this.providerMetrics.schwabCooldownUntil = null;
    this.schwabCooldownUntilMs = 0;
  }

  private recordSchwabRestFailure(error: unknown): void {
    this.providerMetrics.lastSchwabFailureAt = new Date().toISOString();
    this.providerMetrics.schwabConsecutiveFailures += 1;
    if (this.providerMetrics.schwabConsecutiveFailures < this.schwabFailureThreshold) {
      return;
    }
    this.schwabCooldownUntilMs = Date.now() + this.schwabCooldownMs;
    this.providerMetrics.schwabCooldownUntil = new Date(this.schwabCooldownUntilMs).toISOString();
    if (error instanceof Error && error.message.includes("Manual re-authentication")) {
      this.providerMetrics.schwabTokenStatus = "human_action_required";
    }
  }

  private isSchwabCooldownOpen(): boolean {
    if (!this.schwabCooldownUntilMs) {
      return false;
    }
    if (Date.now() >= this.schwabCooldownUntilMs) {
      this.schwabCooldownUntilMs = 0;
      this.providerMetrics.schwabCooldownUntil = null;
      this.providerMetrics.schwabConsecutiveFailures = 0;
      return false;
    }
    return true;
  }

  private shouldSkipSchwabRest(): boolean {
    return this.providerMetrics.schwabTokenStatus === "human_action_required" || this.isSchwabCooldownOpen();
  }

  private currentSchwabRestSkipReason(): string {
    if (this.providerMetrics.schwabTokenStatus === "human_action_required") {
      return this.providerMetrics.schwabTokenReason ?? "Schwab credentials require manual re-authentication";
    }
    if (this.isSchwabCooldownOpen()) {
      return `Schwab REST cooldown open until ${this.providerMetrics.schwabCooldownUntil}`;
    }
    return "Schwab REST temporarily unavailable";
  }

  private recordSharedStateFallbackSuccess(): void {
    this.providerMetrics.fallbackUsage.shared_state = (this.providerMetrics.fallbackUsage.shared_state ?? 0) + 1;
  }

  private recordSourceUsage(source: string): void {
    this.providerMetrics.sourceUsage[source] = (this.providerMetrics.sourceUsage[source] ?? 0) + 1;
  }

  private currentServiceOperatorState(): string {
    if (this.providerMetrics.schwabTokenStatus === "human_action_required") {
      return "human_action_required";
    }
    if (this.isSchwabCooldownOpen()) {
      return "provider_cooldown";
    }
    return "healthy";
  }

  private currentServiceOperatorAction(): string {
    if (this.providerMetrics.schwabTokenStatus === "human_action_required") {
      return this.providerMetrics.schwabTokenReason ?? "Re-authorize Schwab access and refresh the cached refresh token.";
    }
    if (this.isSchwabCooldownOpen()) {
      return `Schwab REST is cooling down after repeated failures. Wait until ${this.providerMetrics.schwabCooldownUntil} or inspect upstream connectivity/auth.`;
    }
    return "No operator action required.";
  }

  private toBatchRouteResult(items: Array<Record<string, unknown>>): MarketDataRouteResult<Record<string, unknown>> {
    const successCount = items.filter((item) => String(item.status ?? "") !== "error").length;
    const status = successCount === items.length ? "ok" : successCount > 0 ? "degraded" : "error";
    return {
      status: successCount > 0 ? 200 : 503,
      body: {
        source: "service",
        status,
        degradedReason: successCount === items.length ? null : `${items.length - successCount} batch item(s) failed`,
        stalenessSeconds: 0,
        data: { items },
      },
    };
  }

  private async writeSharedStreamerState(state: SharedStreamerState): Promise<void> {
    if (this.streamerSharedStateBackend === "postgres") {
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
      fs.mkdirSync(path.dirname(this.streamerSharedStatePath), { recursive: true });
      fs.writeFileSync(this.streamerSharedStatePath, JSON.stringify(state, null, 2));
      this.sharedStateCache = state;
      this.sharedStateCacheMtimeMs = fs.statSync(this.streamerSharedStatePath).mtimeMs;
    } catch (error) {
      this.logger.error("Unable to persist shared Schwab streamer state", error);
    }
  }

  private async readSharedStreamerState(): Promise<SharedStreamerState | null> {
    if (this.streamerSharedStateBackend === "file" && this.sharedStateCache) {
      try {
        const fileMtimeMs = fs.statSync(this.streamerSharedStatePath).mtimeMs;
        if (this.sharedStateCacheMtimeMs != null && fileMtimeMs <= this.sharedStateCacheMtimeMs) {
          return this.sharedStateCache;
        }
      } catch {
        return this.sharedStateCache;
      }
    } else if (this.sharedStateCache) {
      return this.sharedStateCache;
    }
    if (this.streamerSharedStateBackend === "postgres") {
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
    this.sharedStateCache = readJsonFile<SharedStreamerState>(this.streamerSharedStatePath);
    try {
      this.sharedStateCacheMtimeMs = fs.statSync(this.streamerSharedStatePath).mtimeMs;
    } catch {
      this.sharedStateCacheMtimeMs = null;
    }
    return this.sharedStateCache;
  }

  private async readSharedStreamerQuote(symbol: string): Promise<MarketDataQuote | null> {
    if (this.activeStreamerRole !== "follower") {
      return null;
    }
    const state = await this.readSharedStreamerState();
    const quote = state?.quotes?.[symbol];
    if (!quote?.receivedAt || !quote.quote) {
      return null;
    }
    const ageSeconds = this.secondsSince(quote.receivedAt);
    if (ageSeconds == null || ageSeconds > Math.round(this.config.SCHWAB_STREAMER_QUOTE_TTL_MS / 1000)) {
      return null;
    }
    this.recordSharedStateFallbackSuccess();
    return quote.quote;
  }

  private async readSharedStreamerFuturesQuote(symbol: string): Promise<MarketDataQuote | null> {
    if (this.activeStreamerRole !== "follower") {
      return null;
    }
    const state = await this.readSharedStreamerState();
    const quote = state?.futuresQuotes?.[symbol];
    if (!quote?.receivedAt || !quote.quote) {
      return null;
    }
    const ageSeconds = this.secondsSince(quote.receivedAt);
    if (ageSeconds == null || ageSeconds > Math.round(this.config.SCHWAB_STREAMER_QUOTE_TTL_MS / 1000)) {
      return null;
    }
    this.recordSharedStateFallbackSuccess();
    return quote.quote;
  }

  private async readSharedStreamerChart(symbol: string): Promise<Record<string, unknown> | null> {
    if (this.activeStreamerRole !== "follower") {
      return null;
    }
    const state = await this.readSharedStreamerState();
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

  private async refreshSharedStateCacheFromBackend(): Promise<void> {
    if (this.streamerSharedStateBackend !== "postgres" || !this.pool) {
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

  private readUniverseAudit(limit: number): UniverseAuditEntry[] {
    return this.universeManager.readAudit(limit);
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

  private toErrorRoute<T>(error: unknown, data: T): MarketDataRouteResult<T> {
    return {
      status: 503,
      body: {
        source: "service",
        status: "error",
        degradedReason: summarizeError(error),
        stalenessSeconds: null,
        data,
      },
    };
  }
}

function resolveCompareProvider(rawCompareWith: string | undefined): string | null | undefined {
  const candidate = rawCompareWith?.trim().toLowerCase();
  if (!candidate) {
    return undefined;
  }
  if (!["alpaca", "schwab"].includes(candidate)) {
    return null;
  }
  return candidate;
}


function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const numeric = toNumber(value);
    if (numeric != null) {
      return numeric;
    }
  }
  return undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function resolveRepoPath(rawPath: string): string {
  if (path.isAbsolute(rawPath)) {
    return rawPath;
  }
  return path.join(repoRoot, rawPath);
}

function resolveOptionalRepoPath(rawPath: string): string | null {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return null;
  }
  return resolveRepoPath(trimmed);
}

function summarizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function startOfUtcDayIso(value: string): string {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

function isSameUtcDay(left: string, right: string): boolean {
  return startOfUtcDayIso(left) === startOfUtcDayIso(right);
}

function normalizeCryptoCacheKey(symbol: string): string {
  return extractCoinMarketCapSymbol(symbol) ?? symbol;
}

function upsertDailyHistoryRow(rows: MarketDataHistoryPoint[], nextRow: MarketDataHistoryPoint): MarketDataHistoryPoint[] {
  const nextDay = startOfUtcDayIso(nextRow.timestamp);
  const filtered = rows.filter((row) => startOfUtcDayIso(row.timestamp) !== nextDay);
  filtered.push({ ...nextRow, timestamp: nextDay });
  return filtered.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

function compressHistoryRows(rows: MarketDataHistoryPoint[], interval: HistoryInterval): MarketDataHistoryPoint[] {
  const buckets = new Map<string, MarketDataHistoryPoint[]>();
  for (const row of rows) {
    const timestamp = new Date(row.timestamp);
    const key =
      interval === "1wk"
        ? `${timestamp.getUTCFullYear()}-W${isoWeekNumber(timestamp)}`
        : `${timestamp.getUTCFullYear()}-${String(timestamp.getUTCMonth() + 1).padStart(2, "0")}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(row);
    buckets.set(key, bucket);
  }
  return [...buckets.values()].map((bucket) => {
    const ordered = bucket.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    return {
      timestamp: ordered[0].timestamp,
      open: ordered[0].open,
      high: Math.max(...ordered.map((row) => row.high)),
      low: Math.min(...ordered.map((row) => row.low)),
      close: ordered[ordered.length - 1].close,
      volume: ordered.reduce((sum, row) => sum + row.volume, 0),
    };
  });
}

function isoWeekNumber(date: Date): number {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const diff = target.getTime() - firstThursday.getTime();
  return 1 + Math.round(diff / 604_800_000);
}
