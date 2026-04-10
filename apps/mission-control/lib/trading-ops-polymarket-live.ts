import fs from "node:fs";
import path from "node:path";

import type { TradingOpsPolymarketLiveData } from "@/lib/trading-ops-contract";
import { getBacktesterRepoPath } from "@/lib/runtime-paths";

const DEFAULT_EXTERNAL_SERVICE_PORT = "3033";
const REQUEST_TIMEOUT_MS = 4_000;
const TOP_BUCKET_TARGET = 5;
const FOCUS_FETCH_LIMIT = 20;

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

type TrackedMarket = {
  slug: string;
  title: string;
  bucket: "events" | "sports";
  pinned: boolean;
  pinnedAt: string | null;
  eventTitle: string | null;
  league: string | null;
};

export async function loadTradingOpsPolymarketLiveData(
  options: TradingOpsPolymarketLiveOptions = {},
): Promise<TradingOpsPolymarketLiveData> {
  const repoRoot = options.repoRoot ?? path.resolve(getBacktesterRepoPath(), "..");
  const baseUrl = options.baseUrl ?? resolveExternalServiceBaseUrl(repoRoot);
  const fetchImpl = options.fetchImpl ?? fetch;
  const reportPath = path.join(repoRoot, "var", "market-intel", "polymarket", "latest-report.json");
  const reportPayload = readJsonFile(reportPath);
  const topMarkets = asArray(asRecord(reportPayload).topMarkets).map((entry) => asRecord(entry));
  const eventFallback = topMarkets
    .map((entry) => ({
      slug: stringValue(entry.slug) ?? "",
      title: stringValue(entry.displayTitle) ?? stringValue(entry.title) ?? "Untitled market",
      bucket: "events" as const,
      pinned: false,
      pinnedAt: null,
      eventTitle: stringValue(entry.title) ?? stringValue(entry.displayTitle) ?? "Untitled event",
      league: null,
    }))
    .filter((entry) => entry.slug)
    .slice(0, FOCUS_FETCH_LIMIT);
  const focusResult = await fetchJson(`${baseUrl}/polymarket/focus?limit=${FOCUS_FETCH_LIMIT}`, fetchImpl);
  const pinnedMarkets = parsePinnedFocusMarkets(focusResult.body);
  const pinnedSlugs = new Set(pinnedMarkets.map((entry) => entry.slug));
  const selectedEventMarkets = selectTopBucketMarkets({
    primary: parseEventFocusMarkets(focusResult.body),
    fallback: eventFallback,
    excludeSlugs: pinnedSlugs,
    limit: TOP_BUCKET_TARGET,
  });
  const selectedSportsMarkets = selectTopBucketMarkets({
    primary: parseSportsFocusMarkets(focusResult.body),
    fallback: [],
    excludeSlugs: pinnedSlugs,
    limit: TOP_BUCKET_TARGET,
  });
  const tracked = dedupeTrackedMarkets([
    ...pinnedMarkets,
    ...selectedEventMarkets,
    ...selectedSportsMarkets,
  ]);
  const slugs = tracked.map((entry) => entry.slug);
  const trackedBySlug = new Map(tracked.map((entry) => [entry.slug, entry]));
  const liveResult = await fetchJson(
    `${baseUrl}/polymarket/live${slugs.length > 0 ? `?slugs=${encodeURIComponent(slugs.join(","))}` : ""}`,
    fetchImpl,
  );
  const body = asRecord(liveResult.body);
  const streamer = asRecord(body.streamer);
  const account = asRecord(body.account);
  const marketsPayload = asArray(body.markets).map((entry) => asRecord(entry));
  const marketRows = (marketsPayload.length > 0 ? marketsPayload : slugs.map((slug) => ({ marketSlug: slug }))).map((item) => {
    const entry = asRecord(item);
    const slug = stringValue(entry.marketSlug) ?? "unknown-market";
    const updatedAt = stringValue(entry.updatedAt) ?? stringValue(entry.tradeTime);
    const warning = compactStrings([
      !liveResult.ok ? liveResult.error : null,
      stringValue(entry.warning),
      updatedAt ? null : "waiting for first market update",
    ])[0] ?? null;

    return {
      slug,
      title: trackedBySlug.get(slug)?.title ?? slug,
      bucket: trackedBySlug.get(slug)?.bucket ?? "events",
      pinned: trackedBySlug.get(slug)?.pinned ?? false,
      pinnedAt: trackedBySlug.get(slug)?.pinnedAt ?? null,
      eventTitle: trackedBySlug.get(slug)?.eventTitle ?? null,
      league: trackedBySlug.get(slug)?.league ?? null,
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
      state: !liveResult.ok ? "error" : updatedAt ? "ok" : "degraded",
      warning,
    } as const;
  });

  return {
    generatedAt: new Date().toISOString(),
    streamer: {
      marketsConnected: booleanValue(streamer.marketsConnected) ?? false,
      privateConnected: booleanValue(streamer.privateConnected) ?? false,
      operatorState: stringValue(streamer.operatorState) ?? (liveResult.ok ? "healthy" : "error"),
      trackedMarketCount: numberValue(streamer.trackedMarketCount) ?? marketRows.length,
      trackedMarketSlugs: toStringArray(streamer.trackedMarketSlugs),
      lastMarketMessageAt: stringValue(streamer.lastMarketMessageAt),
      lastPrivateMessageAt: stringValue(streamer.lastPrivateMessageAt),
      lastError: stringValue(streamer.lastError) ?? liveResult.error,
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
    markets: marketRows,
    warnings: compactStrings([
      focusResult.error,
      liveResult.error,
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

function parseSportsFocusMarkets(body: unknown): TrackedMarket[] {
  return asArray(asRecord(body).sports)
    .map((entry) => asRecord(entry))
    .map((entry) => ({
      slug: stringValue(entry.marketSlug) ?? "",
      title: stringValue(entry.marketTitle) ?? stringValue(entry.eventTitle) ?? "Untitled sports market",
      bucket: "sports" as const,
      pinned: false,
      pinnedAt: null,
      eventTitle: stringValue(entry.eventTitle),
      league: stringValue(entry.league),
    }))
    .filter((entry) => entry.slug);
}

function parseEventFocusMarkets(body: unknown): TrackedMarket[] {
  return asArray(asRecord(body).events)
    .map((entry) => asRecord(entry))
    .map((entry) => ({
      slug: stringValue(entry.marketSlug) ?? "",
      title: stringValue(entry.marketTitle) ?? stringValue(entry.eventTitle) ?? "Untitled event market",
      bucket: "events" as const,
      pinned: false,
      pinnedAt: null,
      eventTitle: stringValue(entry.eventTitle),
      league: stringValue(entry.league),
    }))
    .filter((entry) => entry.slug);
}

function parsePinnedFocusMarkets(body: unknown): TrackedMarket[] {
  return asArray(asRecord(body).pinned)
    .map((entry) => asRecord(entry))
    .map((entry) => ({
      slug: stringValue(entry.marketSlug) ?? "",
      title: stringValue(entry.title) ?? stringValue(entry.eventTitle) ?? "Pinned market",
      bucket: stringValue(entry.bucket) === "sports" ? "sports" as const : "events" as const,
      pinned: true,
      pinnedAt: stringValue(entry.pinnedAt),
      eventTitle: stringValue(entry.eventTitle),
      league: stringValue(entry.league),
    }))
    .filter((entry) => entry.slug);
}

function dedupeTrackedMarkets(markets: TrackedMarket[]): TrackedMarket[] {
  const deduped = new Map<string, TrackedMarket>();
  for (const market of markets) {
    const existing = deduped.get(market.slug);
    if (!existing) {
      deduped.set(market.slug, market);
      continue;
    }

    deduped.set(market.slug, {
      ...existing,
      ...market,
      bucket: existing.pinned ? existing.bucket : market.bucket,
      pinned: existing.pinned || market.pinned,
      pinnedAt: existing.pinnedAt ?? market.pinnedAt,
      eventTitle: existing.eventTitle ?? market.eventTitle,
      league: existing.league ?? market.league,
      title: existing.title === existing.slug ? market.title : existing.title,
    });
  }
  return Array.from(deduped.values());
}

function selectTopBucketMarkets(options: {
  primary: TrackedMarket[];
  fallback: TrackedMarket[];
  excludeSlugs: Set<string>;
  limit: number;
}): TrackedMarket[] {
  const selected: TrackedMarket[] = [];
  const seen = new Set<string>();

  const tryAdd = (market: TrackedMarket) => {
    if (!market.slug || options.excludeSlugs.has(market.slug) || seen.has(market.slug)) {
      return;
    }
    selected.push(market);
    seen.add(market.slug);
  };

  for (const market of options.primary) {
    if (selected.length >= options.limit) break;
    tryAdd(market);
  }

  for (const market of options.fallback) {
    if (selected.length >= options.limit) break;
    tryAdd(market);
  }

  return selected;
}

function readJsonFile(filePath: string): unknown {
  if (!fs.existsSync(filePath)) return null;

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
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
