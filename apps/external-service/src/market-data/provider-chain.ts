import { buildUnavailableCompare } from "./route-utils.js";
import { extractCoinMarketCapSymbol } from "./coinmarketcap-client.js";
import type { CoinMarketCapService } from "./coinmarketcap-service.js";
import type { AlpacaClient } from "./alpaca-client.js";
import type { SchwabRestClient, ProviderMetrics } from "./schwab-rest-client.js";
import type { SchwabStreamerRuntime } from "./schwab-streamer-runtime.js";
import { compareHistoryRows, compareQuotes, type HistoryInterval, type HistoryProvider } from "./history-utils.js";
import type {
  MarketDataComparison,
  MarketDataGenericPayload,
  MarketDataHistoryPoint,
  MarketDataProviderMode,
  MarketDataQuote,
  MarketDataSnapshot,
  MarketDataStatus,
} from "./types.js";

interface ServiceMetadata {
  source: string;
  status: MarketDataStatus;
  degradedReason?: string | null;
  stalenessSeconds: number | null;
  providerMode: MarketDataProviderMode;
  fallbackEngaged: boolean;
  providerModeReason?: string | null;
}

export interface HistoryFetchResult extends ServiceMetadata {
  rows: MarketDataHistoryPoint[];
}

export interface QuoteFetchResult extends ServiceMetadata {
  quote: MarketDataQuote;
}

export interface SnapshotFetchResult extends ServiceMetadata {
  snapshot: MarketDataSnapshot;
}

export interface ProviderRouteContext {
  subsystem?: string;
  allowAlpacaFallback?: boolean;
  preferLiveSchwabLane?: boolean;
}

interface ProviderChainConfig {
  coinMarketCap: CoinMarketCapService;
  schwabRestClient: SchwabRestClient;
  alpacaClient: AlpacaClient;
  streamerRuntime: SchwabStreamerRuntime;
  providerMetrics: ProviderMetrics;
}

export class ProviderChain {
  private readonly coinMarketCap: CoinMarketCapService;
  private readonly schwabRestClient: SchwabRestClient;
  private readonly alpacaClient: AlpacaClient;
  private readonly streamerRuntime: SchwabStreamerRuntime;
  private readonly providerMetrics: ProviderMetrics;

  constructor(config: ProviderChainConfig) {
    this.coinMarketCap = config.coinMarketCap;
    this.schwabRestClient = config.schwabRestClient;
    this.alpacaClient = config.alpacaClient;
    this.streamerRuntime = config.streamerRuntime;
    this.providerMetrics = config.providerMetrics;
  }

  async fetchPrimaryHistory(
    symbol: string,
    period: string,
    interval: HistoryInterval,
    provider: HistoryProvider = "service",
    context: ProviderRouteContext = {},
  ): Promise<HistoryFetchResult> {
    if (extractCoinMarketCapSymbol(symbol)) {
      if (provider !== "service") {
        throw new Error(`provider '${provider}' is not supported for crypto symbol ${symbol}`);
      }
      if (!this.coinMarketCap.isConfigured()) {
        throw new Error("CoinMarketCap API key is not configured");
      }
      const rows = await this.coinMarketCap.fetchHistory(symbol, period, interval);
      return {
        source: "coinmarketcap",
        status: "ok",
        stalenessSeconds: 0,
        providerMode: "coinmarketcap_primary",
        fallbackEngaged: false,
        providerModeReason: "Crypto history stayed on the CoinMarketCap primary lane.",
        rows,
      };
    }
    if (provider === "schwab") {
      if (!this.schwabRestClient.isConfigured()) {
        throw new Error("Schwab credentials are not configured");
      }
      const rows = await this.schwabRestClient.fetchHistory(symbol, period, interval);
      return {
        source: "schwab",
        status: "ok",
        stalenessSeconds: 0,
        providerMode: "schwab_primary",
        fallbackEngaged: false,
        providerModeReason: "History stayed on the explicit Schwab primary lane.",
        rows,
      };
    }
    if (provider === "alpaca") {
      const rows = await this.alpacaClient.fetchHistory(symbol, period, interval);
      return {
        source: "alpaca",
        status: "ok",
        stalenessSeconds: 0,
        providerMode: "alpaca_fallback",
        fallbackEngaged: true,
        providerModeReason: "History used the explicit Alpaca fallback lane.",
        rows,
      };
    }
    if (context.allowAlpacaFallback && !this.schwabRestClient.isRestAvailable()) {
      return this.fetchAlpacaHistoryFallback(symbol, period, interval, context);
    }
    if (!this.schwabRestClient.isConfigured()) {
      throw new Error("Schwab credentials are not configured");
    }
    if (!this.schwabRestClient.isRestAvailable()) {
      throw new Error(this.schwabRestClient.getUnavailableReason());
    }
    try {
      const rows = await this.schwabRestClient.fetchHistory(symbol, period, interval);
      return {
        source: "schwab",
        status: "ok",
        stalenessSeconds: 0,
        providerMode: "schwab_primary",
        fallbackEngaged: false,
        providerModeReason: "History stayed on the Schwab primary lane.",
        rows,
      };
    } catch (error) {
      this.schwabRestClient.recordFailure(error);
      if (context.allowAlpacaFallback && !this.schwabRestClient.isRestAvailable()) {
        return this.fetchAlpacaHistoryFallback(symbol, period, interval, context);
      }
      throw error;
    }
  }

