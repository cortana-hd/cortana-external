import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { AppConfig } from "../config.js";

import { mapAlpacaTimeframe, type HistoryInterval } from "./history-utils.js";
import { normalizeAlpacaBarLimit, normalizeAlpacaDataUrl } from "./route-utils.js";
import type { MarketDataHistoryPoint, MarketDataQuote } from "./types.js";

interface JsonRecord {
  [key: string]: unknown;
}

interface AlpacaKeys {
  key_id: string;
  secret_key: string;
  data_url: string;
}

interface AlpacaClientConfig {
  config: AppConfig;
  fetchJson: <T>(url: string, init?: RequestInit) => Promise<T>;
}

export class AlpacaClient {
  private readonly config: AppConfig;
  private readonly fetchJson: <T>(url: string, init?: RequestInit) => Promise<T>;

  constructor(config: AlpacaClientConfig) {
    this.config = config.config;
    this.fetchJson = config.fetchJson;
  }

  async fetchHistory(symbol: string, period: string, interval: HistoryInterval): Promise<MarketDataHistoryPoint[]> {
    const keys = await this.getKeys();
    const url = new URL(`${keys.data_url}/v2/stocks/${encodeURIComponent(symbol)}/bars`);
    url.searchParams.set("timeframe", mapAlpacaTimeframe(interval));
    url.searchParams.set("limit", String(normalizeAlpacaBarLimit(period)));
    url.searchParams.set("adjustment", "raw");
    url.searchParams.set("feed", "iex");
    const payload = await this.fetchJson<JsonRecord>(url.toString(), {
      headers: {
        "APCA-API-KEY-ID": keys.key_id,
        "APCA-API-SECRET-KEY": keys.secret_key,
        accept: "application/json",
      },
    });
    const rows = ((payload.bars as JsonRecord[] | undefined) ?? [])
      .map((bar) => ({
        timestamp: String(bar.t ?? ""),
        open: toNumber(bar.o) ?? NaN,
        high: toNumber(bar.h) ?? NaN,
        low: toNumber(bar.l) ?? NaN,
        close: toNumber(bar.c) ?? NaN,
        volume: toNumber(bar.v) ?? NaN,
      }))
      .filter(
        (row) =>
          Boolean(row.timestamp) &&
          !Object.values(row).some((value) => typeof value === "number" && Number.isNaN(value)),
      );
    if (!rows.length) {
      throw new Error(`Alpaca returned no bars for ${symbol}`);
    }
    return rows;
  }

  async fetchQuote(symbol: string): Promise<MarketDataQuote> {
    const keys = await this.getKeys();
    const tradeUrl = `${keys.data_url}/v2/stocks/${encodeURIComponent(symbol)}/trades/latest?feed=iex`;
    const tradePayload = await this.fetchJson<JsonRecord>(tradeUrl, {
      headers: {
        "APCA-API-KEY-ID": keys.key_id,
        "APCA-API-SECRET-KEY": keys.secret_key,
        accept: "application/json",
      },
    });
    const trade = (tradePayload.trade as JsonRecord | undefined) ?? {};
    const price = toNumber(trade.p);
    if (price == null) {
      throw new Error(`Alpaca returned no trade price for ${symbol}`);
    }
    return {
      symbol,
      price,
      timestamp: typeof trade.t === "string" ? trade.t : new Date().toISOString(),
      currency: "USD",
    };
  }

  private async getKeys(): Promise<AlpacaKeys> {
    const envKeyId = (process.env.ALPACA_KEY ?? process.env.ALPACA_KEY_ID ?? "").trim();
    const envSecret = (process.env.ALPACA_SECRET_KEY ?? "").trim();
    const envDataUrl = (process.env.ALPACA_DATA_URL ?? "").trim();
    if (envKeyId && envSecret) {
      return {
        key_id: envKeyId,
        secret_key: envSecret,
        data_url: normalizeAlpacaDataUrl(envDataUrl || "https://data.alpaca.markets"),
      };
    }

    const keyPath =
      (process.env.ALPACA_KEYS_PATH ?? this.config.ALPACA_KEYS_PATH ?? "").trim() ||
      path.join(os.homedir(), "Desktop", "services", "alpaca_keys.json");
    try {
      const raw = await fs.promises.readFile(keyPath, "utf8");
      const parsed = JSON.parse(raw) as JsonRecord;
      const keyId = String(parsed.key_id ?? "").trim();
      const secret = String(parsed.secret_key ?? "").trim();
      const dataUrl = normalizeAlpacaDataUrl(String(parsed.data_url ?? "https://data.alpaca.markets"));
      if (!keyId || !secret) {
        throw new Error("alpaca keys file is missing credentials");
      }
      return { key_id: keyId, secret_key: secret, data_url: dataUrl };
    } catch (error) {
      throw new Error(`Alpaca credentials unavailable: ${summarizeError(error)}`);
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

function summarizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
