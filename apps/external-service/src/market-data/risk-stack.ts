import { HttpError } from "../lib/http.js";
import type { MarketDataHistoryPoint, MarketDataStatus } from "./types.js";

const CBOE_ENDPOINTS = [
  "https://cdn.cboe.com/api/global/us_indices/market_statistics/put_call_ratio.csv",
  "https://cdn.cboe.com/api/global/us_indices/market_statistics/daily_options_data.csv",
  "https://cdn.cboe.com/api/global/us_indices/market_statistics/put_call_ratio/daily.csv",
  "https://cdn.cboe.com/api/global/us_indices/market_statistics/put_call_ratio.json",
];

export interface RiskRow {
  date: string;
  vix: number;
  spy_close: number;
  hy_spread: number;
  put_call: number;
  vix_percentile: number;
  hy_spread_percentile: number;
  spy_distance_score: number;
  fear_greed: number;
}

export interface RiskPayloadResult {
  rows: RiskRow[];
  meta: {
    source: string;
    status: MarketDataStatus;
    degradedReason: string | null;
    stalenessSeconds: number | null;
  };
  warning: string;
  hySpreadSource: string;
  hySpreadFallback: boolean;
}

interface RiskStackOptions {
  days: number;
  fredApiKey: string;
  fetchSchwabHistory: (symbol: string, period: string, interval: "1d" | "1wk" | "1mo") => Promise<MarketDataHistoryPoint[]>;
  fetchJson: <T>(url: string, init?: RequestInit) => Promise<T>;
  fetchResponse: (input: string | URL, init?: RequestInit, timeoutMs?: number) => Promise<Response>;
}

export async function buildRiskPayload(options: RiskStackOptions): Promise<RiskPayloadResult> {
  const lookbackDays = Math.max(options.days, 160) * 2;
  const [vixHistory, spyHistory, hySeries, putCallSeries] = await Promise.all([
    options.fetchSchwabHistory("^VIX", "1y", "1d").catch(() => []),
    options.fetchSchwabHistory("SPY", "1y", "1d").catch(() => []),
    fetchFredSeries(options.fetchJson, options.fredApiKey, "BAMLH0A0HYM2", lookbackDays).catch(() => []),
    fetchPutCallHistory(options.fetchResponse, lookbackDays).catch(() => []),
  ]);
  const vixProxySeries = vixHistory.length ? [] : deriveVixProxySeries(spyHistory);
  const vixSourceRows = vixHistory.length
    ? vixHistory.map((row) => ({ date: row.timestamp.slice(0, 10), value: row.close }))
    : vixProxySeries;

  const baseDates = dedupe([
    ...spyHistory.map((row) => row.timestamp.slice(0, 10)),
    ...vixHistory.map((row) => row.timestamp.slice(0, 10)),
    ...vixProxySeries.map((row) => row.date),
    ...hySeries.map((row) => row.date),
    ...putCallSeries.map((row) => row.date),
  ]).sort();
  if (!baseDates.length) {
    throw new Error("Unable to build risk payload from upstream sources");
  }

  const vixMap = buildSeriesMap(vixSourceRows);
  const spyMap = buildSeriesMap(spyHistory.map((row) => ({ date: row.timestamp.slice(0, 10), value: row.close })));
  const hyMap = buildSeriesMap(hySeries);
  const putCallMap = buildSeriesMap(putCallSeries);

  const rows: RiskRow[] = [];
  let lastVix = 20;
  let lastSpy = 500;
  let lastHy = 450;
  let lastPutCall = 1;
  const hySpreadFallback = !hySeries.length;
  const warning = hySpreadFallback ? "FRED HY spread unavailable; using neutral 450 bps fallback." : "";
  for (const date of baseDates) {
    lastVix = vixMap.get(date) ?? lastVix;
    lastSpy = spyMap.get(date) ?? lastSpy;
    lastHy = hyMap.get(date) ?? lastHy;
    lastPutCall = putCallMap.get(date) ?? lastPutCall;
    rows.push({
      date,
      vix: lastVix,
      spy_close: lastSpy,
      hy_spread: lastHy,
      put_call: clamp(lastPutCall, 0.3, 3.0),
      vix_percentile: 0,
      hy_spread_percentile: 0,
      spy_distance_score: 50,
      fear_greed: 50,
    });
  }

  const vixPercentiles = percentileArray(rows.map((row) => row.vix));
  const hyPercentiles = percentileArray(rows.map((row) => row.hy_spread));
  const spyDistanceScores = spyDistanceScoresFromClose(rows.map((row) => row.spy_close));
  for (let index = 0; index < rows.length; index += 1) {
    rows[index].vix_percentile = vixPercentiles[index];
    rows[index].hy_spread_percentile = hyPercentiles[index];
    rows[index].spy_distance_score = spyDistanceScores[index];
    rows[index].fear_greed = clamp((vixPercentiles[index] + hyPercentiles[index] + spyDistanceScores[index]) / 3, 0, 100);
  }

  return {
    rows: rows.slice(-options.days),
    meta: {
      source: "ts-risk-stack",
      status: hySpreadFallback || !vixHistory.length ? "degraded" : "ok",
      degradedReason: hySpreadFallback ? warning : !vixHistory.length ? "Schwab VIX history unavailable; using SPY realized-vol proxy." : null,
      stalenessSeconds: 0,
    },
    warning: hySpreadFallback ? warning : !vixHistory.length ? "Schwab VIX history unavailable; using SPY realized-vol proxy." : "",
    hySpreadSource: hySpreadFallback ? "fallback_default_450" : "fred",
    hySpreadFallback,
  };
}

