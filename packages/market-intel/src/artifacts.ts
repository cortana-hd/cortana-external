import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { formatCompactReport, formatVerboseReport, toJsonReport } from "./report.js";
import type { MarketIntelReport } from "./types.js";

type WatchlistPayloadTicker = {
  symbol: string;
  asset_class: string;
  themes: string[];
  source_titles: string[];
  probability: number | null;
  score: number | null;
  severity: string;
  persistence: string;
};

const CORE_INDEX_BASELINE: WatchlistPayloadTicker[] = [
  {
    symbol: "SPY",
    asset_class: "etf",
    themes: ["broad_market"],
    source_titles: ["Core US index baseline"],
    probability: null,
    score: null,
    severity: "minor",
    persistence: "one_off",
  },
  {
    symbol: "QQQ",
    asset_class: "etf",
    themes: ["broad_market"],
    source_titles: ["Core US index baseline"],
    probability: null,
    score: null,
    severity: "minor",
    persistence: "one_off",
  },
  {
    symbol: "DIA",
    asset_class: "etf",
    themes: ["broad_market"],
    source_titles: ["Core US index baseline"],
    probability: null,
    score: null,
    severity: "minor",
    persistence: "one_off",
  },
];

export interface ArtifactWriteOptions {
  artifactDir: string;
  watchlistExportPath: string;
}

export async function writeIntegrationArtifacts(
  report: MarketIntelReport,
  options: ArtifactWriteOptions,
): Promise<void> {
  await mkdir(options.artifactDir, { recursive: true });
  await mkdir(path.dirname(options.watchlistExportPath), { recursive: true });

  await Promise.all([
    writeAtomic(path.join(options.artifactDir, "latest-report.json"), toJsonReport(report) + "\n"),
    writeAtomic(path.join(options.artifactDir, "latest-compact.txt"), formatCompactReport(report) + "\n"),
    writeAtomic(path.join(options.artifactDir, "latest-verbose.txt"), formatVerboseReport(report) + "\n"),
    writeAtomic(
      path.join(options.artifactDir, "latest-watchlist.json"),
      JSON.stringify(buildWatchlistPayload(report), null, 2) + "\n",
    ),
    writeAtomic(
      options.watchlistExportPath,
      JSON.stringify(buildWatchlistPayload(report), null, 2) + "\n",
    ),
  ]);
}

export function buildWatchlistPayload(report: MarketIntelReport) {
  const reportedTickers: WatchlistPayloadTicker[] = [
    ...report.watchlistBuckets.stocks,
    ...report.watchlistBuckets.cryptoProxies,
    ...report.watchlistBuckets.funds,
    ...report.watchlistBuckets.crypto,
  ].map((item) => ({
    symbol: item.symbol,
    asset_class: item.assetClass,
    themes: item.themes,
    source_titles: item.sourceTitles,
    probability: item.probability,
    score: item.score,
    severity: item.severity,
    persistence: item.persistence,
  }));
  const tickers = mergeWatchlistTickers(reportedTickers, CORE_INDEX_BASELINE);
  const funds = mergeBucketSymbols(
    report.watchlistBuckets.funds.map((entry) => entry.symbol),
    CORE_INDEX_BASELINE.filter((entry) => entry.asset_class === "etf").map((entry) => entry.symbol),
  );

  return {
    updated_at: report.metadata.generatedAt,
    source: "polymarket_market_intel",
    overlay: report.overlay.alignment,
    summary: {
      conviction: report.summary.conviction,
      aggression_dial: report.summary.aggressionDial,
      divergence: report.summary.divergence,
      focus_sectors: report.summary.focusSectors,
      crypto_focus: report.summary.cryptoFocus,
      theme_highlights: report.summary.themeHighlights,
    },
    buckets: {
      stocks: report.watchlistBuckets.stocks.map((entry) => entry.symbol),
      crypto: report.watchlistBuckets.crypto.map((entry) => entry.symbol),
      crypto_proxies: report.watchlistBuckets.cryptoProxies.map((entry) => entry.symbol),
      funds,
    },
    tickers,
  };
}

function mergeWatchlistTickers(
  primary: WatchlistPayloadTicker[],
  baseline: WatchlistPayloadTicker[],
): WatchlistPayloadTicker[] {
  const merged = new Map<string, WatchlistPayloadTicker>();

  for (const entry of [...primary, ...baseline]) {
    if (merged.has(entry.symbol)) continue;
    merged.set(entry.symbol, entry);
  }

  return Array.from(merged.values());
}

function mergeBucketSymbols(primary: string[], baseline: string[]): string[] {
  return Array.from(new Set([...primary, ...baseline]));
}

async function writeAtomic(filePath: string, contents: string): Promise<void> {
  const tempPath = `${filePath}.tmp`;
  await writeFile(tempPath, contents, "utf8");
  await rename(tempPath, filePath);
}