  async fetchPrimaryQuote(symbol: string, context: ProviderRouteContext = {}): Promise<QuoteFetchResult> {
    await this.streamerRuntime.enforceFailurePolicy();
    if (extractCoinMarketCapSymbol(symbol)) {
      if (!this.coinMarketCap.isConfigured()) {
        throw new Error("CoinMarketCap API key is not configured");
      }
      const quote = await this.coinMarketCap.fetchQuote(symbol);
      return {
        source: "coinmarketcap",
        status: "ok",
        stalenessSeconds: 0,
        providerMode: "coinmarketcap_primary",
        fallbackEngaged: false,
        providerModeReason: "Crypto quote stayed on the CoinMarketCap primary lane.",
        quote,
      };
    }
    const isFuturesSymbol = symbol.startsWith("/");
    if (!this.schwabRestClient.isConfigured()) {
      throw new Error("Schwab credentials are not configured");
    }
    try {
      const streamer = this.streamerRuntime.getStreamer();
      const streamed = isFuturesSymbol
        ? await streamer?.getFuturesQuote(symbol)
        : await streamer?.getQuote(symbol);
      if (streamed?.price != null) {
        return {
          source: "schwab_streamer",
          status: "ok",
          stalenessSeconds: 0,
          providerMode: "schwab_primary",
          fallbackEngaged: false,
          providerModeReason: "Quote used the Schwab streamer primary lane.",
          quote: streamed,
        };
      }
    } catch {
      // Shared state / REST fallback below remains the source of truth when streamer reads fail.
    }
    const shared = isFuturesSymbol
      ? await this.streamerRuntime.readSharedFuturesQuote(symbol)
      : await this.streamerRuntime.readSharedQuote(symbol);
    if (shared?.price != null) {
      return {
        source: "schwab_streamer_shared",
        status: "ok",
        stalenessSeconds: 0,
        providerMode: "schwab_primary",
        fallbackEngaged: false,
        providerModeReason: "Quote used the shared Schwab streamer state.",
        quote: shared,
      };
    }
    const afterHoursStale = await this.readAfterHoursStaleSchwabQuote(symbol, context);
    if (afterHoursStale) {
      return afterHoursStale;
    }
    if (context.preferLiveSchwabLane) {
      if (!this.schwabRestClient.isRestAvailable()) {
        throw new Error(this.schwabRestClient.getUnavailableReason());
      }
      try {
        const quote = (await this.schwabRestClient.fetchQuoteEnvelope(symbol)).quote;
        return {
          source: "schwab",
          status: "ok",
          stalenessSeconds: 0,
          providerMode: "schwab_primary",
          fallbackEngaged: false,
          providerModeReason: "Quote used the Schwab REST primary lane after streamer/shared state was unavailable.",
          quote,
        };
      } catch (error) {
        this.schwabRestClient.recordFailure(error);
        throw error;
      }
    }
    if (context.allowAlpacaFallback && this.isAlpacaSupportedSymbol(symbol) && !this.schwabRestClient.isRestAvailable()) {
      return this.fetchAlpacaQuoteFallback(symbol, context);
    }
    if (isFuturesSymbol) {
      throw new Error(`No live Schwab futures quote available for ${symbol}`);
    }
    if (!this.schwabRestClient.isRestAvailable()) {
      throw new Error(this.schwabRestClient.getUnavailableReason());
    }
    try {
      const quote = (await this.schwabRestClient.fetchQuoteEnvelope(symbol)).quote;
      return {
        source: "schwab",
        status: "ok",
        stalenessSeconds: 0,
        providerMode: "schwab_primary",
        fallbackEngaged: false,
        providerModeReason: "Quote used the Schwab REST primary lane.",
        quote,
      };
    } catch (error) {
      this.schwabRestClient.recordFailure(error);
      if (context.allowAlpacaFallback && this.isAlpacaSupportedSymbol(symbol) && !this.schwabRestClient.isRestAvailable()) {
        return this.fetchAlpacaQuoteFallback(symbol, context);
      }
      throw error;
    }
  }

