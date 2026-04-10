import fs from "node:fs";
import path from "node:path";

import type {
  ArtifactState,
  LoadState,
  PolymarketAccountOverview,
  PolymarketResultsOverview,
  PolymarketSignalOverview,
  PolymarketWatchlistOverview,
  TradingOpsPolymarketData,
} from "@/lib/trading-ops-contract";
import { loadTradingOpsPolymarketLiveData } from "@/lib/trading-ops-polymarket-live";
import { getBacktesterRepoPath } from "@/lib/runtime-paths";

const DEFAULT_EXTERNAL_SERVICE_PORT = "3033";
const LIVE_EVENT_LINKS = [
  {
    match: /inflation upside risk/i,
    theme: "inflation",
    regimeEffect: "mixed",
    watchTickers: ["QQQ", "ARKK", "XLE", "XOM", "CVX"],
  },
  {
    match: /fed easing odds/i,
    theme: "rates",
    regimeEffect: "mixed",
    watchTickers: ["SPY", "QQQ", "DIA", "NVDA", "AMD", "MSFT"],
  },
] as const;

type FetchLike = typeof fetch;

type TradingOpsPolymarketOptions = {
  repoRoot?: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
};

export async function loadTradingOpsPolymarketData(
  options: TradingOpsPolymarketOptions = {},
): Promise<TradingOpsPolymarketData> {
  const repoRoot = options.repoRoot ?? path.resolve(getBacktesterRepoPath(), "..");
  const baseUrl = options.baseUrl ?? resolveExternalServiceBaseUrl(repoRoot);
  const fetchImpl = options.fetchImpl ?? fetch;
  const [live, resultsResponse] = await Promise.all([
    loadTradingOpsPolymarketLiveData({
      repoRoot,
      baseUrl,
      fetchImpl,
    }),
    fetchJson(`${baseUrl}/polymarket/results`, fetchImpl),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    account: buildLiveAccountArtifact(live, baseUrl),
    signal: buildLiveSignalArtifact(live),
    watchlist: buildLiveWatchlistArtifact(live),
    results: buildLiveResultsArtifact(resultsResponse, baseUrl),
  };
}

function resolveExternalServiceBaseUrl(repoRoot: string): string {
  const explicit = process.env.MISSION_CONTROL_EXTERNAL_SERVICE_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/+$/u, "");
  }

  const envPath = path.join(repoRoot, ".env");
  if (!fs.existsSync(envPath)) {
    return `http://127.0.0.1:${DEFAULT_EXTERNAL_SERVICE_PORT}`;
  }

  const content = fs.readFileSync(envPath, "utf8");
  const match = content.match(/^\s*PORT\s*=\s*(.+)\s*$/m);
  const port = (match?.[1]?.trim() ?? DEFAULT_EXTERNAL_SERVICE_PORT).replace(/^['"]|['"]$/gu, "") || DEFAULT_EXTERNAL_SERVICE_PORT;
  return `http://127.0.0.1:${port}`;
}

function buildLiveAccountArtifact(
  live: Awaited<ReturnType<typeof loadTradingOpsPolymarketLiveData>>,
  baseUrl: string,
): ArtifactState<PolymarketAccountOverview> {
  const status = deriveAccountStatus(live);
  const warnings = compactStrings(live.warnings);
  const balances =
    live.account.balance != null || live.account.buyingPower != null
      ? [
          {
            currency: "USD",
            currentBalance: live.account.balance,
            buyingPower: live.account.buyingPower,
          },
        ]
      : [];
  const data: PolymarketAccountOverview = {
    status,
    keyIdSuffix: null,
    balanceCount: balances.length,
    positionCount: live.account.positionCount ?? 0,
    openOrdersCount: live.account.openOrdersCount ?? 0,
    balances,
  };
  const detailCounts = `${data.balanceCount} live balance snapshots, ${data.positionCount} positions, ${data.openOrdersCount} open orders`;

  return {
    state: status === "error" ? "error" : status === "degraded" ? "degraded" : "ok",
    label: status,
    message:
      status === "healthy"
        ? `Live account stream is healthy with ${detailCounts}.`
        : `Live account stream is ${status}. ${detailCounts}.`,
    data,
    updatedAt: live.account.lastBalanceUpdateAt ?? live.generatedAt,
    source: `${baseUrl}/polymarket/live`,
    warnings,
  };
}

function buildLiveSignalArtifact(
  live: Awaited<ReturnType<typeof loadTradingOpsPolymarketLiveData>>,
): ArtifactState<PolymarketSignalOverview> {
  const eventRows = live.markets.filter((market) => market.bucket === "events");
  if (eventRows.length === 0) {
    return {
      state: "missing",
      label: "No live event stream",
      message: "Polymarket event markets are not streaming yet.",
      data: null,
      updatedAt: live.generatedAt,
      source: "/api/trading-ops/polymarket/live",
      warnings: compactStrings(live.warnings),
    };
  }

  const topMarkets = eventRows.slice(0, 4).map((market) => {
    const mapping = getLiveEventLink(market.title);
    return {
      slug: market.slug,
      title: market.title,
      theme: mapping?.theme ?? "macro",
      probability: marketProbability(market),
      change24h: null,
      severity: marketSeverity(marketProbability(market)),
      persistence: "live",
      regimeEffect: mapping?.regimeEffect ?? null,
      watchTickers: mapping?.watchTickers ? [...mapping.watchTickers] : [],
      qualityTier: market.bestBid != null && market.bestAsk != null ? "high" : "medium",
    };
  });
  const compactLines = [
    `Polymarket live: ${topMarkets
      .map((market) => `${market.title} ${formatProbability(market.probability)}`)
      .join("; ")}`,
  ];
  const data: PolymarketSignalOverview = {
    generatedAt: live.generatedAt,
    compactLines,
    alignment: null,
    overlaySummary: "Live macro event stream",
    overlayDetail: "Derived directly from Polymarket websocket market data. No artifact snapshot is used here.",
    conviction: null,
    aggressionDial: null,
    divergenceSummary: null,
    topMarkets,
  };

  return {
    state: live.streamer.marketsConnected ? "ok" : "degraded",
    label: live.streamer.marketsConnected ? "Live event stream" : "Live event stream degraded",
    message: compactLines[0],
    data,
    updatedAt: live.streamer.lastMarketMessageAt ?? live.generatedAt,
    source: "/api/trading-ops/polymarket/live",
    warnings: compactStrings(live.warnings),
  };
}

function buildLiveWatchlistArtifact(
  live: Awaited<ReturnType<typeof loadTradingOpsPolymarketLiveData>>,
): ArtifactState<PolymarketWatchlistOverview> {
  const symbols = new Map<string, PolymarketWatchlistOverview["symbols"][number]>();

  for (const symbol of ["SPY", "QQQ", "DIA"]) {
    symbols.set(symbol, {
      symbol,
      assetClass: "etf",
      themes: ["broad_market"],
      sourceTitles: ["Core US index baseline"],
      severity: "minor",
      persistence: "live",
      probability: null,
      score: null,
    });
  }

  for (const market of live.markets.filter((entry) => entry.bucket === "events")) {
    const mapping = getLiveEventLink(market.title);
    if (!mapping) {
      continue;
    }

    const probability = marketProbability(market);
    for (const symbol of mapping.watchTickers) {
      if (symbols.has(symbol)) {
        continue;
      }
      symbols.set(symbol, {
        symbol,
        assetClass: inferAssetClass(symbol),
        themes: [mapping.theme],
        sourceTitles: [market.title],
        severity: marketSeverity(probability),
        persistence: "live",
        probability,
        score: probability,
      });
    }
  }

  const rows = Array.from(symbols.values());
  const data: PolymarketWatchlistOverview = {
    updatedAt: live.generatedAt,
    totalCount: rows.length,
    buckets: {
      stocks: rows.filter((entry) => entry.assetClass === "stock").map((entry) => entry.symbol),
      funds: rows.filter((entry) => entry.assetClass === "etf").map((entry) => entry.symbol),
      crypto: [],
      cryptoProxies: [],
    },
    symbols: rows,
  };

  return {
    state: live.streamer.marketsConnected ? "ok" : "degraded",
    label: live.streamer.marketsConnected ? "Live linked watchlist" : "Live linked watchlist degraded",
    message: `Live linked watchlist has ${data.totalCount} symbols across ${bucketSummary(data)}.`,
    data,
    updatedAt: live.generatedAt,
    source: "/api/trading-ops/polymarket/live",
    warnings: compactStrings(live.warnings),
  };
}

function buildLiveResultsArtifact(
  response: FetchResult,
  baseUrl: string,
): ArtifactState<PolymarketResultsOverview> {
  const payload = asRecord(response.body);
  const rows = asArray(payload.results)
    .map((entry) => asRecord(entry))
    .map((entry) => ({
      marketSlug: stringValue(entry.marketSlug) ?? "unknown-market",
      bucket: stringValue(entry.bucket) === "sports" ? "sports" as const : "events" as const,
      title: stringValue(entry.title) ?? "Pinned market",
      eventTitle: stringValue(entry.eventTitle),
      league: stringValue(entry.league),
      pinnedAt: stringValue(entry.pinnedAt),
      status:
        stringValue(entry.status) === "settled"
          ? "settled" as const
          : stringValue(entry.status) === "closed"
            ? "closed" as const
            : "open" as const,
      traded: booleanValue(entry.traded) ?? false,
      realizedPnl: numberValue(entry.realizedPnl),
      netPosition: numberValue(entry.netPosition),
      costBasis: numberValue(entry.costBasis),
      currentValue: numberValue(entry.currentValue),
      unrealizedPnl: numberValue(entry.unrealizedPnl),
      settledAt: stringValue(entry.settledAt),
      settlementPrice: numberValue(entry.settlementPrice),
      outcome: stringValue(entry.outcome),
      lastActivityAt: stringValue(entry.lastActivityAt),
      resultLabel: stringValue(entry.resultLabel) ?? "Settled",
    }));
  const data: PolymarketResultsOverview = {
    updatedAt: stringValue(payload.generatedAt),
    settledCount: rows.filter((row) => row.status === "settled").length,
    tradedCount: rows.filter((row) => row.traded).length,
    openPositionCount: rows.filter((row) => (row.netPosition ?? 0) > 0 && row.status === "open").length,
    rows,
  };

  return {
    state: response.ok ? "ok" : "degraded",
    label:
      data.settledCount > 0
        ? "Pinned results ready"
        : data.openPositionCount > 0
          ? "Pinned live economics ready"
          : "Pinned results waiting",
    message:
      data.settledCount > 0
        ? `${data.settledCount} pinned market results ready${data.tradedCount > 0 ? ` · ${data.tradedCount} with realized P&L` : ""}.`
        : data.openPositionCount > 0
          ? `${data.openPositionCount} pinned open positions are carrying live economics.`
          : "Pinned markets will appear here after settlement.",
    data,
    updatedAt: data.updatedAt,
    source: `${baseUrl}/polymarket/results`,
    warnings: compactStrings([response.error]),
  };
}

function deriveAccountStatus(live: Awaited<ReturnType<typeof loadTradingOpsPolymarketLiveData>>): string {
  if (live.streamer.marketsConnected && live.streamer.privateConnected) {
    return live.warnings.length > 0 ? "degraded" : "healthy";
  }
  if (live.streamer.marketsConnected || live.streamer.privateConnected) {
    return "degraded";
  }
  return "error";
}

function getLiveEventLink(title: string) {
  return LIVE_EVENT_LINKS.find((entry) => entry.match.test(title)) ?? null;
}

function marketProbability(market: Awaited<ReturnType<typeof loadTradingOpsPolymarketLiveData>>["markets"][number]): number | null {
  if (typeof market.lastTrade === "number" && Number.isFinite(market.lastTrade)) {
    return market.lastTrade;
  }
  if (
    typeof market.bestBid === "number" &&
    Number.isFinite(market.bestBid) &&
    typeof market.bestAsk === "number" &&
    Number.isFinite(market.bestAsk)
  ) {
    return Number((((market.bestBid + market.bestAsk) / 2) * 1000).toFixed(0)) / 1000;
  }
  return null;
}

function marketSeverity(probability: number | null): string {
  if (probability == null) {
    return "minor";
  }
  if (probability >= 0.85 || probability <= 0.15) {
    return "major";
  }
  if (probability >= 0.65 || probability <= 0.35) {
    return "moderate";
  }
  return "minor";
}

function inferAssetClass(symbol: string): string {
  return ["SPY", "QQQ", "DIA", "ARKK", "XLE"].includes(symbol) ? "etf" : "stock";
}

function bucketSummary(data: PolymarketWatchlistOverview): string {
  const present = compactStrings([
    data.buckets.stocks.length > 0 ? "stocks" : null,
    data.buckets.funds.length > 0 ? "funds" : null,
    data.buckets.cryptoProxies.length > 0 ? "crypto proxies" : null,
    data.buckets.crypto.length > 0 ? "crypto" : null,
  ]);
  return present.join(", ") || "linked buckets";
}

function formatProbability(value: number | null): string {
  if (value == null || Number.isNaN(value)) {
    return "n/a";
  }
  return `${Math.round(value * 100)}%`;
}

type FetchResult = {
  ok: boolean;
  status: number;
  body: unknown;
  error: string | null;
};

async function fetchJson(url: string, fetchImpl: FetchLike): Promise<FetchResult> {
  try {
    const response = await fetchImpl(url, {
      cache: "no-store",
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
  }
}

function summarizeFetchError(status: number, body: unknown): string {
  const record = asRecord(body);
  const error = stringValue(record.error) ?? stringValue(record.message);
  return error ? `HTTP ${status}: ${error}` : `HTTP ${status}`;
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
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
  return values.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}
