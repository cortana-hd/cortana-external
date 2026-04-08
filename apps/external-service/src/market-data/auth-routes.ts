import { marketDataErrorResponse } from "./route-utils.js";
import type { MarketDataRouteResult } from "./types.js";
import type { PendingSchwabAuthState } from "./schwab-auth.js";
import type { SchwabRestClient } from "./schwab-rest-client.js";

interface SchwabAuthRoutesConfig {
  redirectUrl: string;
  tokenPath: string;
  schwabRestClient: SchwabRestClient;
  getPendingState: () => PendingSchwabAuthState | null;
  setPendingState: (state: PendingSchwabAuthState | null) => void;
}

export class SchwabAuthRoutes {
  private readonly redirectUrl: string;
  private readonly tokenPath: string;
  private readonly schwabRestClient: SchwabRestClient;
  private readonly getPendingState: () => PendingSchwabAuthState | null;
  private readonly setPendingState: (state: PendingSchwabAuthState | null) => void;

  constructor(config: SchwabAuthRoutesConfig) {
    this.redirectUrl = config.redirectUrl;
    this.tokenPath = config.tokenPath;
    this.schwabRestClient = config.schwabRestClient;
    this.getPendingState = config.getPendingState;
    this.setPendingState = config.setPendingState;
  }

  async handleAuthUrl(): Promise<MarketDataRouteResult<Record<string, unknown>>> {
    if (!this.schwabRestClient.hasClientCredentials()) {
      return {
        status: 503,
        body: marketDataErrorResponse("schwab oauth is not configured", "degraded", {
          reason: "SCHWAB_CLIENT_ID and SCHWAB_CLIENT_SECRET are required",
        }),
      };
    }

    const pendingState = this.schwabRestClient.createPendingState();
    const state = pendingState.value;
    this.setPendingState(pendingState);

    return {
      status: 200,
      body: {
        source: "service",
        status: "ok",
        degradedReason: null,
        stalenessSeconds: 0,
        data: {
          url: this.schwabRestClient.createAuthorizationUrl(state),
          state,
          callbackUrl: this.redirectUrl,
          tokenPath: this.tokenPath,
        },
      },
    };
  }

  async handleAuthCallback(request: Request): Promise<MarketDataRouteResult<Record<string, unknown>>> {
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
    if (!this.isValidAuthState(state)) {
      return {
        status: 400,
        body: marketDataErrorResponse("schwab oauth state mismatch", "error", {
          reason: "Start again from /auth/schwab/url and complete the browser flow without restarting the service.",
        }),
      };
    }

    try {
      const token = await this.schwabRestClient.exchangeAuthorizationCode(code);
      this.setPendingState(null);
      return {
        status: 200,
        body: {
          source: "service",
          status: "ok",
          degradedReason: null,
          stalenessSeconds: 0,
          data: {
            message: "Schwab tokens saved successfully.",
            tokenPath: this.tokenPath,
            hasRefreshToken: Boolean(token.refreshToken),
            expiresAt: token.expiresAt ? new Date(token.expiresAt).toISOString() : null,
            callbackUrl: this.redirectUrl,
          },
        },
      };
    } catch (authError) {
      return {
        status: 502,
        body: marketDataErrorResponse("schwab token exchange failed", "degraded", {
          reason: summarizeError(authError),
        }),
      };
    }
  }

  async handleAuthStatus(): Promise<MarketDataRouteResult<Record<string, unknown>>> {
    return {
      status: 200,
      body: {
        source: "service",
        status: "ok",
        degradedReason: null,
        stalenessSeconds: 0,
        data: this.schwabRestClient.getStatus(this.getPendingState()),
      },
    };
  }

  canHandleState(state: string): boolean {
    return this.isValidAuthState(state);
  }

  private isValidAuthState(state: string): boolean {
    const pendingState = this.getPendingState();
    if (!state || !pendingState) {
      return false;
    }
    const ageMs = Date.now() - pendingState.createdAt;
    if (ageMs > 10 * 60 * 1000) {
      this.setPendingState(null);
      return false;
    }
    return pendingState.value === state;
  }
}

function summarizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
