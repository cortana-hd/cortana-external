export const LIVE_EVENT_LINKS = [
  {
    match: /(?:inflation upside risk|cpi|exactly\s*\d+(?:\.\d+)?)/i,
    theme: "inflation",
    regimeEffect: "mixed",
    watchTickers: ["QQQ", "ARKK", "XLE", "XOM", "CVX"],
  },
  {
    match: /(?:fed easing odds|rate[-\s]?cut|cut\s*\d+(?:\.\d+)?\s*bps)/i,
    theme: "rates",
    regimeEffect: "mixed",
    watchTickers: ["SPY", "QQQ", "DIA", "NVDA", "AMD", "MSFT"],
  },
  {
    match: /(?:rate[-\s]?hike|hike\s*>\s*\d+(?:\.\d+)?\s*bps)/i,
    theme: "rates",
    regimeEffect: "mixed",
    watchTickers: ["SPY", "QQQ", "DIA", "NVDA", "AMD", "MSFT"],
  },
] as const;

export type PolymarketLiveLinkedMarket = {
  title: string;
  lastTrade: number | null;
  bestBid: number | null;
  bestAsk: number | null;
};

export function getPolymarketLiveEventLink(title: string, eventTitle?: string | null) {
  const searchableText = [title, eventTitle]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ");
  return LIVE_EVENT_LINKS.find((entry) => entry.match.test(searchableText)) ?? null;
}

export function getPolymarketLiveMarketProbability(market: PolymarketLiveLinkedMarket): number | null {
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

export function getPolymarketSeverity(probability: number | null): string {
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

export function getPolymarketLinkedAssetClass(symbol: string): string {
  return ["SPY", "QQQ", "DIA", "ARKK", "XLE"].includes(symbol) ? "etf" : "stock";
}
