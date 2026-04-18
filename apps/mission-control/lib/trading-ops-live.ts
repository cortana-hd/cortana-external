import fs from "node:fs";
import path from "node:path";
import type { LoadState } from "@/lib/trading-ops";
import { getCortanaSourceRepo } from "@/lib/runtime-paths";
import { findWorkspaceRoot } from "@/lib/service-workspace";
import { loadLatestTradingRunOverview, type TradingRunOverview } from "@/lib/trading-ops";

const LIVE_OPS_TIMEOUT_MS = 6_000;
const LIVE_TAPE_TIMEOUT_MS = 8_000;
const LIVE_WATCHLIST_TIMEOUT_MS = 12_000;
const LIVE_WATCHLIST_CHUNK_SIZE = 20;
const AFTER_HOURS_WAITING_BADGE_WINDOW_MS = 2 * 60_000;
const DEFAULT_EXTERNAL_SERVICE_PORT = "3033";
const TAPE_SOURCE_SYMBOLS = ["SPY", "QQQ", "IWM", "DIA", "GLD", "ARKK", "XLE"] as const;
const TAPE_ROWS = [
  { symbol: "SPY", label: "SPY", sourceSymbol: "SPY" },
  { symbol: "QQQ", label: "QQQ", sourceSymbol: "QQQ" },
  { symbol: "IWM", label: "IWM", sourceSymbol: "IWM" },
  { symbol: "DIA", label: "DIA", sourceSymbol: "DIA" },
  { symbol: "ARKK", label: "ARKK", sourceSymbol: "ARKK" },
  { symbol: "XLE", label: "XLE", sourceSymbol: "XLE" },
  { symbol: "S&P 500", label: "S&P 500", sourceSymbol: "SPY" },
  { symbol: "DOW", label: "DOW", sourceSymbol: "DIA" },
  { symbol: "NASDAQ", label: "NASDAQ", sourceSymbol: "QQQ" },
  { symbol: "GLD", label: "GLD", sourceSymbol: "GLD" },
] as const;

type FetchLike = typeof fetch;

type QuoteBatchItem = {
  symbol: string;
  source: string | null;
  status: string;
  degradedReason: string | null;
  providerMode: string | null;
  stalenessSeconds?: number | null;
  data: {
    symbol?: string;
    price?: number;
    changePercent?: number;
    timestamp?: string;
  };
};

type RetainedLiveQuote = {
  price: number;
  changePercent: number | null;
  source: string | null;
  timestamp: string | null;
  stalenessSeconds: number | null;
  observedAtMs: number;
};

const retainedSchwabQuotes = new Map<string, RetainedLiveQuote>();
const quietAfterHoursGapSince = new Map<string, number>();

export type LiveQuoteRow = {
  symbol: string;
  label: string;
  sourceSymbol: string;
  price: number | null;
  changePercent: number | null;
  source: string | null;
  timestamp: string | null;
  stalenessSeconds?: number | null;
  state: LoadState;
  warning: string | null;
};

export type LiveStreamerSummary = {
  connected: boolean;
  operatorState: string;
  lastLoginAt: string | null;
  activeEquitySubscriptions: number;
  activeAcctActivitySubscriptions: number;
  cooldownSummary: string | null;
  warnings: string[];
};

export type TradingOpsLiveData = {
  generatedAt: string;
  streamer: LiveStreamerSummary;
  tape: {
    rows: LiveQuoteRow[];
    freshnessMessage: string;
    providerMode: string;
    fallbackEngaged: boolean;
    providerModeReason: string | null;
  };
  watchlists: {
    dipBuyer: {
      buy: LiveQuoteRow[];
      watch: LiveQuoteRow[];
    };
    canslim: {
      buy: LiveQuoteRow[];
      watch: LiveQuoteRow[];
    };
  };
  meta: {
    runId: string | null;
    runLabel: string | null;
    decision: string | null;
    focusTicker: string | null;
    isAfterHours: boolean;
  };
  warnings: string[];
};