async function fetchFredSeries(
  fetchJson: <T>(url: string, init?: RequestInit) => Promise<T>,
  fredApiKey: string,
  seriesId: string,
  lookbackDays: number,
): Promise<Array<{ date: string; value: number }>> {
  const end = new Date();
  const start = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const url = new URL("https://api.stlouisfed.org/fred/series/observations");
  url.searchParams.set("series_id", seriesId);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("observation_start", start.toISOString().slice(0, 10));
  url.searchParams.set("observation_end", end.toISOString().slice(0, 10));
  if (fredApiKey.trim()) {
    url.searchParams.set("api_key", fredApiKey.trim());
  }
  const payload = await fetchJson<Record<string, unknown>>(url.toString(), { headers: { accept: "application/json" } });
  const observations = ((payload.observations as Record<string, unknown>[] | undefined) ?? [])
    .map((row) => ({ date: String(row.date ?? ""), value: toNumber(row.value) }))
    .filter((row): row is { date: string; value: number } => Boolean(row.date) && row.value != null);
  return observations;
}

async function fetchPutCallHistory(
  fetchResponse: (input: string | URL, init?: RequestInit, timeoutMs?: number) => Promise<Response>,
  lookbackDays: number,
): Promise<Array<{ date: string; value: number }>> {
  const startDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  for (const endpoint of CBOE_ENDPOINTS) {
    try {
      const response = await fetchResponse(endpoint, { headers: { accept: "*/*" } }, 10_000);
      if (!response.ok) {
        continue;
      }
      const contentType = response.headers.get("content-type") ?? "";
      const body = await response.text();
      const rows = contentType.includes("json") || endpoint.endsWith(".json") ? parsePutCallJson(body) : parsePutCallCsv(body);
      const filtered = rows.filter((row) => row.date >= startDate);
      if (filtered.length) {
        return filtered.map((row) => ({ date: row.date, value: clamp(row.value, 0.3, 3.0) }));
      }
    } catch (error) {
      if (error instanceof HttpError) {
        continue;
      }
      continue;
    }
  }
  return [];
}

function buildSeriesMap(rows: Array<{ date: string; value: number }>): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    if (row.date && Number.isFinite(row.value)) {
      out.set(row.date, row.value);
    }
  }
  return out;
}