  async fetchSchwabLiveQuoteOnly(
    symbol: string,
    options: { allowAfterHoursStale?: boolean } = {},
  ): Promise<QuoteFetchResult | null> {
    await this.streamerRuntime.enforceFailurePolicy();
    if (extractCoinMarketCapSymbol(symbol)) {
      return null;
    }
    const isFuturesSymbol = symbol.startsWith("/");
    const streamer = this.streamerRuntime.getStreamer();
    try {
      const streamed = isFuturesSymbol
        ? await streamer?.getFuturesQuote(symbol)
        : await streamer?.getQuote(symbol);
      if (streamed?.price != null) {
        return {
          source: "schwab_streamer",
          status: "ok",
          stalenessSeconds: 0,
          providerMode: "schwab_primary",
          fallbackEngaged: false,
          providerModeReason: "Quote used the Schwab streamer primary lane.",
          quote: streamed,
        };
      }
    } catch {
      // Shared-state check below remains the next Schwab-primary lane.
    }
    const shared = isFuturesSymbol
      ? await this.streamerRuntime.readSharedFuturesQuote(symbol)
      : await this.streamerRuntime.readSharedQuote(symbol);
    if (shared?.price != null) {
      return {
        source: "schwab_streamer_shared",
        status: "ok",
        stalenessSeconds: 0,
        providerMode: "schwab_primary",
        fallbackEngaged: false,
        providerModeReason: "Quote used the shared Schwab streamer state.",
        quote: shared,
      };
    }
    if (options.allowAfterHoursStale) {
      const afterHoursStale = await this.readAfterHoursStaleSchwabQuote(symbol, {
        subsystem: "live_watchlists",
        preferLiveSchwabLane: true,
      });
      if (afterHoursStale) {
        return afterHoursStale;
      }
    }
    return null;
  }

  isSchwabRestAvailable(): boolean {
    return this.schwabRestClient.isRestAvailable();
  }

  async fetchPrimarySnapshot(symbol: string): Promise<SnapshotFetchResult> {
    const quote = await this.fetchPrimaryQuote(symbol);
    const streamer = this.streamerRuntime.getStreamer();
    const chartEquity =
      symbol.startsWith("/")
        ? null
        : (await streamer?.getChartEquity(symbol).catch(() => null)) ?? (await this.streamerRuntime.readSharedChart(symbol));
    const [metadata, fundamentals] = await Promise.all([
      symbol.startsWith("/")
        ? Promise.resolve({})
        : this.fetchPrimaryMetadata(symbol).then((result) => result.payload).catch(() => ({})),
      symbol.startsWith("/")
        ? Promise.resolve({})
        : this.fetchPrimaryFundamentals(symbol).then((result) => result.payload).catch(() => ({})),
    ]);
    return {
      source: quote.source,
      status: quote.status,
      degradedReason: quote.degradedReason ?? null,
      stalenessSeconds: quote.stalenessSeconds,
      providerMode: quote.providerMode,
      fallbackEngaged: quote.fallbackEngaged,
      providerModeReason: quote.providerModeReason ?? null,
      snapshot: {
        symbol,
        quote: quote.quote as unknown as Record<string, unknown>,
        metadata,
        fundamentals,
        ...(chartEquity ? { chartEquity } : {}),
      },
    };
  }