type TradingOpsLiveOptions = {
  baseUrl?: string;
  cortanaRepoPath?: string;
  fetchImpl?: FetchLike;
  referenceTime?: Date;
};

export async function loadTradingOpsLiveData(
  options: TradingOpsLiveOptions = {},
): Promise<TradingOpsLiveData> {
  const baseUrl = options.baseUrl ?? resolveExternalServiceBaseUrl();
  const cortanaRepoPath = options.cortanaRepoPath ?? getCortanaSourceRepo();
  const fetchImpl = options.fetchImpl ?? fetch;
  const referenceTime = options.referenceTime ?? new Date();
  const nowMs = referenceTime.getTime();
  const isAfterHours = isAfterHoursSession(referenceTime);
  const tradingRun = await loadLatestTradingRunOverview({ cortanaRepoPath, tradingRunStateStore: null });
  const tapeSymbols = [...TAPE_SOURCE_SYMBOLS] as string[];
  const watchlistSymbols = dedupeSymbols(
    collectWatchlistSymbols(tradingRun.data).filter((symbol) => !tapeSymbols.includes(symbol)),
  );
  const watchlistChunks = chunkSymbols(watchlistSymbols, LIVE_WATCHLIST_CHUNK_SIZE);

  const [opsResult, tapeQuotesResult, watchlistQuoteResults] = await Promise.all([
    fetchJson(`${baseUrl}/market-data/ops`, fetchImpl, LIVE_OPS_TIMEOUT_MS),
    fetchJson(
      `${baseUrl}/market-data/quote/batch?symbols=${encodeURIComponent(tapeSymbols.join(","))}&subsystem=live_watchlists`,
      fetchImpl,
      LIVE_TAPE_TIMEOUT_MS,
    ),
    Promise.all(
      watchlistChunks.map((symbols) =>
        fetchJson(
          `${baseUrl}/market-data/quote/batch?symbols=${encodeURIComponent(symbols.join(","))}&subsystem=live_watchlists`,
          fetchImpl,
          LIVE_WATCHLIST_TIMEOUT_MS,
        ),
      ),
    ),
  ]);

  const watchlistQuoteErrors = compactStrings(watchlistQuoteResults.map((result) => result.error));
  const quoteItems = [
    ...parseQuoteItems(tapeQuotesResult.body),
    ...watchlistQuoteResults.flatMap((result) => parseQuoteItems(result.body)),
  ];
  const quoteMap = new Map(quoteItems.map((item) => [item.symbol, item]));
  const streamer = parseStreamerSummary(opsResult.body);
  const tapeRows = TAPE_ROWS.map((row) => buildLiveQuoteRow(row, quoteMap, {
    streamerConnected: streamer.connected,
    isAfterHours,
    nowMs,
  }));
  const tapeMode = parseProviderMode(tapeQuotesResult.body);
  const freshnessMessage = buildFreshnessMessage(streamer, tapeRows, tapeMode);

  return {
    generatedAt: new Date().toISOString(),
    streamer,
    tape: {
      rows: tapeRows,
      freshnessMessage,
      providerMode: tapeMode.providerMode,
      fallbackEngaged: tapeMode.fallbackEngaged,
      providerModeReason: tapeMode.providerModeReason,
    },
    watchlists: {
      dipBuyer: {
        buy: buildWatchlistRows(tradingRun.data?.dipBuyerBuy ?? [], quoteMap, {
          streamerConnected: streamer.connected,
          isAfterHours,
          nowMs,
        }),
        watch: buildWatchlistRows(tradingRun.data?.dipBuyerWatch ?? [], quoteMap, {
          streamerConnected: streamer.connected,
          isAfterHours,
          nowMs,
        }),
      },
      canslim: {
        buy: buildWatchlistRows(tradingRun.data?.canslimBuy ?? [], quoteMap, {
          streamerConnected: streamer.connected,
          isAfterHours,
          nowMs,
        }),
        watch: buildWatchlistRows(tradingRun.data?.canslimWatch ?? [], quoteMap, {
          streamerConnected: streamer.connected,
          isAfterHours,
          nowMs,
        }),
      },
    },
    meta: {
      runId: tradingRun.data?.runId ?? null,
      runLabel: tradingRun.data?.runLabel ?? null,
      decision: tradingRun.data?.decision ?? null,
      focusTicker: tradingRun.data?.focusTicker ?? null,
      isAfterHours,
    },
    warnings: compactStrings([
      tapeQuotesResult.error,
      ...watchlistQuoteErrors,
      ...streamer.warnings,
      ...compactStrings(tapeRows.map((row) => row.warning)),
      ...tradingRun.warnings,
    ]),
  };
}

