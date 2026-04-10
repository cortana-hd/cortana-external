import type { Event, EventsListParams, MarketBBO } from "polymarket-us";

import type { PolymarketClient, EventMarketCandidate, PolymarketFocusMarket, SportsFocusFilters } from "./types.js";
import {
  compareAscendingNullable,
  compareDescending,
  hoursUntil,
  parseNumber,
} from "./utils.js";

export async function discoverSportsFocusMarkets(
  client: PolymarketClient,
  filters: SportsFocusFilters,
): Promise<PolymarketFocusMarket[]> {
  const response = await client.events.list({
    active: true,
    closed: false,
    categories: ["sports"],
    limit: Math.max(filters.limit * 4, 16),
    orderDirection: "desc",
    liquidityMin: filters.minLiquidity ?? undefined,
    volumeMin: filters.minVolume ?? undefined,
  });

  const candidates = (
    await Promise.all(
      response.events.map(async (event) => toFocusMarket(event, client, "sports")),
    )
  ).filter((entry): entry is PolymarketFocusMarket => entry !== null);

  return candidates
    .filter((entry) => passesSportsFilters(entry, filters))
    .sort((left, right) => compareSportsFocusMarkets(left, right, filters.sort))
    .slice(0, filters.limit);
}

export async function discoverEventFocusMarkets(
  client: PolymarketClient,
  filters: SportsFocusFilters,
): Promise<PolymarketFocusMarket[]> {
  const events = await collectActiveEvents(client, {
    active: true,
    closed: false,
    limit: 100,
    orderDirection: "desc",
    liquidityMin: filters.minLiquidity ?? undefined,
    volumeMin: filters.minVolume ?? undefined,
  });

  const candidates = events
    .filter((event) => !isSportsEvent(event))
    .flatMap((event) => buildEventFocusCandidates(event))
    .sort(compareEventMarketCandidates)
    .slice(0, Math.max(filters.limit * 4, 20));

  const focusMarkets = (
    await Promise.all(
      candidates.map(async (candidate) => toFocusMarketFromCandidate(candidate, client)),
    )
  ).filter((entry): entry is PolymarketFocusMarket => entry !== null);

  return dedupeFocusMarkets(focusMarkets)
    .filter((entry) => passesSportsFilters(entry, filters))
    .sort((left, right) => compareSportsFocusMarkets(left, right, filters.sort))
    .slice(0, filters.limit);
}

export function dedupeFocusMarkets(markets: PolymarketFocusMarket[]): PolymarketFocusMarket[] {
  const deduped = new Map<string, PolymarketFocusMarket>();
  for (const market of markets) {
    if (!deduped.has(market.marketSlug)) {
      deduped.set(market.marketSlug, market);
    }
  }
  return Array.from(deduped.values());
}

async function collectActiveEvents(
  client: PolymarketClient,
  params: EventsListParams,
): Promise<Event[]> {
  const limit = params.limit ?? 100;
  const pages = 3;
  const collected: Event[] = [];

  for (let page = 0; page < pages; page += 1) {
    const response = await client.events.list({
      ...params,
      limit,
      offset: page * limit,
    });
    collected.push(...response.events);
    if (response.events.length < limit) {
      break;
    }
  }

  return collected;
}

async function toFocusMarket(
  event: Event,
  client: PolymarketClient,
  bucket: "sports" | "events",
): Promise<PolymarketFocusMarket | null> {
  const markets = Array.isArray(event.markets) ? event.markets : [];
  if (markets.length === 0) {
    return null;
  }

  const representative =
    (bucket === "sports"
      ? markets.find((market) => market.active && market.slug.startsWith("aec-"))
      : null) ??
    markets
      .filter((market) => market.active && !market.closed)
      .sort((left, right) => compareDescending(parseNumber(left.liquidity), parseNumber(right.liquidity)))[0] ??
    markets[0];

  if (!representative?.slug) {
    return null;
  }

  const bbo = await safeMarketBbo(client, representative.slug);

  const league =
    (bucket === "sports"
      ? event.series?.slug?.trim() ||
        event.tags?.map((tag) => tag.slug).find((tag) => tag && tag !== "sports" && tag !== "games")
      : event.tags?.map((tag) => tag.slug).find((tag) => tag && tag !== "politics" && tag !== "economics")) ||
    null;
  const startTime = event.startTime?.trim() || null;

  return {
    bucket,
    league,
    eventSlug: event.slug,
    eventTitle: event.title,
    eventStartTime: startTime,
    marketSlug: representative.slug,
    marketTitle: representative.title,
    liquidity: parseNumber(event.liquidity) ?? parseNumber(representative.liquidity),
    volume: parseNumber(event.volume) ?? parseNumber(representative.volume),
    openInterest: parseNumber(bbo?.openInterest),
    hoursToStart: startTime ? hoursUntil(startTime) : null,
  };
}