  async fetchPrimaryFundamentals(symbol: string, asOfDate?: string): Promise<ServiceMetadata & { payload: Record<string, unknown> }> {
    if (extractCoinMarketCapSymbol(symbol)) {
      if (!this.coinMarketCap.isConfigured()) {
        throw new Error("CoinMarketCap API key is not configured");
      }
      const payload = await this.coinMarketCap.fetchFundamentals(symbol);
      return {
        source: "coinmarketcap",
        status: "ok",
        degradedReason: null,
        stalenessSeconds: 0,
        providerMode: "coinmarketcap_primary",
        fallbackEngaged: false,
        providerModeReason: "Fundamentals stayed on the CoinMarketCap primary lane.",
        payload,
      };
    }
    const reasons: string[] = [];
    const targetAsOfDate = asOfDate || new Date().toISOString().slice(0, 10);
    let schwabPayload: Record<string, unknown> = {};
    if (this.schwabRestClient.isConfigured()) {
      if (!this.schwabRestClient.isRestAvailable()) {
        reasons.push(this.schwabRestClient.getUnavailableReason());
      } else {
        try {
          schwabPayload = (await this.schwabRestClient.fetchQuoteEnvelope(symbol, targetAsOfDate)).fundamentals;
        } catch (error) {
          this.schwabRestClient.recordFailure(error);
          reasons.push(summarizeError(error));
        }
      }
    }
    if (Object.keys(schwabPayload).length) {
      return {
        source: "schwab",
        status: reasons.length ? "degraded" : "ok",
        degradedReason: reasons.length ? reasons[0] : null,
        stalenessSeconds: 0,
        providerMode: "schwab_primary",
        fallbackEngaged: false,
        providerModeReason: "Fundamentals stayed on the Schwab-primary-or-cache lane.",
        payload: schwabPayload,
      };
    }
    throw new Error(reasons[0] ?? `Unable to fetch fundamentals for ${symbol}`);
  }

  async fetchPrimaryMetadata(symbol: string): Promise<ServiceMetadata & { payload: Record<string, unknown> }> {
    if (extractCoinMarketCapSymbol(symbol)) {
      if (!this.coinMarketCap.isConfigured()) {
        throw new Error("CoinMarketCap API key is not configured");
      }
      return {
        source: "coinmarketcap",
        status: "ok",
        degradedReason: null,
        stalenessSeconds: 0,
        providerMode: "coinmarketcap_primary",
        fallbackEngaged: false,
        providerModeReason: "Metadata stayed on the CoinMarketCap primary lane.",
        payload: await this.coinMarketCap.fetchMetadata(symbol),
      };
    }
    const reasons: string[] = [];
    let schwabPayload: Record<string, unknown> = {};
    if (this.schwabRestClient.isConfigured()) {
      if (!this.schwabRestClient.isRestAvailable()) {
        reasons.push(this.schwabRestClient.getUnavailableReason());
      } else {
        try {
          schwabPayload = (await this.schwabRestClient.fetchQuoteEnvelope(symbol)).metadata;
        } catch (error) {
          this.schwabRestClient.recordFailure(error);
          reasons.push(summarizeError(error));
        }
      }
    }
    if (Object.keys(schwabPayload).length) {
      return {
        source: "schwab",
        status: "ok",
        degradedReason: reasons.length ? reasons[0] : null,
        stalenessSeconds: 0,
        providerMode: "schwab_primary",
        fallbackEngaged: false,
        providerModeReason: "Metadata stayed on the Schwab-primary-or-cache lane.",
        payload: schwabPayload,
      };
    }
    throw new Error(reasons[0] ?? `Unable to fetch metadata for ${symbol}`);
  }

