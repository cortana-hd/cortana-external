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
  data: {
    symbol?: string;
    price?: number;
    changePercent?: number;
    timestamp?: string;
  };
};

export type LiveQuoteRow = {
  symbol: string;
  label: string;
  sourceSymbol: string;
  price: number | null;
  changePercent: number | null;
  source: string | null;
  timestamp: string | null;
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
};

export async function loadTradingOpsLiveData(
  options: TradingOpsLiveOptions = {},
): Promise<TradingOpsLiveData> {
  const baseUrl = options.baseUrl ?? resolveExternalServiceBaseUrl();
  const cortanaRepoPath = options.cortanaRepoPath ?? getCortanaSourceRepo();
  const fetchImpl = options.fetchImpl ?? fetch;
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
  const tapeRows = TAPE_ROWS.map((row) => buildLiveQuoteRow(row, quoteMap, tapeQuotesResult.error));
  const tapeMode = parseProviderMode(tapeQuotesResult.body);
  const watchlistFetchError = watchlistQuoteErrors[0] ?? null;
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
        buy: buildWatchlistRows(tradingRun.data?.dipBuyerBuy ?? [], quoteMap, watchlistFetchError),
        watch: buildWatchlistRows(tradingRun.data?.dipBuyerWatch ?? [], quoteMap, watchlistFetchError),
      },
      canslim: {
        buy: buildWatchlistRows(tradingRun.data?.canslimBuy ?? [], quoteMap, watchlistFetchError),
        watch: buildWatchlistRows(tradingRun.data?.canslimWatch ?? [], quoteMap, watchlistFetchError),
      },
    },
    meta: {
      runId: tradingRun.data?.runId ?? null,
      runLabel: tradingRun.data?.runLabel ?? null,
      decision: tradingRun.data?.decision ?? null,
      focusTicker: tradingRun.data?.focusTicker ?? null,
      isAfterHours: isAfterHoursSession(),
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
  fetchError: string | null,
): LiveQuoteRow[] {
  return symbols.map((symbol) =>
    buildLiveQuoteRow(
      { symbol, label: symbol, sourceSymbol: symbol },
      quoteMap,
      fetchError,
    ),
  );
}

function buildLiveQuoteRow(
  row: { symbol: string; label: string; sourceSymbol: string },
  quoteMap: Map<string, QuoteBatchItem>,
  fetchError: string | null,
): LiveQuoteRow {
  const quoteItem = quoteMap.get(row.sourceSymbol);
  if (!quoteItem) {
    return {
      symbol: row.symbol,
      label: row.label,
      sourceSymbol: row.sourceSymbol,
      price: null,
      changePercent: null,
      source: null,
      timestamp: null,
      state: fetchError ? "error" : "missing",
      warning: fetchError ?? "Quote unavailable.",
    };
  }

  const data = asRecord(quoteItem.data);
  const price = numberValue(data.price);
  const changePercent = numberValue(data.changePercent);
  const timestamp = stringValue(data.timestamp);
  const state = normalizeLoadState(quoteItem.status, price);

  return {
    symbol: row.symbol,
    label: row.label,
    sourceSymbol: row.sourceSymbol,
    price,
    changePercent,
    source: quoteItem.source,
    timestamp,
    state,
    warning: quoteItem.degradedReason ?? (price == null ? "Quote unavailable." : null),
  };
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
  if (tapeMode.providerMode === "alpaca_fallback") {
    return tapeMode.providerModeReason ?? "Quotes are in the declared Alpaca fallback lane.";
  }
  if (tapeMode.providerMode === "cache_fallback") {
    return tapeMode.providerModeReason ?? "Quotes are using a cache fallback lane.";
  }
  if (tapeMode.providerMode === "multi_mode") {
    return tapeMode.providerModeReason ?? "Quotes are using more than one provider mode across subsystems.";
  }
  const quoteSources = new Set(rows.map((row) => row.source).filter((value): value is string => Boolean(value)));
  const degraded = rows.some((row) => row.state === "degraded" || row.state === "error");

  if (streamer.connected && quoteSources.has("schwab_streamer")) {
    return degraded
      ? "Quotes are fresh from the Schwab streamer, but some symbols are still degraded."
      : "Quotes are fresh from the Schwab streamer.";
  }

  if (quoteSources.size > 0) {
    return "Using REST fallback while streamer reconnects.";
  }

  return "Live quotes are unavailable right now.";
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
  const parsed = Number(
    reference.toLocaleString("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: "America/New_York",
    }),
  );
  return parsed < 9 || parsed >= 16;
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