async function toFocusMarketFromCandidate(
  candidate: EventMarketCandidate,
  client: PolymarketClient,
): Promise<PolymarketFocusMarket | null> {
  const { event, market } = candidate;
  if (!market.slug) {
    return null;
  }

  const bbo = await safeMarketBbo(client, market.slug);
  const league =
    event.tags?.map((tag) => tag.slug).find((tag) => tag && tag !== "politics" && tag !== "economics") ||
    null;
  const startTime = event.startTime?.trim() || null;

  return {
    bucket: "events",
    league,
    eventSlug: event.slug,
    eventTitle: event.title,
    eventStartTime: startTime,
    marketSlug: market.slug,
    marketTitle: market.title,
    liquidity: parseNumber(market.liquidity) ?? parseNumber(event.liquidity),
    volume: parseNumber(market.volume) ?? parseNumber(event.volume),
    openInterest: parseNumber(bbo?.openInterest),
    hoursToStart: startTime ? hoursUntil(startTime) : null,
  };
}

function buildEventFocusCandidates(event: Event): EventMarketCandidate[] {
  const markets = Array.isArray(event.markets) ? event.markets : [];
  return markets
    .filter((market) => market.active && !market.closed && Boolean(market.slug))
    .sort((left, right) => (
      compareDescending(parseNumber(left.liquidity), parseNumber(right.liquidity)) ||
      compareDescending(parseNumber(left.volume), parseNumber(right.volume))
    ))
    .slice(0, 5)
    .map((market) => ({ event, market }));
}

function compareEventMarketCandidates(left: EventMarketCandidate, right: EventMarketCandidate): number {
  return (
    compareDescending(parseNumber(left.market.liquidity), parseNumber(right.market.liquidity)) ||
    compareDescending(parseNumber(left.market.volume), parseNumber(right.market.volume)) ||
    compareDescending(parseNumber(left.event.liquidity), parseNumber(right.event.liquidity)) ||
    compareDescending(parseNumber(left.event.volume), parseNumber(right.event.volume))
  );
}

async function safeMarketBbo(client: PolymarketClient, marketSlug: string): Promise<MarketBBO | null> {
  try {
    return await client.markets.bbo(marketSlug);
  } catch {
    return null;
  }
}

function passesSportsFilters(entry: PolymarketFocusMarket, filters: SportsFocusFilters): boolean {
  if (filters.minLiquidity != null && (entry.liquidity ?? -1) < filters.minLiquidity) {
    return false;
  }
  if (filters.minVolume != null && (entry.volume ?? -1) < filters.minVolume) {
    return false;
  }
  if (filters.minOpenInterest != null && (entry.openInterest ?? -1) < filters.minOpenInterest) {
    return false;
  }
  if (filters.maxStartHours != null && (entry.hoursToStart == null || entry.hoursToStart > filters.maxStartHours)) {
    return false;
  }
  return true;
}

function compareSportsFocusMarkets(
  left: PolymarketFocusMarket,
  right: PolymarketFocusMarket,
  sort: SportsFocusFilters["sort"],
): number {
  if (sort === "liquidity") {
    return compareDescending(left.liquidity, right.liquidity) || compareDescending(left.volume, right.volume);
  }
  if (sort === "volume") {
    return compareDescending(left.volume, right.volume) || compareDescending(left.liquidity, right.liquidity);
  }
  if (sort === "open_interest") {
    return compareDescending(left.openInterest, right.openInterest) || compareDescending(left.liquidity, right.liquidity);
  }
  if (sort === "nearest_start_time") {
    return compareAscendingNullable(left.hoursToStart, right.hoursToStart) || compareDescending(left.liquidity, right.liquidity);
  }

  return (
    compareDescending(left.liquidity, right.liquidity) ||
    compareDescending(left.volume, right.volume) ||
    compareDescending(left.openInterest, right.openInterest) ||
    compareAscendingNullable(left.hoursToStart, right.hoursToStart)
  );
}

function isSportsEvent(event: Event): boolean {
  return (event.tags ?? []).some((tag) => tag.slug === "sports");
}