  async buildHistoryComparison(symbol: string, period: string, interval: HistoryInterval, compareWith: string | undefined, primaryRows: MarketDataHistoryPoint[]): Promise<MarketDataComparison | undefined> {
    const source = compareWith;
    if (!source) {
      return undefined;
    }
    try {
      let rows: MarketDataHistoryPoint[];
      if (source === "schwab") {
        if (!this.schwabRestClient.isConfigured()) {
          return buildUnavailableCompare(source, "Schwab credentials are not configured");
        }
        rows = await this.schwabRestClient.fetchHistory(symbol, period, interval);
      } else if (source === "alpaca") {
        rows = await this.alpacaClient.fetchHistory(symbol, period, interval);
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

  async buildQuoteComparison(symbol: string, compareWith: string | undefined, primaryQuote: MarketDataQuote | undefined): Promise<MarketDataComparison | undefined> {
    const source = compareWith;
    if (!source || !primaryQuote) {
      return undefined;
    }
    try {
      let quote: MarketDataQuote;
      if (source === "schwab") {
        if (!this.schwabRestClient.isConfigured()) {
          return buildUnavailableCompare(source, "Schwab credentials are not configured");
        }
        quote = (await this.schwabRestClient.fetchQuoteEnvelope(symbol)).quote;
      } else if (source === "alpaca") {
        quote = await this.alpacaClient.fetchQuote(symbol);
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

  recordSourceUsage(source: string): void {
    this.providerMetrics.sourceUsage[source] = (this.providerMetrics.sourceUsage[source] ?? 0) + 1;
  }

  private isAlpacaSupportedSymbol(symbol: string): boolean {
    return !extractCoinMarketCapSymbol(symbol) && !symbol.startsWith("/");
  }

  private async fetchAlpacaHistoryFallback(
    symbol: string,
    period: string,
    interval: HistoryInterval,
    context: ProviderRouteContext,
  ): Promise<HistoryFetchResult> {
    if (!this.isAlpacaSupportedSymbol(symbol)) {
      throw new Error(`Alpaca fallback is not supported for ${symbol}`);
    }
    const rows = await this.alpacaClient.fetchHistory(symbol, period, interval);
    const subsystemLabel = context.subsystem ? ` for ${context.subsystem}` : "";
    return {
      source: "alpaca",
      status: "degraded",
      degradedReason: `Schwab history was unavailable${subsystemLabel}; using declared Alpaca fallback.`,
      stalenessSeconds: 0,
      providerMode: "alpaca_fallback",
      fallbackEngaged: true,
      providerModeReason: `History entered the declared Alpaca fallback lane${subsystemLabel}.`,
      rows,
    };
  }

  async fetchAlpacaQuoteFallback(symbol: string, context: ProviderRouteContext = {}): Promise<QuoteFetchResult> {
    if (!this.isAlpacaSupportedSymbol(symbol)) {
      throw new Error(`Alpaca fallback is not supported for ${symbol}`);
    }
    const quote = await this.alpacaClient.fetchQuote(symbol);
    const subsystemLabel = context.subsystem ? ` for ${context.subsystem}` : "";
    return {
      source: "alpaca",
      status: "degraded",
      degradedReason: `Schwab live quote was unavailable${subsystemLabel}; using declared Alpaca fallback.`,
      stalenessSeconds: 0,
      providerMode: "alpaca_fallback",
      fallbackEngaged: true,
      providerModeReason: `Quote entered the declared Alpaca fallback lane${subsystemLabel}.`,
      quote,
    };
  }

  private async readAfterHoursStaleSchwabQuote(
    symbol: string,
    context: ProviderRouteContext,
  ): Promise<QuoteFetchResult | null> {
    if (!context.preferLiveSchwabLane) {
      return null;
    }
    const isFuturesSymbol = symbol.startsWith("/");
    const snapshot = isFuturesSymbol
      ? await this.streamerRuntime.readAfterHoursSharedFuturesQuote(symbol)
      : await this.streamerRuntime.readAfterHoursSharedQuote(symbol);
    if (snapshot?.quote?.price == null) {
      return null;
    }
    const subsystemLabel = context.subsystem ? ` for ${context.subsystem}` : "";
    return {
      source: "schwab_streamer_shared",
      status: "degraded",
      degradedReason: `Using last-known Schwab quote${subsystemLabel} while the market is closed (${formatAgeShort(snapshot.stalenessSeconds)} old).`,
      stalenessSeconds: snapshot.stalenessSeconds,
      providerMode: "schwab_primary",
      fallbackEngaged: false,
      providerModeReason: `Quote stayed on the Schwab market-closed retained lane${subsystemLabel}.`,
      quote: snapshot.quote,
    };
  }
}

function summarizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatAgeShort(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;
  return remainderMinutes === 0 ? `${hours}h` : `${hours}h ${remainderMinutes}m`;
}
