import type { AppConfig } from "../config.js";
import type { AppLogger } from "../lib/logger.js";

import { SchwabAuthManager, type PendingSchwabAuthState } from "./schwab-auth.js";
import { SchwabMarketClient, type SchwabStreamerPreferences } from "./schwab-market-client.js";
import type { HistoryInterval } from "./history-utils.js";
import type { MarketDataHistoryPoint } from "./types.js";
import type { SchwabQuoteEnvelope } from "./schwab-normalizers.js";

export interface ProviderMetrics {
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

interface SchwabRestClientConfig {
  config: AppConfig;
  logger: AppLogger;
  tokenPath: string;
  providerMetrics: ProviderMetrics;
  fetchResponse: (input: string | URL, init?: RequestInit, timeoutMs?: number) => Promise<Response>;
  fetchJson: <T>(url: string, init?: RequestInit) => Promise<T>;
}

export class SchwabRestClient {
  private readonly auth: SchwabAuthManager;
  private readonly marketClient: SchwabMarketClient;
  private readonly providerMetrics: ProviderMetrics;
  private readonly schwabFailureThreshold: number;
  private readonly schwabCooldownMs: number;
  private schwabCooldownUntilMs = 0;

  constructor(config: SchwabRestClientConfig) {
    this.providerMetrics = config.providerMetrics;
    this.schwabFailureThreshold = config.config.MARKET_DATA_SCHWAB_FAILURE_THRESHOLD;
    this.schwabCooldownMs = config.config.MARKET_DATA_SCHWAB_COOLDOWN_MS;
    this.auth = new SchwabAuthManager({
      config: config.config,
      tokenPath: config.tokenPath,
      logger: config.logger,
      providerMetrics: config.providerMetrics,
      fetchResponse: config.fetchResponse,
      recordSchwabRestSuccess: this.recordSuccess.bind(this),
      recordSchwabRestFailure: this.recordFailure.bind(this),
    });
    this.marketClient = new SchwabMarketClient({
      config: config.config,
      accessTokenProvider: () => this.auth.getAccessToken(),
      fetchJson: config.fetchJson,
      recordSchwabRestSuccess: this.recordSuccess.bind(this),
    });
  }

  hasClientCredentials(): boolean {
    return this.auth.hasClientCredentials();
  }

  isConfigured(): boolean {
    return this.auth.isConfigured();
  }

  createPendingState(): PendingSchwabAuthState {
    return this.auth.createPendingState();
  }

  createAuthorizationUrl(state: string): string {
    return this.auth.createAuthorizationUrl(state);
  }

  getStatus(pendingState: PendingSchwabAuthState | null): Record<string, unknown> {
    return this.auth.getStatus(pendingState);
  }

  exchangeAuthorizationCode(code: string) {
    return this.auth.exchangeAuthorizationCode(code);
  }

  getAccessToken(): Promise<string> {
    return this.auth.getAccessToken();
  }

  fetchHistory(symbol: string, period: string, interval: HistoryInterval): Promise<MarketDataHistoryPoint[]> {
    return this.marketClient.fetchHistory(symbol, period, interval);
  }

  fetchQuoteEnvelope(symbol: string, asOfDate?: string): Promise<SchwabQuoteEnvelope> {
    return this.marketClient.fetchQuoteEnvelope(symbol, asOfDate);
  }

  fetchStreamerPreferences(): Promise<SchwabStreamerPreferences> {
    return this.marketClient.fetchStreamerPreferences();
  }

  recordFailure(error: unknown): void {
    this.providerMetrics.lastSchwabFailureAt = new Date().toISOString();
    this.providerMetrics.schwabConsecutiveFailures += 1;
    if (this.providerMetrics.schwabConsecutiveFailures >= this.schwabFailureThreshold) {
      this.schwabCooldownUntilMs = Date.now() + this.schwabCooldownMs;
      this.providerMetrics.schwabCooldownUntil = new Date(this.schwabCooldownUntilMs).toISOString();
    }
    if (error instanceof Error && error.message.includes("Manual re-authentication")) {
      this.providerMetrics.schwabTokenStatus = "human_action_required";
    }
  }

  recordSuccess(): void {
    this.providerMetrics.lastSuccessfulSchwabRestAt = new Date().toISOString();
    this.providerMetrics.lastSchwabFailureAt = null;
    this.providerMetrics.schwabConsecutiveFailures = 0;
    this.providerMetrics.schwabCooldownUntil = null;
    this.schwabCooldownUntilMs = 0;
  }

  isRestAvailable(): boolean {
    return !this.isUnavailable();
  }

  getUnavailableReason(): string {
    if (this.providerMetrics.schwabTokenStatus === "human_action_required") {
      return this.providerMetrics.schwabTokenReason ?? "Schwab credentials require manual re-authentication";
    }
    if (this.isCooldownOpen()) {
      return `Schwab REST cooldown open until ${this.providerMetrics.schwabCooldownUntil}`;
    }
    return "Schwab REST temporarily unavailable";
  }

  getOperatorState(): string {
    if (this.providerMetrics.schwabTokenStatus === "human_action_required") {
      return "human_action_required";
    }
    if (this.isCooldownOpen()) {
      return "provider_cooldown";
    }
    return "healthy";
  }

  getOperatorAction(): string {
    if (this.providerMetrics.schwabTokenStatus === "human_action_required") {
      return this.providerMetrics.schwabTokenReason ?? "Re-authorize Schwab access and refresh the cached refresh token.";
    }
    if (this.isCooldownOpen()) {
      return `Schwab REST is cooling down after repeated failures. Wait until ${this.providerMetrics.schwabCooldownUntil} or inspect upstream connectivity/auth.`;
    }
    return "No operator action required.";
  }

  private isUnavailable(): boolean {
    return this.providerMetrics.schwabTokenStatus === "human_action_required" || this.isCooldownOpen();
  }

  private isCooldownOpen(): boolean {
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
}
