import fs from "node:fs";
import path from "node:path";

import type { AppConfig } from "../config.js";
import { HttpError } from "../lib/http.js";
import type { AppLogger } from "../lib/logger.js";
import {
  extractCoinMarketCapSymbol,
  mapCoinMarketCapInterval,
  normalizeCoinMarketCapFundamentals,
  normalizeCoinMarketCapHistory,
  normalizeCoinMarketCapMetadata,
  normalizeCoinMarketCapQuote,
  pickCoinMarketCapInfoEntry,
  resolveCoinMarketCapTimeRange,
} from "./coinmarketcap-client.js";
import type { HistoryInterval } from "./history-utils.js";
import type { MarketDataHistoryPoint, MarketDataQuote } from "./types.js";

type FetchJson = <T>(url: string, init?: RequestInit) => Promise<T>;

interface JsonRecord {
  [key: string]: unknown;
}

interface CryptoDailyCacheEntry {
  symbol: string;
  refreshedAt: string;
  quote: MarketDataQuote;
  fundamentals: Record<string, unknown>;
  metadata: Record<string, unknown>;
  rows: MarketDataHistoryPoint[];
}

interface CryptoDailyCacheFile {
  updatedAt: string;
  symbols: Record<string, CryptoDailyCacheEntry>;
}

interface CoinMarketCapServiceConfig {
  config: AppConfig;
  cacheDir: string;
  logger: AppLogger;
  fetchJson: FetchJson;
}

export class CoinMarketCapService {
  private readonly config: AppConfig;
  private readonly cacheDir: string;
  private readonly logger: AppLogger;
  private readonly fetchJson: FetchJson;

  constructor(config: CoinMarketCapServiceConfig) {
    this.config = config.config;
    this.cacheDir = config.cacheDir;
    this.logger = config.logger;
    this.fetchJson = config.fetchJson;
  }

  isConfigured(): boolean {
    return Boolean(this.config.COINMARKETCAP_API_KEY.trim());
  }

  async fetchQuote(symbol: string): Promise<MarketDataQuote> {
    const cached = this.readCryptoDailyCacheEntry(symbol);
    if (cached && isSameUtcDay(cached.refreshedAt, new Date().toISOString())) {
      return cached.quote;
    }
    const entry = await this.fetchLatestEntry(symbol);
    const quote = normalizeCoinMarketCapQuote(entry, symbol);
    await this.maybeRefreshDailyCacheFromLiveEntry(symbol, entry);
    return quote;
  }

  async fetchFundamentals(symbol: string): Promise<Record<string, unknown>> {
    const cached = this.readCryptoDailyCacheEntry(symbol);
    if (cached && isSameUtcDay(cached.refreshedAt, new Date().toISOString())) {
      return cached.fundamentals;
    }
    const entry = await this.fetchLatestEntry(symbol);
    const fundamentals = normalizeCoinMarketCapFundamentals(entry, symbol);
    await this.maybeRefreshDailyCacheFromLiveEntry(symbol, entry);
    return fundamentals;
  }

  async fetchMetadata(symbol: string): Promise<Record<string, unknown>> {
    const cached = this.readCryptoDailyCacheEntry(symbol);
    if (cached && isSameUtcDay(cached.refreshedAt, new Date().toISOString())) {
      return cached.metadata;
    }
    const entry = await this.fetchLatestEntry(symbol);
    const infoEntry = await this.fetchInfoEntry(symbol, firstString(entry.slug));
    const metadata = normalizeCoinMarketCapMetadata(entry, infoEntry, symbol);
    await this.writeCryptoDailyCacheEntry(symbol, entry, infoEntry);
    return metadata;
  }

  async fetchHistory(symbol: string, period: string, interval: HistoryInterval): Promise<MarketDataHistoryPoint[]> {
    const cached = this.readCryptoDailyCacheEntry(symbol);
    if (cached) {
      const rows = this.filterHistoryRows(cached.rows, period, interval);
      if (rows.length) {
        return rows;
      }
    }
    const entry = await this.fetchLatestEntry(symbol);
    const coinId = toNumber(entry.id);
    if (coinId == null) {
      throw new Error(`CoinMarketCap returned no canonical id for ${symbol}`);
    }
    const { timeStart, timeEnd } = resolveCoinMarketCapTimeRange(period);
    const payload = await this.fetchCoinMarketCapJson<JsonRecord>("/v1/cryptocurrency/quotes/historical", {
      id: String(coinId),
      convert: "USD",
      interval: mapCoinMarketCapInterval(interval),
      time_start: timeStart,
      time_end: timeEnd,
    });
    const quotes = Array.isArray((payload.data as JsonRecord | undefined)?.quotes)
      ? (((payload.data as JsonRecord).quotes as JsonRecord[]) ?? [])
      : [];
    const rows = normalizeCoinMarketCapHistory(quotes, symbol);
    if (!rows.length) {
      throw new Error(`CoinMarketCap returned no historical quotes for ${symbol}`);
    }
    return rows;
  }