export function clearTradingOpsLiveRetainedQuotesForTests() {
  retainedSchwabQuotes.clear();
  quietAfterHoursGapSince.clear();
}

export function getTradingOpsLiveRetainedQuoteKeysForTests(): string[] {
  return [...retainedSchwabQuotes.keys()];
}

function resolveExternalServiceBaseUrl(): string {
  const envValue = process.env.MISSION_CONTROL_EXTERNAL_SERVICE_URL?.trim();
  if (envValue) {
    return envValue.replace(/\/+$/, "");
  }

  const root = findWorkspaceRoot();
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) {
    return `http://127.0.0.1:${DEFAULT_EXTERNAL_SERVICE_PORT}`;
  }

  const content = fs.readFileSync(envPath, "utf8");
  const match = content.match(/^\s*PORT\s*=\s*(.+)\s*$/m);
  const port = (match?.[1]?.trim() ?? DEFAULT_EXTERNAL_SERVICE_PORT).replace(/^['"]|['"]$/g, "") || DEFAULT_EXTERNAL_SERVICE_PORT;
  return `http://127.0.0.1:${port}`;
}

async function fetchJson(
  url: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; body: unknown; error: string | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await response.text();
    const body = text ? safeJsonParse(text) : null;
    return {
      ok: response.ok,
      status: response.status,
      body,
      error: response.ok ? null : summarizeFetchError(response.status, body),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: null,
      error: error instanceof Error ? error.message : "Request failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parseQuoteItems(body: unknown): QuoteBatchItem[] {
  const items = asArray(asRecord(asRecord(body).data).items);
  return items
    .map((item) => asRecord(item))
    .filter((item) => typeof item.symbol === "string")
    .map((item) => ({
      symbol: String(item.symbol),
      source: stringValue(item.source),
      status: stringValue(item.status) ?? "error",
      degradedReason: stringValue(item.degradedReason),
      providerMode: stringValue(item.providerMode),
      stalenessSeconds: numberValue(item.stalenessSeconds),
      data: asRecord(item.data) as QuoteBatchItem["data"],
    }));
}

function chunkSymbols(symbols: string[], chunkSize: number): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < symbols.length; index += chunkSize) {
    chunks.push(symbols.slice(index, index + chunkSize));
  }
  return chunks;
}

function parseProviderMode(body: unknown): {
  providerMode: string;
  fallbackEngaged: boolean;
  providerModeReason: string | null;
} {
  const record = asRecord(body);
  return {
    providerMode: stringValue(record.providerMode) ?? "unknown",
    fallbackEngaged: booleanValue(record.fallbackEngaged) ?? false,
    providerModeReason: stringValue(record.providerModeReason),
  };
}

