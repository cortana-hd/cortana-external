import type { MarketDataHistoryPoint, MarketDataQuote } from "./types.js";

type JsonRecord = Record<string, unknown>;

const DIRECT_CRYPTO_SYMBOLS = new Set(["BTC", "ETH", "SOL"]);

export function extractCoinMarketCapSymbol(rawSymbol: string): string | null {
  const symbol = String(rawSymbol).trim().toUpperCase();
  if (!symbol || symbol.startsWith("/")) {
    return null;
  }
  if (symbol.endsWith("-USD")) {
    const base = symbol.slice(0, -4).trim();
    return /^[A-Z0-9]{2,15}$/.test(base) ? base : null;
  }
  return DIRECT_CRYPTO_SYMBOLS.has(symbol) ? symbol : null;
}

export function normalizeCoinMarketCapQuote(entry: JsonRecord, requestedSymbol: string): MarketDataQuote {
  const quote = ((entry.quote as JsonRecord | undefined)?.USD as JsonRecord | undefined) ?? {};
  const price = toNumber(quote.price);
  const percentChange24h = toNumber(quote.percent_change_24h);
  return {
    symbol: requestedSymbol,
    price: price ?? undefined,
    change:
      price != null && percentChange24h != null
        ? price - price / (1 + percentChange24h / 100)
        : undefined,
    changePercent: percentChange24h ?? undefined,
    timestamp: firstString(quote.last_updated, entry.last_updated),
    currency: "USD",
    volume: toNumber(quote.volume_24h) ?? undefined,
    week52High: undefined,
    week52Low: undefined,
    securityStatus: "CRYPTO",
  };
}

export function normalizeCoinMarketCapFundamentals(entry: JsonRecord, requestedSymbol: string): Record<string, unknown> {
  const quote = ((entry.quote as JsonRecord | undefined)?.USD as JsonRecord | undefined) ?? {};
  return {
    symbol: requestedSymbol,
    asset_class: "crypto",
    cmc_id: toNumber(entry.id),
    slug: firstString(entry.slug),
    category: firstString(entry.category),
    rank: toNumber(entry.cmc_rank),
    circulating_supply: toNumber(entry.circulating_supply),
    total_supply: toNumber(entry.total_supply),
    max_supply: toNumber(entry.max_supply),
    market_cap: toNumber(quote.market_cap),
    fully_diluted_market_cap: toNumber(quote.fully_diluted_market_cap),
    volume_24h: toNumber(quote.volume_24h),
    percent_change_1h: toNumber(quote.percent_change_1h),
    percent_change_24h: toNumber(quote.percent_change_24h),
    percent_change_7d: toNumber(quote.percent_change_7d),
    percent_change_30d: toNumber(quote.percent_change_30d),
    percent_change_90d: toNumber(quote.percent_change_90d),
    last_updated: firstString(quote.last_updated, entry.last_updated),
  };
}

export function normalizeCoinMarketCapMetadata(
  entry: JsonRecord,
  infoEntry: JsonRecord | undefined,
  requestedSymbol: string,
): Record<string, unknown> {
  const info = infoEntry ?? {};
  const urls = (info.urls as JsonRecord | undefined) ?? {};
  return {
    symbol: requestedSymbol,
    asset_class: "crypto",
    name: firstString(entry.name, info.name),
    slug: firstString(entry.slug, info.slug),
    logo: firstString(info.logo),
    description: firstString(info.description),
    category: firstString(info.category),
    date_added: firstString(entry.date_added, info.date_added),
    date_launched: firstString(info.date_launched),
    website: firstArrayString(urls.website),
    technical_doc: firstArrayString(urls.technical_doc),
    explorer: firstArrayString(urls.explorer),
    tags: Array.isArray(info.tags) ? info.tags : [],
  };
}

export function normalizeCoinMarketCapHistory(
  quotes: JsonRecord[],
  requestedSymbol: string,
): MarketDataHistoryPoint[] {
  return quotes
    .map((row) => {
      const quote = ((row.quote as JsonRecord | undefined)?.USD as JsonRecord | undefined) ?? {};
      const price = toNumber(quote.price);
      const timestamp = firstString(row.timestamp, quote.last_updated);
      return {
        symbol: requestedSymbol,
        timestamp,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: toNumber(quote.volume_24h) ?? 0,
      };
    })
    .filter(
      (row): row is MarketDataHistoryPoint & { symbol: string } =>
        Boolean(row.timestamp) &&
        row.open != null &&
        row.high != null &&
        row.low != null &&
        row.close != null,
    )
    .map(({ symbol: _symbol, ...row }) => row);
}

export function pickCoinMarketCapInfoEntry(entries: unknown, preferredSlug?: string): JsonRecord | undefined {
  const candidates = Array.isArray(entries) ? (entries as JsonRecord[]) : [];
  if (!candidates.length) {
    return undefined;
  }
  if (preferredSlug) {
    const matched = candidates.find((entry) => firstString(entry.slug) === preferredSlug);
    if (matched) {
      return matched;
    }
  }
  return [...candidates].sort((left, right) => scoreInfoEntry(right) - scoreInfoEntry(left))[0];
}

export function resolveCoinMarketCapTimeRange(period: string, now = new Date()): { timeStart: string; timeEnd: string } {
  const normalized = period.trim().toLowerCase();
  const end = new Date(now);
  const start = new Date(now);
  if (normalized.endsWith("d")) {
    const days = Math.max(parseInt(normalized.slice(0, -1), 10) || 1, 1);
    start.setUTCDate(start.getUTCDate() - days);
  } else if (normalized.endsWith("mo")) {
    const months = Math.max(parseInt(normalized.slice(0, -2), 10) || 1, 1);
    start.setUTCMonth(start.getUTCMonth() - months);
  } else {
    const years = Math.max(parseInt(normalized.replace(/[^0-9]/g, ""), 10) || 1, 1);
    start.setUTCFullYear(start.getUTCFullYear() - years);
  }
  return { timeStart: start.toISOString(), timeEnd: end.toISOString() };
}

export function mapCoinMarketCapInterval(interval: "1d" | "1wk" | "1mo"): "daily" | "weekly" | "monthly" {
  if (interval === "1wk") {
    return "weekly";
  }
  if (interval === "1mo") {
    return "monthly";
  }
  return "daily";
}

function scoreInfoEntry(entry: JsonRecord): number {
  let score = 0;
  if (!entry.platform) {
    score += 100;
  }
  const rank = toNumber(entry.rank);
  if (rank != null) {
    score += Math.max(10_000 - rank, 0);
  }
  if (toNumber(entry.is_active) === 1 || toNumber(entry.status) === 1) {
    score += 1_000;
  }
  return score;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function firstArrayString(value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.find((entry) => typeof entry === "string" && entry.trim()) as string | undefined;
}
