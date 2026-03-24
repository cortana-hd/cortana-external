import {
  buildUnavailableCompare,
  marketDataErrorResponse,
  normalizeMarketSymbol,
  parseBatchSymbols,
  resolveQuery,
} from "./route-utils.js";
import { normalizeHistoryInterval, normalizeHistoryProvider } from "./history-utils.js";
import type {
  MarketDataGenericPayload,
  MarketDataHistory,
  MarketDataQuote,
  MarketDataRouteResult,
  MarketDataSnapshot,
} from "./types.js";
import type { ProviderChain } from "./provider-chain.js";

const DEFAULT_INTERVAL = "1d";

interface QueryRoutesConfig {
  providerChain: ProviderChain;
  ensureRuntimeReady: () => Promise<void>;
  toErrorRoute: <T>(error: unknown, data: T) => MarketDataRouteResult<T>;
  toBatchRouteResult: (items: Array<Record<string, unknown>>) => MarketDataRouteResult<Record<string, unknown>>;
}

export class MarketDataQueryRoutes {
  private readonly providerChain: ProviderChain;
  private readonly ensureRuntimeReady: () => Promise<void>;
  private readonly toErrorRoute: QueryRoutesConfig["toErrorRoute"];
  private readonly toBatchRouteResult: QueryRoutesConfig["toBatchRouteResult"];

  constructor(config: QueryRoutesConfig) {
    this.providerChain = config.providerChain;
    this.ensureRuntimeReady = config.ensureRuntimeReady;
    this.toErrorRoute = config.toErrorRoute;
    this.toBatchRouteResult = config.toBatchRouteResult;
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
      const primary = await this.providerChain.fetchPrimaryHistory(symbol, period, interval, provider);
      this.providerChain.recordSourceUsage(primary.source);
      const compareProvider = resolveCompareProvider(compareWith);
      if (compareProvider === null) {
        return invalidCompareProvider<MarketDataHistory>();
      }
      const compare = await this.providerChain.buildHistoryComparison(symbol, period, interval, compareProvider ?? undefined, primary.rows);
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
      return this.toErrorRoute(error, { symbol, period, interval, rows: [] });
    }
  }

  async handleQuote(_request: Request, rawSymbol: string, compareWith?: string): Promise<MarketDataRouteResult<MarketDataQuote>> {
    await this.ensureRuntimeReady();
    const symbol = normalizeMarketSymbol(rawSymbol);
    if (!symbol) {
      return { status: 400, body: marketDataErrorResponse("invalid symbol", "error", { reason: "symbol required" }) };
    }
    try {
      const primary = await this.providerChain.fetchPrimaryQuote(symbol);
      this.providerChain.recordSourceUsage(primary.source);
      const compareProvider = resolveCompareProvider(compareWith);
      if (compareProvider === null) {
        return invalidCompareProvider<MarketDataQuote>();
      }
      const compare = await this.providerChain.buildQuoteComparison(symbol, compareProvider ?? undefined, primary.quote);
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
      return this.toErrorRoute(error, { symbol });
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
      return invalidCompareProvider();
    }
    const items = await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const primary = await this.providerChain.fetchPrimaryQuote(symbol);
          this.providerChain.recordSourceUsage(primary.source);
          const compare = await this.providerChain.buildQuoteComparison(symbol, compareProvider ?? undefined, primary.quote);
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

  async handleSnapshot(_request: Request, rawSymbol: string, compareWith?: string): Promise<MarketDataRouteResult<MarketDataSnapshot>> {
    await this.ensureRuntimeReady();
    const symbol = normalizeMarketSymbol(rawSymbol);
    if (!symbol) {
      return { status: 400, body: marketDataErrorResponse("invalid symbol", "error", { reason: "symbol required" }) };
    }
    try {
      const primary = await this.providerChain.fetchPrimarySnapshot(symbol);
      this.providerChain.recordSourceUsage(primary.source);
      const compareProvider = resolveCompareProvider(compareWith);
      if (compareProvider === null) {
        return invalidCompareProvider<MarketDataSnapshot>();
      }
      const compare = await this.providerChain.buildQuoteComparison(symbol, compareProvider ?? undefined, primary.snapshot.quote as MarketDataQuote | undefined);
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
      return this.toErrorRoute(error, { symbol, quote: {}, fundamentals: {}, metadata: {} });
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
          const primary = await this.providerChain.fetchPrimaryHistory(symbol, period, interval, provider);
          this.providerChain.recordSourceUsage(primary.source);
          const compare = await this.providerChain.buildHistoryComparison(symbol, period, interval, compareWith, primary.rows);
          return {
            symbol,
            source: primary.source,
            status: primary.status,
            degradedReason: primary.degradedReason ?? null,
            stalenessSeconds: primary.stalenessSeconds,
            data: { symbol, period, interval, rows: primary.rows, comparisonHint: compare?.source },
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

  async handleFundamentals(request: Request, rawSymbol: string, compareWith?: string): Promise<MarketDataRouteResult<MarketDataGenericPayload>> {
    const symbol = normalizeMarketSymbol(rawSymbol);
    if (!symbol) {
      return { status: 400, body: marketDataErrorResponse("invalid symbol", "error", { reason: "symbol required" }) };
    }
    try {
      const asOfDate = resolveQuery(request.url, "as_of_date", "");
      const primary = await this.providerChain.fetchPrimaryFundamentals(symbol, asOfDate || undefined);
      this.providerChain.recordSourceUsage(primary.source);
      const compareProvider = resolveCompareProvider(compareWith);
      if (compareProvider === null) {
        return invalidCompareProvider<MarketDataGenericPayload>();
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
      return this.toErrorRoute(error, { symbol, payload: {} });
    }
  }

  async handleMetadata(_request: Request, rawSymbol: string, compareWith?: string): Promise<MarketDataRouteResult<MarketDataGenericPayload>> {
    const symbol = normalizeMarketSymbol(rawSymbol);
    if (!symbol) {
      return { status: 400, body: marketDataErrorResponse("invalid symbol", "error", { reason: "symbol required" }) };
    }
    try {
      const payload = await this.providerChain.fetchPrimaryMetadata(symbol);
      const compareProvider = resolveCompareProvider(compareWith);
      if (compareProvider === null) {
        return invalidCompareProvider<MarketDataGenericPayload>();
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
      return this.toErrorRoute(error, { symbol, payload: {} });
    }
  }

  async handleNews(_request: Request, rawSymbol: string, compareWith?: string): Promise<MarketDataRouteResult<MarketDataGenericPayload>> {
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

function invalidCompareProvider<T>(): MarketDataRouteResult<T> {
  return {
    status: 400,
    body: marketDataErrorResponse("invalid compare provider", "error", {
      reason: "unsupported compare_with provider; supported providers are schwab and alpaca",
    }),
  };
}

function summarizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