function parseStreamerSummary(body: unknown): LiveStreamerSummary {
  const data = asRecord(asRecord(body).data);
  const health = asRecord(data.health);
  const providers = asRecord(health.providers);
  const streamerMeta = asRecord(providers.schwabStreamerMeta);
  const providerMetrics = asRecord(data.providerMetrics);
  const activeSubscriptions = asRecord(streamerMeta.activeSubscriptions);
  const serviceOperatorState = stringValue(data.serviceOperatorState) ?? "unknown";
  const streamerOperatorState = stringValue(streamerMeta.operatorState) ?? serviceOperatorState;
  const cooldownUntil = stringValue(providerMetrics.schwabCooldownUntil);
  const cooldownSummary =
    serviceOperatorState === "provider_cooldown" && cooldownUntil
      ? `REST cooldown active until ${cooldownUntil}.`
      : serviceOperatorState === "provider_cooldown"
        ? "REST cooldown is active."
        : null;

  return {
    connected: booleanValue(streamerMeta.connected) ?? false,
    operatorState: streamerOperatorState,
    lastLoginAt: stringValue(streamerMeta.lastLoginAt),
    activeEquitySubscriptions: numberValue(activeSubscriptions.LEVELONE_EQUITIES) ?? 0,
    activeAcctActivitySubscriptions: numberValue(activeSubscriptions.ACCT_ACTIVITY) ?? 0,
    cooldownSummary,
    warnings: compactStrings([
      stringValue(streamerMeta.lastFailureMessage),
      serviceOperatorState !== "healthy" ? `service:${serviceOperatorState}` : null,
      streamerOperatorState !== "healthy" ? `streamer:${streamerOperatorState}` : null,
      cooldownSummary,
    ]),
  };
}

function buildWatchlistRows(
  symbols: string[],
  quoteMap: Map<string, QuoteBatchItem>,
  context: { streamerConnected: boolean; isAfterHours: boolean; nowMs: number },
): LiveQuoteRow[] {
  return symbols.map((symbol) =>
    buildLiveQuoteRow(
      { symbol, label: symbol, sourceSymbol: symbol },
      quoteMap,
      context,
    ),
  );
}

function buildLiveQuoteRow(
  row: { symbol: string; label: string; sourceSymbol: string },
  quoteMap: Map<string, QuoteBatchItem>,
  context: { streamerConnected: boolean; isAfterHours: boolean; nowMs: number },
): LiveQuoteRow {
  const quoteItem = quoteMap.get(row.sourceSymbol);
  if (!quoteItem) {
    const hadRetainedQuote = retainedSchwabQuotes.has(row.sourceSymbol);
    const retainedQuote = getRetainedSchwabQuote(row.sourceSymbol, context);
    if (retainedQuote) {
      return {
        symbol: row.symbol,
        label: row.label,
        sourceSymbol: row.sourceSymbol,
        price: retainedQuote.price,
        changePercent: retainedQuote.changePercent,
        source: retainedQuote.source,
        timestamp: retainedQuote.timestamp,
        stalenessSeconds: retainedQuote.stalenessSeconds,
        state: "degraded",
        warning: buildRetainedLiveQuoteWarning(retainedQuote, context),
      };
    }

    return {
      symbol: row.symbol,
      label: row.label,
      sourceSymbol: row.sourceSymbol,
      price: null,
      changePercent: null,
      source: null,
      timestamp: null,
      stalenessSeconds: null,
      state: context.streamerConnected && context.isAfterHours ? "degraded" : "error",
      warning: buildMissingLiveQuoteWarning(context, row.sourceSymbol, hadRetainedQuote),
    };
  }

  const data = asRecord(quoteItem.data);
  const price = numberValue(data.price);
  const changePercent = numberValue(data.changePercent);
  const timestamp = stringValue(data.timestamp);
  const state = normalizeLoadState(quoteItem.status, price);
  rememberRetainedSchwabQuote({
    symbol: row.symbol,
    label: row.label,
    sourceSymbol: row.sourceSymbol,
    price,
    changePercent,
    source: quoteItem.source,
    timestamp,
    stalenessSeconds: quoteItem.stalenessSeconds ?? null,
    state,
    warning: null,
  }, context.nowMs);

  const isSchwabStreamerQuote =
    quoteItem.source === "schwab_streamer" || quoteItem.source === "schwab_streamer_shared";
  if (!context.streamerConnected && isSchwabStreamerQuote && price != null) {
    return {
      symbol: row.symbol,
      label: row.label,
      sourceSymbol: row.sourceSymbol,
      price,
      changePercent,
      source: quoteItem.source,
      timestamp,
      stalenessSeconds: quoteItem.stalenessSeconds ?? null,
      state: "degraded",
      warning: buildRetainedLiveQuoteWarning({
        price,
        changePercent,
        source: quoteItem.source,
        timestamp,
        stalenessSeconds: quoteItem.stalenessSeconds ?? null,
        observedAtMs: context.nowMs,
      }, context),
    };
  }

  const shouldSoftenAfterHoursGap = shouldSoftenMissingLiveQuote(quoteItem, context);
  if (shouldSoftenAfterHoursGap) {
    const hadRetainedQuote = retainedSchwabQuotes.has(row.sourceSymbol);
    const retainedQuote = getRetainedSchwabQuote(row.sourceSymbol, context);
    if (retainedQuote) {
      return {
        symbol: row.symbol,
        label: row.label,
        sourceSymbol: row.sourceSymbol,
        price: retainedQuote.price,
        changePercent: retainedQuote.changePercent,
        source: retainedQuote.source,
        timestamp: retainedQuote.timestamp,
        stalenessSeconds: retainedQuote.stalenessSeconds,
        state: "degraded",
        warning: buildRetainedLiveQuoteWarning(retainedQuote, context),
      };
    }

    return {
      symbol: row.symbol,
      label: row.label,
      sourceSymbol: row.sourceSymbol,
      price,
      changePercent,
      source: quoteItem.source,
      timestamp,
      stalenessSeconds: quoteItem.stalenessSeconds ?? null,
      state: "degraded",
      warning: buildMissingLiveQuoteWarning(context, row.sourceSymbol, hadRetainedQuote),
    };
  }

  return {
    symbol: row.symbol,
    label: row.label,
    sourceSymbol: row.sourceSymbol,
    price,
    changePercent,
    source: quoteItem.source,
    timestamp,
    stalenessSeconds: quoteItem.stalenessSeconds ?? null,
    state,
    warning: quoteItem.degradedReason ?? (price == null ? "Quote unavailable." : null),
  };
}