function percentileArray(values: number[]): number[] {
  const sorted = values
    .map((value, index) => ({ value, index }))
    .filter((item) => Number.isFinite(item.value))
    .sort((a, b) => a.value - b.value);
  const out = Array.from({ length: values.length }, () => 50);
  sorted.forEach((item, index) => {
    out[item.index] = ((index + 1) / sorted.length) * 100;
  });
  return out;
}

function spyDistanceScoresFromClose(close: number[]): number[] {
  const out: number[] = [];
  for (let index = 0; index < close.length; index += 1) {
    const window = close.slice(Math.max(0, index - 124), index + 1);
    const average = window.reduce((sum, value) => sum + value, 0) / window.length;
    const distancePct = average ? ((average - close[index]) / average) * 100 : 0;
    out.push(clamp(((distancePct + 10) / 20) * 100, 0, 100));
  }
  return out;
}

function deriveVixProxySeries(spyHistory: MarketDataHistoryPoint[]): Array<{ date: string; value: number }> {
  if (spyHistory.length < 10) {
    return [];
  }
  const closes = spyHistory
    .map((row) => ({
      date: row.timestamp.slice(0, 10),
      close: row.close,
    }))
    .filter((row) => Boolean(row.date) && Number.isFinite(row.close));
  const output: Array<{ date: string; value: number }> = [];
  for (let index = 5; index < closes.length; index += 1) {
    const window = closes.slice(Math.max(0, index - 20), index + 1);
    const returns: number[] = [];
    for (let cursor = 1; cursor < window.length; cursor += 1) {
      const prev = window[cursor - 1]?.close ?? 0;
      const current = window[cursor]?.close ?? 0;
      if (prev > 0 && current > 0) {
        returns.push((current - prev) / prev);
      }
    }
    if (returns.length < 5) {
      continue;
    }
    const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
    const variance = returns.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / returns.length;
    const realizedVol = Math.sqrt(Math.max(variance, 0)) * Math.sqrt(252) * 100;
    output.push({
      date: closes[index]?.date ?? "",
      value: clamp(realizedVol, 8, 80),
    });
  }
  return output;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function parsePutCallCsv(body: string): Array<{ date: string; value: number }> {
  const [headerLine, ...lines] = body.split(/\r?\n/).filter(Boolean);
  if (!headerLine) {
    return [];
  }
  const headers = headerLine.split(",").map((value) => value.trim());
  const dateIndex = headers.findIndex((value) => value.toLowerCase().includes("date"));
  const ratioIndex = headers.findIndex((value) => {
    const lowered = value.toLowerCase();
    return lowered.includes("ratio") || lowered.includes("put/call") || lowered.includes("put_call") || lowered.includes("p/c");
  });
  if (dateIndex < 0 || ratioIndex < 0) {
    return [];
  }
  return lines
    .map((line) => line.split(","))
    .map((parts) => ({ date: parts[dateIndex]?.trim() ?? "", value: Number(parts[ratioIndex]) }))
    .filter((row) => row.date && Number.isFinite(row.value));
}

function parsePutCallJson(body: string): Array<{ date: string; value: number }> {
  try {
    const payload = JSON.parse(body) as Record<string, unknown>;
    const rows = Array.isArray(payload.data) ? payload.data : Array.isArray(payload) ? (payload as unknown as Record<string, unknown>[]) : [];
    return rows
      .map((row) => ({
        date: String(firstValue(row.date, row.tradeDate, row.asOfDate) ?? ""),
        value: toNumber(firstValue(row.putCallRatio, row.put_call_ratio, row.totalPutCallRatio)) ?? NaN,
      }))
      .filter((row) => row.date && Number.isFinite(row.value));
  } catch {
    return [];
  }
}

function dedupe<T>(values: T[]): T[] {
  return [...new Set(values)];
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

function firstValue(...values: unknown[]): unknown {
  for (const value of values) {
    if (value != null) {
      return value;
    }
  }
  return undefined;
}
