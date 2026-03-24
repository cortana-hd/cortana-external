import type { AppConfig } from "../config.js";

import { mapSchwabPeriod, type HistoryInterval } from "./history-utils.js";
import { normalizeSchwabQuoteEnvelope, type SchwabQuoteEnvelope } from "./schwab-normalizers.js";
import type { MarketDataHistoryPoint } from "./types.js";

interface JsonRecord {
  [key: string]: unknown;
}

interface SchwabMarketClientConfig {
  config: AppConfig;
  accessTokenProvider: () => Promise<string>;
  fetchJson: <T>(url: string, init?: RequestInit) => Promise<T>;
  recordSchwabRestSuccess: () => void;
}

export interface SchwabStreamerPreferences {
  streamerSocketUrl: string;
  schwabClientCustomerId: string;
  schwabClientCorrelId: string;
  schwabClientChannel: string;
  schwabClientFunctionId: string;
}

export class SchwabMarketClient {
  private readonly config: AppConfig;
  private readonly accessTokenProvider: () => Promise<string>;
  private readonly fetchJson: <T>(url: string, init?: RequestInit) => Promise<T>;
  private readonly recordSchwabRestSuccess: () => void;

  constructor(config: SchwabMarketClientConfig) {
    this.config = config.config;
    this.accessTokenProvider = config.accessTokenProvider;
    this.fetchJson = config.fetchJson;
    this.recordSchwabRestSuccess = config.recordSchwabRestSuccess;
  }

  async fetchStreamerPreferences(): Promise<SchwabStreamerPreferences> {
    const token = await this.accessTokenProvider();
    const defaultUrl = `${this.config.SCHWAB_API_BASE_URL.replace(/\/+$/, "")}/trader/v1/userPreference`;
    const url = this.config.SCHWAB_USER_PREFERENCES_URL.trim() || defaultUrl;
    const payload = await this.fetchJson<JsonRecord | JsonRecord[]>(url, {
      headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
    });
    const root = Array.isArray(payload) ? ((payload[0] as JsonRecord | undefined) ?? {}) : payload;
    const streamerInfo =
      ((Array.isArray(root.streamerInfo) ? root.streamerInfo[0] : root.streamerInfo) as JsonRecord | undefined) ?? root;
    const prefs: SchwabStreamerPreferences = {
      streamerSocketUrl:
        firstString(streamerInfo.streamerSocketUrl, streamerInfo.socketUrl, streamerInfo.streamerUrl) ?? "",
      schwabClientCustomerId:
        firstString(streamerInfo.schwabClientCustomerId, root.schwabClientCustomerId, root.accountId) ?? "",
      schwabClientCorrelId: firstString(streamerInfo.schwabClientCorrelId, root.schwabClientCorrelId) ?? "",
      schwabClientChannel: firstString(streamerInfo.schwabClientChannel, root.schwabClientChannel) ?? "",
      schwabClientFunctionId:
        firstString(streamerInfo.schwabClientFunctionId, root.schwabClientFunctionId) ?? "",
    };
    if (
      !prefs.streamerSocketUrl ||
      !prefs.schwabClientCustomerId ||
      !prefs.schwabClientCorrelId ||
      !prefs.schwabClientChannel ||
      !prefs.schwabClientFunctionId
    ) {
      throw new Error("Schwab user preferences did not include complete streamer connection details");
    }
    this.recordSchwabRestSuccess();
    return prefs;
  }

  async fetchHistory(symbol: string, period: string, interval: HistoryInterval): Promise<MarketDataHistoryPoint[]> {
    const token = await this.accessTokenProvider();
    const params = mapSchwabPeriod(period, interval);
    const url = new URL(`${this.config.SCHWAB_API_BASE_URL.replace(/\/+$/, "")}/marketdata/v1/pricehistory`);
    url.searchParams.set("symbol", symbol);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
    const payload = await this.fetchJson<JsonRecord>(url.toString(), {
      headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
    });
    const candles = ((payload.candles as JsonRecord[] | undefined) ?? []).map((candle) => ({
      timestamp: new Date(Number(candle.datetime ?? 0)).toISOString(),
      open: toNumber(candle.open) ?? NaN,
      high: toNumber(candle.high) ?? NaN,
      low: toNumber(candle.low) ?? NaN,
      close: toNumber(candle.close) ?? NaN,
      volume: toNumber(candle.volume) ?? NaN,
    }));
    const rows = candles.filter((row) => !Object.values(row).some((value) => typeof value === "number" && Number.isNaN(value)));
    if (!rows.length) {
      throw new Error(`Schwab returned no candles for ${symbol}`);
    }
    this.recordSchwabRestSuccess();
    return rows;
  }

  async fetchQuoteEnvelope(symbol: string, asOfDate?: string): Promise<SchwabQuoteEnvelope> {
    const token = await this.accessTokenProvider();
    const url = new URL(`${this.config.SCHWAB_API_BASE_URL.replace(/\/+$/, "")}/marketdata/v1/quotes`);
    url.searchParams.set("symbols", symbol);
    url.searchParams.set("fields", "quote,fundamental");
    const payload = await this.fetchJson<JsonRecord>(url.toString(), {
      headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
    });
    const envelope = normalizeSchwabQuoteEnvelope(payload, symbol, asOfDate || new Date().toISOString().slice(0, 10));
    this.recordSchwabRestSuccess();
    return envelope;
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