function buildMissingLiveQuoteWarning(
  context: { streamerConnected: boolean; isAfterHours: boolean; nowMs: number },
  sourceSymbol: string,
  preferUnavailable = false,
): string | null {
  if (!context.streamerConnected) {
    return preferUnavailable
      ? "No retained Schwab streamer quote is available while the stream reconnects."
      : "No retained Schwab streamer quote is available yet.";
  }
  if (!context.isAfterHours) return null;
  if (preferUnavailable) {
    return "No recent Schwab quote is available for this symbol while the market is closed.";
  }
  const firstSeenAtMs = quietAfterHoursGapSince.get(sourceSymbol) ?? context.nowMs;
  quietAfterHoursGapSince.set(sourceSymbol, firstSeenAtMs);
  if (context.nowMs - firstSeenAtMs > AFTER_HOURS_WAITING_BADGE_WINDOW_MS) {
    return "No recent Schwab quote is available for this symbol while the market is closed.";
  }
  return "No recent Schwab quote yet while the market is closed.";
}

function buildRetainedLiveQuoteWarning(
  retainedQuote: RetainedLiveQuote,
  context: { streamerConnected: boolean; isAfterHours: boolean },
): string {
  const ageSeconds = retainedQuote.stalenessSeconds ?? 0;
  if (context.streamerConnected && context.isAfterHours) {
    if (ageSeconds <= 0) {
      return "Holding the last known Schwab streamer quote while the market is closed.";
    }
    return `Holding the last known Schwab streamer quote from ${formatAgeSeconds(ageSeconds)} while the market is closed.`;
  }
  if (ageSeconds <= 0) {
    return "Holding the last known Schwab streamer quote while the stream reconnects.";
  }
  return `Holding the last known Schwab streamer quote from ${formatAgeSeconds(ageSeconds)} while the stream reconnects.`;
}

function normalizeLoadState(status: string | null | undefined, price: number | null): LoadState {
  if (status === "ok") return price == null ? "missing" : "ok";
  if (status === "degraded") return "degraded";
  if (status === "error") return "error";
  return price == null ? "missing" : "ok";
}

