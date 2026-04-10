import path from "node:path";

import { extractCoinMarketCapSymbol } from "./coinmarketcap-client.js";
import { marketDataErrorResponse, resolveQuery } from "./route-utils.js";
import type { CoinMarketCapService } from "./coinmarketcap-service.js";
import type { UniverseArtifactManager } from "./universe-manager.js";
import type {
  MarketDataRiskHistory,
  MarketDataRiskSnapshot,
  MarketDataRouteResult,
  MarketDataUniverse,
} from "./types.js";
import type { RiskPayloadResult } from "./risk-stack.js";

interface SupportRoutesConfig {
  cacheDir: string;
  coinMarketCap: CoinMarketCapService;
  universeManager: UniverseArtifactManager;
  onUniverseArtifactLoaded: (updatedAt: string) => void;
  buildRiskPayload: (days: number) => Promise<RiskPayloadResult>;
  toErrorRoute: <T>(error: unknown, data: T) => MarketDataRouteResult<T>;
}

export class MarketDataSupportRoutes {
  private readonly cacheDir: string;
  private readonly coinMarketCap: CoinMarketCapService;
  private readonly universeManager: UniverseArtifactManager;
  private readonly onUniverseArtifactLoaded: (updatedAt: string) => void;
  private readonly buildRiskPayloadFn: (days: number) => Promise<RiskPayloadResult>;
  private readonly toErrorRoute: SupportRoutesConfig["toErrorRoute"];

  constructor(config: SupportRoutesConfig) {
    this.cacheDir = config.cacheDir;
    this.coinMarketCap = config.coinMarketCap;
    this.universeManager = config.universeManager;
    this.onUniverseArtifactLoaded = config.onUniverseArtifactLoaded;
    this.buildRiskPayloadFn = config.buildRiskPayload;
    this.toErrorRoute = config.toErrorRoute;
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
    if (!this.coinMarketCap.isConfigured()) {
      return {
        status: 503,
        body: marketDataErrorResponse("coinmarketcap unavailable", "degraded", {
          reason: "COINMARKETCAP_API_KEY is required for direct crypto refresh",
        }),
      };
    }
    try {
      const result = await this.coinMarketCap.refreshDailyCache(symbols, ["1", "true", "yes", "on"].includes(force));
      return {
        status: 200,
        body: {
          source: "service",
          status: "ok",
          degradedReason: null,
          stalenessSeconds: 0,
          providerMode: "coinmarketcap_primary",
          fallbackEngaged: false,
          providerModeReason: "Direct crypto refresh uses the CoinMarketCap primary lane.",
          data: result,
        },
      };
    } catch (error) {
      return this.toErrorRoute(error, { symbols, refreshed: [] });
    }
  }

  async handleUniverseBase(): Promise<MarketDataRouteResult<MarketDataUniverse>> {
    try {
      const payload = await this.universeManager.loadOrRefreshArtifact(false);
      if (payload.updatedAt) {
        this.onUniverseArtifactLoaded(payload.updatedAt);
      }
      return {
        status: 200,
        body: {
          source: payload.source,
          status: "ok",
          degradedReason: null,
          stalenessSeconds: secondsSince(payload.updatedAt),
          providerMode: "cache_fallback",
          fallbackEngaged: true,
          providerModeReason: "Universe artifact is served from the local cached ownership lane.",
          data: payload,
        },
      };
    } catch (error) {
      return this.toErrorRoute(error, { symbols: [], source: "error", updatedAt: null });
    }
  }

  async handleUniverseRefresh(): Promise<MarketDataRouteResult<MarketDataUniverse>> {
    try {
      const payload = await this.universeManager.loadOrRefreshArtifact(true);
      if (payload.updatedAt) {
        this.onUniverseArtifactLoaded(payload.updatedAt);
      }
      return {
        status: 200,
        body: {
          source: payload.source,
          status: "ok",
          degradedReason: null,
          stalenessSeconds: 0,
          providerMode: "cache_fallback",
          fallbackEngaged: true,
          providerModeReason: "Universe refresh writes and serves the local ownership artifact.",
          data: payload,
        },
      };
    } catch (error) {
      return this.toErrorRoute(error, { symbols: [], source: "error", updatedAt: null });
    }
  }

  handleUniverseAudit(request: Request): MarketDataRouteResult<Record<string, unknown>> {
    const limit = Math.max(parseInt(resolveQuery(request.url, "limit", "20"), 10) || 20, 1);
    const audit = this.universeManager.readAudit(limit);
    return {
      status: 200,
      body: {
        source: "service",
        status: "ok",
        degradedReason: null,
        stalenessSeconds: 0,
        providerMode: "cache_fallback",
        fallbackEngaged: true,
        providerModeReason: "Universe audit reads from the local artifact lane.",
        data: { entries: audit },
      },
    };
  }

  async handleRiskHistory(request: Request): Promise<MarketDataRouteResult<MarketDataRiskHistory>> {
    const days = Math.max(parseInt(resolveQuery(request.url, "days", "90"), 10) || 90, 5);
    try {
      const payload = await this.buildRiskPayloadFn(days);
      return {
        status: 200,
        body: {
          source: payload.meta.source,
          status: payload.meta.status,
          degradedReason: payload.meta.degradedReason ?? null,
          stalenessSeconds: payload.meta.stalenessSeconds,
          providerMode: "schwab_primary",
          fallbackEngaged: false,
          providerModeReason: "Risk history uses the macro risk stack primary lane.",
          data: { rows: payload.rows as unknown as Array<Record<string, unknown>> },
        },
      };
    } catch (error) {
      return this.toErrorRoute(error, { rows: [] });
    }
  }

  async handleRiskSnapshot(): Promise<MarketDataRouteResult<MarketDataRiskSnapshot>> {
    try {
      const payload = await this.buildRiskPayloadFn(200);
      const latest = payload.rows[payload.rows.length - 1];
      const warnings = payload.warning ? [payload.warning] : [];
      return {
        status: 200,
        body: {
          source: payload.meta.source,
          status: payload.meta.status,
          degradedReason: payload.meta.degradedReason ?? null,
          stalenessSeconds: payload.meta.stalenessSeconds,
          providerMode: "schwab_primary",
          fallbackEngaged: false,
          providerModeReason: "Risk snapshot uses the macro risk stack primary lane.",
          data: {
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
          },
        },
      };
    } catch (error) {
      return this.toErrorRoute(error, { snapshotDate: new Date().toISOString(), mFactor: 50, warnings: [] });
    }
  }
}

function secondsSince(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return Math.max(Math.round((Date.now() - parsed) / 1000), 0);
}
