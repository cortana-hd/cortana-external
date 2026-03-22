import type { MarketDataHistoryPoint, MarketDataQuote } from "./types.js";

export type HistoryInterval = "1d" | "1wk" | "1mo";
export type HistoryProvider = "service" | "schwab" | "yahoo" | "alpaca";

export function normalizeHistoryInterval(rawInterval: string | undefined): HistoryInterval | undefined {
  const normalized = (rawInterval ?? "1d").trim().toLowerCase();
  if (normalized === "1d" || normalized === "1wk" || normalized === "1mo") {
    return normalized;
  }
  return undefined;
}

export function normalizeHistoryProvider(rawProvider: string | undefined): HistoryProvider | undefined {
  const normalized = (rawProvider ?? "service").trim().toLowerCase();
  if (normalized === "service" || normalized === "schwab" || normalized === "yahoo" || normalized === "alpaca") {
    return normalized;
  }
  return undefined;
}

export function mapSchwabPeriod(period: string, interval: HistoryInterval): Record<string, string | number> {
  const normalized = period.trim().toLowerCase();
  const frequencyType = mapSchwabFrequencyType(interval);
  if (normalized.endsWith("d")) {
    const days = Math.max(parseInt(normalized.slice(0, -1), 10) || 5, 1);
    return {
      periodType: "day",
      period: Math.min(days, 10),
      frequencyType,
      frequency: 1,
      needExtendedHoursData: "false",
      needPreviousClose: "true",
    };
  }
  if (normalized.endsWith("mo")) {
    const months = Math.max(parseInt(normalized.slice(0, -2), 10) || 1, 1);
    return {
      periodType: "month",
      period: Math.min(months, 6),
      frequencyType,
      frequency: 1,
      needExtendedHoursData: "false",
      needPreviousClose: "true",
    };
  }
  const years = Math.max(parseInt(normalized.replace(/[^0-9]/g, ""), 10) || 1, 1);
  return {
    periodType: "year",
    period: Math.min(years, 20),
    frequencyType,
    frequency: 1,
    needExtendedHoursData: "false",
    needPreviousClose: "true",
  };
}

export function mapAlpacaTimeframe(interval: HistoryInterval): "1Day" | "1Week" | "1Month" {
  if (interval === "1wk") {
    return "1Week";
  }
  if (interval === "1mo") {
    return "1Month";
  }
  return "1Day";
}

export function compareHistoryRows(primaryRows: MarketDataHistoryPoint[], comparisonRows: MarketDataHistoryPoint[]): string {
  if (!primaryRows.length || !comparisonRows.length) {
    return "one provider returned no rows";
  }
  const primaryLatest = primaryRows[primaryRows.length - 1];
  const compareLatest = comparisonRows[comparisonRows.length - 1];
  const closeDelta = ((primaryLatest.close - compareLatest.close) / compareLatest.close) * 100;
  return `latest close delta ${closeDelta.toFixed(2)}% | rows ${primaryRows.length} vs ${comparisonRows.length}`;
}

export function compareQuotes(primaryQuote: MarketDataQuote, comparisonQuote: MarketDataQuote): string {
  const primaryPrice = primaryQuote.price ?? 0;
  const comparisonPrice = comparisonQuote.price ?? 0;
  if (!comparisonPrice) {
    return "comparison quote missing price";
  }
  const delta = ((primaryPrice - comparisonPrice) / comparisonPrice) * 100;
  return `price delta ${delta.toFixed(2)}%`;
}

function mapSchwabFrequencyType(interval: HistoryInterval): "daily" | "weekly" | "monthly" {
  if (interval === "1wk") {
    return "weekly";
  }
  if (interval === "1mo") {
    return "monthly";
  }
  return "daily";
}
