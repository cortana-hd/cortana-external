import type { MarketIntelReport, NormalizedMarketSnapshot } from "./types.js";

const REPORT_WATCHLIST_LIMIT = 10;
const COMPACT_WATCHLIST_LIMIT = 5;

export function formatCompactReport(report: MarketIntelReport): string {
  const lines: string[] = [];
  const visible = report.topMarkets.slice(0, 3);

  if (visible.length === 0) {
    lines.push("Polymarket: unavailable or no high-signal markets cleared the filter");
  } else {
    lines.push(
      `Polymarket: ${visible
        .map((market) => `${market.displayTitle} ${fmtPct(market.probability)}${fmtDelta(market.change24h, "24h")}`)
        .join("; ")}`,
    );
  }

  lines.push(`Overlay: ${report.overlay.summary} — ${report.overlay.reason}`);
  lines.push(
    `Watchlist: ${formatWatchlistLine(report.watchlist, COMPACT_WATCHLIST_LIMIT)}`,
  );

  if (report.warnings.length > 0) {
    lines.push(`Notes: ${report.warnings.join(" | ")}`);
  }

  return lines.join("\n");
}

export function formatVerboseReport(report: MarketIntelReport): string {
  const lines: string[] = [];
  lines.push("Polymarket Macro Snapshot");

  if (report.topMarkets.length === 0) {
    lines.push("- No markets cleared the current quality and relevance thresholds.");
  } else {
    for (const market of report.topMarkets) {
      lines.push(
        `- ${market.displayTitle}: ${fmtPct(market.probability)}${fmtDelta(market.change1h, "1h")}${fmtDelta(market.change4h, "4h")}${fmtDelta(market.change24h, "24h")} [${market.quality.tier}]${market.displayTitle !== market.title ? ` | source: ${market.title}` : ""}`,
      );
    }
  }

  lines.push("");
  lines.push("Interpretation");
  lines.push(`- ${report.overlay.summary}: ${report.overlay.reason}`);
  for (const market of report.topMarkets.slice(0, 3)) {
    lines.push(`- ${market.theme}: ${market.impact.sectorImplications.join("; ")}`);
  }

  lines.push("");
  lines.push("Sector Impact");
  for (const market of report.topMarkets.slice(0, 3)) {
    lines.push(`- ${market.displayTitle}: ${market.impact.tickerWatchImplications.join("; ")}`);
  }

  lines.push("");
  lines.push("Watchlist");
  lines.push(`- ${report.watchlist.length > 0 ? report.watchlist.join(", ") : "No watchlist names surfaced."}`);

  if (report.suppressedMarkets.length > 0) {
    lines.push("");
    lines.push("Suppressed Markets");
    for (const market of report.suppressedMarkets.slice(0, 5)) {
      lines.push(`- ${market.title}: ${market.reason}`);
    }
  }

  if (report.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings");
    for (const warning of report.warnings) lines.push(`- ${warning}`);
  }

  return lines.join("\n");
}

export function toJsonReport(report: MarketIntelReport): string {
  return JSON.stringify(report, null, 2);
}

export function buildWatchlist(markets: NormalizedMarketSnapshot[]): string[] {
  const bySymbol = new Map<string, number>();

  for (const market of markets) {
    for (const symbol of market.watchTickers.filter(Boolean)) {
      const score = bySymbol.get(symbol) ?? 0;
      bySymbol.set(symbol, Math.max(score, market.displayScore));
    }
  }

  return Array.from(bySymbol.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, REPORT_WATCHLIST_LIMIT)
    .map(([symbol]) => symbol);
}

function fmtPct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function fmtDelta(value: number | null, label: string): string {
  if (value == null) return "";
  const points = Math.round(value * 100);
  const sign = points > 0 ? "+" : "";
  return ` (${sign}${points} pts/${label})`;
}

function formatWatchlistLine(symbols: string[], limit: number): string {
  if (symbols.length === 0) return "No event-sensitive names surfaced";
  if (symbols.length <= limit) return symbols.join(", ");
  return `${symbols.slice(0, limit).join(", ")} (+${symbols.length - limit} more)`;
}