function buildFreshnessMessage(
  streamer: LiveStreamerSummary,
  rows: LiveQuoteRow[],
  tapeMode: { providerMode: string; fallbackEngaged: boolean; providerModeReason: string | null },
): string {
  const quoteSources = new Set(rows.map((row) => row.source).filter((value): value is string => Boolean(value)));
  const hasStreamerQuotes = quoteSources.has("schwab_streamer") || quoteSources.has("schwab_streamer_shared");
  const hasUsableQuotes = rows.some((row) => row.price != null);
  const hasErrors = rows.some((row) => row.state === "error");
  const hasDegraded = rows.some((row) => row.state === "degraded");
  const hasQuietAfterHoursRows = rows.some(isQuietAfterHoursGapRow);
  const hasUnavailableAfterHoursRows = rows.some(isUnavailableAfterHoursGapRow);
  const hasAfterHoursRetainedSchwabQuotes = rows.some(
    (row) =>
      row.state === "degraded" &&
      (row.source === "schwab_streamer" || row.source === "schwab_streamer_shared") &&
      (row.stalenessSeconds ?? 0) > 0,
  );

  if (streamer.connected) {
    if (hasStreamerQuotes && !hasErrors && !hasDegraded) {
      return "Quotes are fresh from the Schwab streamer.";
    }
    if (hasStreamerQuotes) {
      if (hasAfterHoursRetainedSchwabQuotes && hasQuietAfterHoursRows && !hasErrors) {
        return "Market is closed. Some symbols are holding their last Schwab quote, and quieter names are waiting for the next print.";
      }
      if (hasAfterHoursRetainedSchwabQuotes && hasUnavailableAfterHoursRows && !hasErrors) {
        return "Market is closed. Some symbols are holding their last Schwab quote, and quieter names still have no recent Schwab print.";
      }
      if (hasQuietAfterHoursRows && !hasErrors) {
        return "Market is closed. Some symbols are waiting for the next Schwab print.";
      }
      if (hasUnavailableAfterHoursRows && !hasErrors) {
        return "Market is closed. A few symbols still have no recent Schwab quote.";
      }
      if (hasAfterHoursRetainedSchwabQuotes && !hasErrors) {
        return "Market is closed. Showing last-known Schwab prices with age markers.";
      }
      if (hasAfterHoursRetainedSchwabQuotes) {
        return "Market is closed. Showing last-known Schwab prices where available, and some symbols are unavailable.";
      }
      if (tapeMode.providerMode === "alpaca_fallback") {
        return "Streamer is connected, but some symbols moved into the declared Alpaca fallback lane.";
      }
      if (tapeMode.providerMode === "cache_fallback") {
        return "Streamer is connected, but some symbols are using cached fallback quotes.";
      }
      if (tapeMode.providerMode === "multi_mode") {
        return "Streamer is connected and some quotes are fresh, but this batch mixed live symbols with failures or fallback rows.";
      }
      return "Streamer is connected and some quotes are fresh, but some symbols are still degraded.";
    }
    if (hasQuietAfterHoursRows) {
      return "Market is closed. No followed symbols have printed a recent Schwab quote yet.";
    }
    if (hasUnavailableAfterHoursRows) {
      return "Market is closed. The followed symbols still have no recent Schwab quote.";
    }
    if (hasUsableQuotes) {
      return "Streamer is connected, but this batch fell off the live Schwab lane for some symbols.";
    }
    return "Streamer is connected, but the live batch returned no usable quotes.";
  }

  if (hasStreamerQuotes) {
    if (!hasErrors) {
      return "Using last-known Schwab streamer quotes while the stream reconnects.";
    }
    return "Using last-known Schwab streamer quotes while the stream reconnects. Some symbols are unavailable.";
  }

  if (tapeMode.providerMode === "schwab_streamer_stale_or_unavailable") {
    return tapeMode.providerModeReason ?? "Live tape is streamer-only. Quotes stay stale or unavailable until the stream resumes.";
  }

  return "Live streamer is disconnected and no retained Schwab streamer quotes are available.";
}

function isQuietAfterHoursGapRow(row: LiveQuoteRow): boolean {
  return row.state === "degraded" && row.warning === "No recent Schwab quote yet while the market is closed.";
}