  async refreshDailyCache(symbols: string[], force: boolean): Promise<Record<string, unknown>> {
    const cache = this.readCryptoDailyCache();
    const refreshed: Array<Record<string, unknown>> = [];
    const today = new Date().toISOString();
    for (const symbol of symbols) {
      const existing = cache.symbols[symbol];
      if (!force && existing && isSameUtcDay(existing.refreshedAt, today)) {
        refreshed.push({ symbol, status: "skipped", refreshedAt: existing.refreshedAt, rowCount: existing.rows.length });
        continue;
      }
      const entry = await this.fetchLatestEntry(symbol);
      const infoEntry = await this.fetchInfoEntry(symbol, firstString(entry.slug));
      const updated = this.buildCryptoDailyCacheEntry(symbol, entry, infoEntry, existing?.rows ?? []);
      cache.symbols[symbol] = updated;
      refreshed.push({ symbol, status: "refreshed", refreshedAt: updated.refreshedAt, rowCount: updated.rows.length });
    }
    cache.updatedAt = new Date().toISOString();
    this.writeCryptoDailyCache(cache);
    return {
      updatedAt: cache.updatedAt,
      symbols,
      refreshed,
      artifactPath: this.cryptoDailyCachePath(),
    };
  }

  private async fetchLatestEntry(symbol: string): Promise<JsonRecord> {
    const cmcSymbol = extractCoinMarketCapSymbol(symbol);
    if (!cmcSymbol) {
      throw new Error(`CoinMarketCap does not support non-crypto symbol ${symbol}`);
    }
    const payload = await this.fetchCoinMarketCapJson<JsonRecord>("/v1/cryptocurrency/quotes/latest", {
      symbol: cmcSymbol,
      convert: "USD",
    });
    const data = (payload.data as JsonRecord | undefined) ?? {};
    const entry = data[cmcSymbol];
    if (entry && !Array.isArray(entry) && typeof entry === "object") {
      return entry as JsonRecord;
    }
    if (Array.isArray(entry) && entry[0] && typeof entry[0] === "object") {
      return entry[0] as JsonRecord;
    }
    throw new Error(`CoinMarketCap returned no quote payload for ${symbol}`);
  }

  private async fetchInfoEntry(symbol: string, preferredSlug?: string): Promise<JsonRecord | undefined> {
    const cmcSymbol = extractCoinMarketCapSymbol(symbol);
    if (!cmcSymbol) {
      return undefined;
    }
    const payload = await this.fetchCoinMarketCapJson<JsonRecord>("/v2/cryptocurrency/info", {
      symbol: cmcSymbol,
    });
    const data = (payload.data as JsonRecord | undefined) ?? {};
    return pickCoinMarketCapInfoEntry(data[cmcSymbol], preferredSlug);
  }

  private async maybeRefreshDailyCacheFromLiveEntry(symbol: string, entry: JsonRecord): Promise<void> {
    const cached = this.readCryptoDailyCacheEntry(symbol);
    if (cached && isSameUtcDay(cached.refreshedAt, new Date().toISOString())) {
      return;
    }
    const infoEntry = await this.fetchInfoEntry(symbol, firstString(entry.slug)).catch(() => undefined);
    await this.writeCryptoDailyCacheEntry(symbol, entry, infoEntry);
  }

  private readCryptoDailyCacheEntry(symbol: string): CryptoDailyCacheEntry | null {
    return this.readCryptoDailyCache().symbols[normalizeCryptoCacheKey(symbol)] ?? null;
  }

  private readCryptoDailyCache(): CryptoDailyCacheFile {
    const artifactPath = this.cryptoDailyCachePath();
    try {
      const raw = fs.readFileSync(artifactPath, "utf8");
      const parsed = JSON.parse(raw) as CryptoDailyCacheFile;
      return {
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
        symbols: parsed && typeof parsed.symbols === "object" && parsed.symbols ? parsed.symbols : {},
      } as CryptoDailyCacheFile;
    } catch {
      return { updatedAt: new Date(0).toISOString(), symbols: {} };
    }
  }

  private writeCryptoDailyCache(cache: CryptoDailyCacheFile): void {
    try {
      fs.mkdirSync(this.cacheDir, { recursive: true });
      fs.writeFileSync(this.cryptoDailyCachePath(), JSON.stringify(cache, null, 2));
    } catch (error) {
      this.logger.error("Unable to persist crypto daily cache", error);
    }
  }

  private async writeCryptoDailyCacheEntry(symbol: string, entry: JsonRecord, infoEntry?: JsonRecord): Promise<void> {
    const cache = this.readCryptoDailyCache();
    const cacheKey = normalizeCryptoCacheKey(symbol);
    cache.symbols[cacheKey] = this.buildCryptoDailyCacheEntry(cacheKey, entry, infoEntry, cache.symbols[cacheKey]?.rows ?? []);
    cache.updatedAt = new Date().toISOString();
    this.writeCryptoDailyCache(cache);
  }

