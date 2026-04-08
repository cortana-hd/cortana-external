import fs from "node:fs";
import path from "node:path";
import type { LoadState } from "@/lib/trading-ops";
import { getCortanaSourceRepo } from "@/lib/runtime-paths";
import { findWorkspaceRoot } from "@/lib/service-workspace";
import { loadLatestTradingRunOverview, type TradingRunOverview } from "@/lib/trading-ops";

const LIVE_REQUEST_TIMEOUT_MS = 6_000;
const DEFAULT_EXTERNAL_SERVICE_PORT = "3033";
const TAPE_SOURCE_SYMBOLS = ["SPY", "QQQ", "IWM", "DIA", "GLD"] as const;
const TAPE_ROWS = [
  { symbol: "SPY", label: "SPY", sourceSymbol: "SPY" },
  { symbol: "QQQ", label: "QQQ", sourceSymbol: "QQQ" },
  { symbol: "IWM", label: "IWM", sourceSymbol: "IWM" },
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
  const watchlistSymbols = collectWatchlistSymbols(tradingRun.data);
  const symbols = dedupeSymbols([...TAPE_SOURCE_SYMBOLS, ...watchlistSymbols]);

  const [opsResult, quotesResult] = await Promise.all([
    fetchJson(`${baseUrl}/market-data/ops`, fetchImpl),
    fetchJson(`${baseUrl}/market-data/quote/batch?symbols=${encodeURIComponent(symbols.join(","))}`, fetchImpl),
  ]);

  const quoteItems = parseQuoteItems(quotesResult.body);
  const quoteMap = new Map(quoteItems.map((item) => [item.symbol, item]));
  const streamer = parseStreamerSummary(opsResult.body);
  const tapeRows = TAPE_ROWS.map((row) => buildLiveQuoteRow(row, quoteMap, quotesResult.error));
  const freshnessMessage = buildFreshnessMessage(streamer, tapeRows);

  return {
    generatedAt: new Date().toISOString(),
    streamer,
    tape: {
      rows: tapeRows,
      freshnessMessage,
    },
    watchlists: {
      dipBuyer: {
        buy: buildWatchlistRows(tradingRun.data?.dipBuyerBuy ?? [], quoteMap, quotesResult.error),
        watch: buildWatchlistRows(tradingRun.data?.dipBuyerWatch ?? [], quoteMap, quotesResult.error),
      },
      canslim: {
        buy: buildWatchlistRows(tradingRun.data?.canslimBuy ?? [], quoteMap, quotesResult.error),
        watch: buildWatchlistRows(tradingRun.data?.canslimWatch ?? [], quoteMap, quotesResult.error),
      },
    },
    meta: {
      runId: tradingRun.data?.runId ?? null,
      decision: tradingRun.data?.decision ?? null,
      focusTicker: tradingRun.data?.focusTicker ?? null,
      isAfterHours: isAfterHoursSession(),
    },
    warnings: compactStrings([
      quotesResult.error,
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
): Promise<{ ok: boolean; status: number; body: unknown; error: string | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LIVE_REQUEST_TIMEOUT_MS);

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
      data: asRecord(item.data) as QuoteBatchItem["data"],
    }));
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

function buildFreshnessMessage(streamer: LiveStreamerSummary, rows: LiveQuoteRow[]): string {
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