function isUnavailableAfterHoursGapRow(row: LiveQuoteRow): boolean {
  return row.state === "degraded" && row.warning === "No recent Schwab quote is available for this symbol while the market is closed.";
}

function collectWatchlistSymbols(tradingRun: TradingRunOverview | null): string[] {
  if (!tradingRun) return [];
  return dedupeSymbols([
    ...tradingRun.dipBuyerBuy,
    ...tradingRun.dipBuyerWatch,
    ...tradingRun.canslimBuy,
    ...tradingRun.canslimWatch,
  ]);
}

function dedupeSymbols(symbols: string[]): string[] {
  return [...new Set(symbols.filter((value) => value && value.trim()))];
}

function summarizeFetchError(status: number, body: unknown): string {
  const degradedReason = stringValue(asRecord(body).degradedReason);
  if (degradedReason) {
    return `HTTP ${status}: ${degradedReason}`;
  }
  return `HTTP ${status}`;
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isAfterHoursSession(reference = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    hour: "numeric",
    hour12: false,
    timeZone: "America/New_York",
  }).formatToParts(reference);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? NaN);
  const isWeekday = !["Sat", "Sun"].includes(weekday);
  return !isWeekday || !Number.isFinite(hour) || hour < 9 || hour >= 16;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function compactStrings(values: Array<string | null | undefined>): string[] {
  return values.filter((value): value is string => Boolean(value && value.trim()));
}

function rememberRetainedSchwabQuote(row: LiveQuoteRow, nowMs: number) {
  if (row.price == null) return;
  if (row.source !== "schwab_streamer" && row.source !== "schwab_streamer_shared") return;

  quietAfterHoursGapSince.delete(row.sourceSymbol);
  retainedSchwabQuotes.set(row.sourceSymbol, {
    price: row.price,
    changePercent: row.changePercent,
    source: row.source,
    timestamp: row.timestamp,
    stalenessSeconds: row.stalenessSeconds ?? null,
    observedAtMs: nowMs,
  });
}

function getRetainedSchwabQuote(
  sourceSymbol: string,
  context: { streamerConnected: boolean; isAfterHours: boolean; nowMs: number },
): RetainedLiveQuote | null {
  const retainedQuote = retainedSchwabQuotes.get(sourceSymbol);
  if (!retainedQuote) return null;

  const stalenessSeconds = computeRetainedStalenessSeconds(retainedQuote, context.nowMs);
  if (stalenessSeconds == null) {
    return null;
  }

  return {
    ...retainedQuote,
    stalenessSeconds,
  };
}

function computeRetainedStalenessSeconds(retainedQuote: RetainedLiveQuote, nowMs: number): number | null {
  if (retainedQuote.timestamp) {
    const timestampMs = Date.parse(retainedQuote.timestamp);
    if (Number.isFinite(timestampMs)) {
      return Math.max(1, Math.floor((nowMs - timestampMs) / 1000));
    }
  }

  if (retainedQuote.stalenessSeconds != null) {
    return Math.max(1, retainedQuote.stalenessSeconds + Math.floor((nowMs - retainedQuote.observedAtMs) / 1000));
  }

  return Math.max(1, Math.floor((nowMs - retainedQuote.observedAtMs) / 1000));
}

function shouldSoftenMissingLiveQuote(
  quoteItem: QuoteBatchItem,
  context: { streamerConnected: boolean; isAfterHours: boolean; nowMs: number },
): boolean {
  if (!context.streamerConnected) return false;
  if (!context.isAfterHours) return false;
  if (quoteItem.status === "ok") return false;
  const degradedReason = quoteItem.degradedReason ?? "";
  return (
    degradedReason.includes("No live Schwab quote available") ||
    degradedReason.includes("HTTP 401") ||
    degradedReason.includes("This operation was aborted")
  );
}

function formatAgeSeconds(ageSeconds: number): string {
  if (ageSeconds < 60) return `${ageSeconds}s ago`;
  const minutes = Math.floor(ageSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m ago` : `${hours}h ago`;
}
