import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { AppConfig } from "../config.js";
import { HttpError, readJsonResponse } from "../lib/http.js";
import type { AppLogger } from "../lib/logger.js";

export interface CachedTokenPayload {
  accessToken?: string;
  expiresAt?: number;
  refreshToken?: string;
  refreshTokenIssuedAt?: string | null;
  lastAuthorizationCodeAt?: string | null;
}

export interface PendingSchwabAuthState {
  value: string;
  createdAt: number;
}

interface SchwabProviderMetricsLike {
  tokenRefreshInFlight: boolean;
  lastTokenRefreshAt: string | null;
  lastTokenRefreshFailureAt: string | null;
  schwabTokenStatus: "ready" | "human_action_required";
  schwabTokenReason: string | null;
}

interface SchwabAuthManagerConfig {
  config: AppConfig;
  tokenPath: string;
  logger: AppLogger;
  providerMetrics: SchwabProviderMetricsLike;
  fetchResponse: (input: string | URL, init?: RequestInit, timeoutMs?: number) => Promise<Response>;
  recordSchwabRestSuccess: () => void;
  recordSchwabRestFailure: (error: unknown) => void;
}

export class SchwabAuthManager {
  private readonly config: AppConfig;
  private readonly tokenPath: string;
  private readonly logger: AppLogger;
  private readonly providerMetrics: SchwabProviderMetricsLike;
  private readonly fetchResponse: SchwabAuthManagerConfig["fetchResponse"];
  private readonly recordSchwabRestSuccess: () => void;
  private readonly recordSchwabRestFailure: (error: unknown) => void;
  private tokenRefreshPromise: Promise<string> | null = null;

  constructor(config: SchwabAuthManagerConfig) {
    this.config = config.config;
    this.tokenPath = config.tokenPath;
    this.logger = config.logger;
    this.providerMetrics = config.providerMetrics;
    this.fetchResponse = config.fetchResponse;
    this.recordSchwabRestSuccess = config.recordSchwabRestSuccess;
    this.recordSchwabRestFailure = config.recordSchwabRestFailure;
  }

  createPendingState(): PendingSchwabAuthState {
    return {
      value: randomUUID(),
      createdAt: Date.now(),
    };
  }

  createAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.SCHWAB_CLIENT_ID.trim(),
      redirect_uri: this.config.SCHWAB_REDIRECT_URL,
      response_type: "code",
      state,
    });
    return `${this.config.SCHWAB_AUTH_URL}?${params.toString()}`;
  }

  hasClientCredentials(): boolean {
    return Boolean(this.config.SCHWAB_CLIENT_ID.trim() && this.config.SCHWAB_CLIENT_SECRET.trim());
  }

  isConfigured(): boolean {
    return Boolean(this.hasClientCredentials() && this.getRefreshToken(this.readCachedToken()));
  }

  getStatus(pendingState: PendingSchwabAuthState | null): Record<string, unknown> {
    const cached = this.readCachedToken();
    const refreshToken = this.getRefreshToken(cached);
    return {
      clientConfigured: this.hasClientCredentials(),
      refreshTokenPresent: Boolean(refreshToken),
      tlsConfigured: Boolean(
        this.config.EXTERNAL_SERVICE_TLS_CERT_PATH.trim() && this.config.EXTERNAL_SERVICE_TLS_KEY_PATH.trim(),
      ),
      tokenPath: this.tokenPath,
      redirectUrl: this.config.SCHWAB_REDIRECT_URL,
      authUrl: this.config.SCHWAB_AUTH_URL,
      accessTokenExpiresAt:
        cached?.expiresAt && cached.expiresAt > 0 ? new Date(cached.expiresAt).toISOString() : null,
      refreshTokenIssuedAt: cached?.refreshTokenIssuedAt ?? null,
      lastAuthorizationCodeAt: cached?.lastAuthorizationCodeAt ?? null,
      pendingStateIssuedAt: pendingState != null ? new Date(pendingState.createdAt).toISOString() : null,
    };
  }

  async getAccessToken(): Promise<string> {
    const cached = this.readCachedToken();
    if (cached?.accessToken && cached.expiresAt && cached.expiresAt > Date.now() + 60_000) {
      return cached.accessToken;
    }
    if (this.tokenRefreshPromise) {
      return this.tokenRefreshPromise;
    }

    this.providerMetrics.tokenRefreshInFlight = true;
    this.tokenRefreshPromise = (async () => {
      const refreshToken = this.getRefreshToken(cached);
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
      let payload: Record<string, unknown>;
      try {
        payload = await readJsonResponse<Record<string, unknown>>(response);
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
      this.writeCachedToken({
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

  async exchangeAuthorizationCode(code: string): Promise<CachedTokenPayload> {
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
    const payload = await readJsonResponse<Record<string, unknown>>(response);
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
    this.writeCachedToken(token);
    this.providerMetrics.lastTokenRefreshAt = new Date().toISOString();
    this.providerMetrics.schwabTokenStatus = "ready";
    this.providerMetrics.schwabTokenReason = null;
    this.recordSchwabRestSuccess();
    return token;
  }

  readCachedToken(): CachedTokenPayload | null {
    try {
      const raw = fs.readFileSync(this.tokenPath, "utf8");
      const payload = JSON.parse(raw) as CachedTokenPayload;
      if (!payload || typeof payload !== "object") {
        return null;
      }
      return payload;
    } catch {
      return null;
    }
  }

  getRefreshToken(cached: CachedTokenPayload | null): string {
    return String(cached?.refreshToken ?? this.config.SCHWAB_REFRESH_TOKEN ?? "").trim();
  }

  private writeCachedToken(payload: CachedTokenPayload): void {
    try {
      fs.mkdirSync(path.dirname(this.tokenPath), { recursive: true });
      fs.writeFileSync(this.tokenPath, JSON.stringify(payload, null, 2));
    } catch (error) {
      this.logger.error("Unable to persist Schwab token cache", error);
    }
  }
}