  private buildCryptoDailyCacheEntry(
    symbol: string,
    entry: JsonRecord,
    infoEntry: JsonRecord | undefined,
    existingRows: MarketDataHistoryPoint[],
  ): CryptoDailyCacheEntry {
    const quote = normalizeCoinMarketCapQuote(entry, symbol);
    const fundamentals = normalizeCoinMarketCapFundamentals(entry, symbol);
    const metadata = normalizeCoinMarketCapMetadata(entry, infoEntry, symbol);
    const refreshedAt = quote.timestamp || new Date().toISOString();
    const dailyRow: MarketDataHistoryPoint = {
      timestamp: startOfUtcDayIso(refreshedAt),
      open: quote.price ?? 0,
      high: quote.price ?? 0,
      low: quote.price ?? 0,
      close: quote.price ?? 0,
      volume: quote.volume ?? 0,
    };
    const rows = upsertDailyHistoryRow(existingRows, dailyRow).slice(-400);
    return {
      symbol,
      refreshedAt,
      quote,
      fundamentals,
      metadata,
      rows,
    };
  }

  private filterHistoryRows(rows: MarketDataHistoryPoint[], period: string, interval: HistoryInterval): MarketDataHistoryPoint[] {
    const cutoff = resolveCoinMarketCapTimeRange(period).timeStart;
    const cutoffMs = Date.parse(cutoff);
    const filtered = rows
      .filter((row) => Date.parse(row.timestamp) >= cutoffMs)
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    if (interval === "1d") {
      return filtered;
    }
    return compressHistoryRows(filtered, interval);
  }

  private cryptoDailyCachePath(): string {
    return path.join(this.cacheDir, "crypto-daily-cache.json");
  }

  private async fetchCoinMarketCapJson<T>(endpoint: string, params: Record<string, string>): Promise<T> {
    const apiKey = this.config.COINMARKETCAP_API_KEY.trim();
    if (!apiKey) {
      throw new Error("CoinMarketCap API key is not configured");
    }
    const url = new URL(`${this.config.COINMARKETCAP_API_BASE_URL.replace(/\/+$/, "")}${endpoint}`);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    let payload: JsonRecord;
    try {
      payload = await this.fetchJson<JsonRecord>(url.toString(), {
        headers: {
          "X-CMC_PRO_API_KEY": apiKey,
          accept: "application/json",
        },
      });
    } catch (error) {
      if (error instanceof HttpError) {
        const parsed = this.tryParseErrorPayload(error.body);
        if (parsed) {
          throw new Error(parsed);
        }
      }
      throw error;
    }
    const status = (payload.status as JsonRecord | undefined) ?? {};
    const errorCode = toNumber(status.error_code) ?? 0;
    if (errorCode !== 0) {
      const message = firstString(status.error_message) ?? "CoinMarketCap request failed";
      if (errorCode === 1006 && endpoint.includes("/historical")) {
        throw new Error("CoinMarketCap historical quotes are not available on the configured API plan");
      }
      throw new Error(message);
    }
    return payload as T;
  }

  private tryParseErrorPayload(rawBody: string): string | null {
    try {
      const payload = JSON.parse(rawBody) as JsonRecord;
      const status = (payload.status as JsonRecord | undefined) ?? {};
      const errorCode = toNumber(status.error_code) ?? 0;
      const message = firstString(status.error_message);
      if (!errorCode && !message) {
        return null;
      }
      if (errorCode === 1006) {
        return "CoinMarketCap historical quotes are not available on the configured API plan";
      }
      return message ?? `CoinMarketCap request failed (${errorCode})`;
    } catch {
      return null;
    }
  }
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

function startOfUtcDayIso(value: string): string {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

function isSameUtcDay(left: string, right: string): boolean {
  return startOfUtcDayIso(left) === startOfUtcDayIso(right);
}

function normalizeCryptoCacheKey(symbol: string): string {
  return extractCoinMarketCapSymbol(symbol) ?? symbol;
}

function upsertDailyHistoryRow(rows: MarketDataHistoryPoint[], nextRow: MarketDataHistoryPoint): MarketDataHistoryPoint[] {
  const nextDay = startOfUtcDayIso(nextRow.timestamp);
  const filtered = rows.filter((row) => startOfUtcDayIso(row.timestamp) !== nextDay);
  filtered.push({ ...nextRow, timestamp: nextDay });
  return filtered.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

function compressHistoryRows(rows: MarketDataHistoryPoint[], interval: HistoryInterval): MarketDataHistoryPoint[] {
  const buckets = new Map<string, MarketDataHistoryPoint[]>();
  for (const row of rows) {
    const timestamp = new Date(row.timestamp);
    const key =
      interval === "1wk"
        ? `${timestamp.getUTCFullYear()}-W${isoWeekNumber(timestamp)}`
        : `${timestamp.getUTCFullYear()}-${String(timestamp.getUTCMonth() + 1).padStart(2, "0")}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(row);
    buckets.set(key, bucket);
  }
  return [...buckets.values()].map((bucket) => {
    const ordered = bucket.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    return {
      timestamp: ordered[0].timestamp,
      open: ordered[0].open,
      high: Math.max(...ordered.map((row) => row.high)),
      low: Math.min(...ordered.map((row) => row.low)),
      close: ordered[ordered.length - 1].close,
      volume: ordered.reduce((sum, row) => sum + row.volume, 0),
    };
  });
}

function isoWeekNumber(date: Date): number {
  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  return Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}
