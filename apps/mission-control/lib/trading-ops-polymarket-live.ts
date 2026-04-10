import fs from "node:fs";
import path from "node:path";

import type { TradingOpsPolymarketLiveData } from "@/lib/trading-ops-contract";
import { getBacktesterRepoPath } from "@/lib/runtime-paths";

const DEFAULT_EXTERNAL_SERVICE_PORT = "3033";
const REQUEST_TIMEOUT_MS = 4_000;

type FetchLike = typeof fetch;

type TradingOpsPolymarketLiveOptions = {
  repoRoot?: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
};

type FetchResult = {
  ok: boolean;
  status: number;
  body: unknown;
  error: string | null;
};

export async function loadTradingOpsPolymarketLiveData(
  options: TradingOpsPolymarketLiveOptions = {},
): Promise<TradingOpsPolymarketLiveData> {
  const repoRoot = options.repoRoot ?? path.resolve(getBacktesterRepoPath(), "..");
  const baseUrl = options.baseUrl ?? resolveExternalServiceBaseUrl(repoRoot);
  const fetchImpl = options.fetchImpl ?? fetch;
  const boardResult = await fetchJson(`${baseUrl}/polymarket/board/live`, fetchImpl);
  const body = asRecord(boardResult.body);
  const streamer = asRecord(body.streamer);
  const account = asRecord(body.account);
  const roster = asRecord(body.roster);
  const marketsPayload = asArray(body.markets).map((entry) => asRecord(entry));
  const marketRows = marketsPayload.map((entry) => {
    const updatedAt = stringValue(entry.updatedAt) ?? stringValue(entry.tradeTime);
    const warning = compactStrings([
      stringValue(entry.warning),
      updatedAt ? null : "waiting for first market update",
    ])[0] ?? null;

    return {
      slug: stringValue(entry.slug) ?? stringValue(entry.marketSlug) ?? "unknown-market",
      title: stringValue(entry.title) ?? "Untitled market",
      bucket: stringValue(entry.bucket) === "sports" ? "sports" as const : "events" as const,
      pinned: booleanValue(entry.pinned) ?? false,
      pinnedAt: stringValue(entry.pinnedAt),
      eventTitle: stringValue(entry.eventTitle),
      league: stringValue(entry.league),
      bestBid: numberValue(entry.bestBid),
      bestAsk: numberValue(entry.bestAsk),
      lastTrade: numberValue(entry.lastTrade),
      spread: numberValue(entry.spread),
      marketState: stringValue(entry.marketState),
      sharesTraded: numberValue(entry.sharesTraded),
      openInterest: numberValue(entry.openInterest),
      tradePrice: numberValue(entry.tradePrice),
      tradeQuantity: numberValue(entry.tradeQuantity),
      tradeTime: stringValue(entry.tradeTime),
      updatedAt,
      state: !boardResult.ok ? "error" : updatedAt ? "ok" : "degraded",
      warning,
    } as const;
  });

  return {
    generatedAt: stringValue(body.generatedAt) ?? new Date().toISOString(),
    streamer: {
      marketsConnected: booleanValue(streamer.marketsConnected) ?? false,
      privateConnected: booleanValue(streamer.privateConnected) ?? false,
      operatorState: stringValue(streamer.operatorState) ?? (boardResult.ok ? "healthy" : "error"),
      trackedMarketCount: numberValue(streamer.trackedMarketCount) ?? marketRows.length,
      trackedMarketSlugs: toStringArray(streamer.trackedMarketSlugs),
      lastMarketMessageAt: stringValue(streamer.lastMarketMessageAt),
      lastPrivateMessageAt: stringValue(streamer.lastPrivateMessageAt),
      lastError: stringValue(streamer.lastError) ?? boardResult.error,
    },
    account: {
      balance: numberValue(account.balance),
      buyingPower: numberValue(account.buyingPower),
      openOrdersCount: numberValue(account.openOrdersCount),
      positionCount: numberValue(account.positionCount),
      lastBalanceUpdateAt: stringValue(account.lastBalanceUpdateAt),
      lastOrdersUpdateAt: stringValue(account.lastOrdersUpdateAt),
      lastPositionsUpdateAt: stringValue(account.lastPositionsUpdateAt),
    },
    roster: {
      candidateEventsCount: numberValue(roster.candidateEventsCount) ?? 0,
      candidateSportsCount: numberValue(roster.candidateSportsCount) ?? 0,
    },
    markets: marketRows,
    warnings: compactStrings([
      boardResult.error,
      ...asArray(body.warnings).map((entry) => stringValue(entry)).filter(Boolean),
      stringValue(streamer.lastError),
      ...marketRows.map((row) => row.warning),
    ]),
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

async function fetchJson(url: string, fetchImpl: FetchLike): Promise<FetchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetchImpl(url, {
      cache: "no-store",
      signal: controller.signal,
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
  } finally {
    clearTimeout(timeout);
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
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function toStringArray(value: unknown): string[] {
  return asArray(value).map((entry) => String(entry).trim()).filter(Boolean);
}

function compactStrings(values: Array<string | null | undefined>): string[] {
  return values.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}
