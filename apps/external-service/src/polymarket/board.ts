import type { PolymarketLiveSnapshot } from "./streamer.js";
import type { PolymarketFocusMarket } from "./types.js";
import { compareDescending, normalizeMarketTitle } from "./utils.js";

export const BOARD_CANDIDATE_LIMIT = 24;
export const BOARD_TOP_LIMIT = 5;
export const BOARD_DISCOVERY_TTL_MS = 60_000;

export function selectBoardRows(options: {
  candidates: PolymarketFocusMarket[];
  liveBySlug: Map<string, PolymarketLiveSnapshot["markets"][number]>;
  limit: number;
  excludeSlugs: Set<string>;
  excludeTitleKeys: Set<string>;
}): Array<Record<string, unknown>> {
  const sorted = options.candidates
    .filter((entry) => (
      !options.excludeSlugs.has(entry.marketSlug) &&
      !options.excludeTitleKeys.has(getBoardTitleKey({
        bucket: entry.bucket,
        title: entry.marketTitle,
        eventTitle: entry.eventTitle,
      }))
    ))
    .sort((left, right) => (
      compareDescending(
        scoreBoardCandidate(left, options.liveBySlug.get(left.marketSlug) ?? null),
        scoreBoardCandidate(right, options.liveBySlug.get(right.marketSlug) ?? null),
      )
    ));

  const selected: Array<Record<string, unknown>> = [];
  const seenSlugs = new Set<string>();
  const seenTitles = new Set<string>();

  for (const entry of sorted) {
    if (selected.length >= options.limit) break;
    const titleKey = getBoardTitleKey({
      bucket: entry.bucket,
      title: entry.marketTitle,
      eventTitle: entry.eventTitle,
    });
    if (seenSlugs.has(entry.marketSlug) || seenTitles.has(titleKey)) {
      continue;
    }
    selected.push(toBoardMarketRow({
      slug: entry.marketSlug,
      title: entry.marketTitle,
      bucket: entry.bucket,
      pinned: false,
      pinnedAt: null,
      eventTitle: entry.eventTitle,
      league: entry.league,
      live: options.liveBySlug.get(entry.marketSlug) ?? null,
      liveStatus: "ok",
    }));
    seenSlugs.add(entry.marketSlug);
    seenTitles.add(titleKey);
  }

  return selected;
}

export function getBoardTitleKey(options: {
  bucket: "events" | "sports";
  title: string | null | undefined;
  eventTitle: string | null | undefined;
}): string {
  const titleKey = normalizeMarketTitle(options.title);
  if (options.bucket === "events") {
    return `${normalizeMarketTitle(options.eventTitle)}::${titleKey}`;
  }
  return titleKey;
}

export function toBoardMarketRow(options: {
  slug: string;
  title: string | null | undefined;
  bucket: "events" | "sports";
  pinned: boolean;
  pinnedAt: string | null;
  eventTitle: string | null;
  league: string | null;
  live: PolymarketLiveSnapshot["markets"][number] | null;
  liveStatus: PolymarketLiveSnapshot["status"];
}): Record<string, unknown> {
  const live = options.live;
  const updatedAt = live?.updatedAt ?? live?.tradeTime ?? null;
  const title =
    options.title?.trim() ||
    options.eventTitle?.trim() ||
    "Untitled market";
  return {
    slug: options.slug,
    title,
    bucket: options.bucket,
    pinned: options.pinned,
    pinnedAt: options.pinnedAt,
    eventTitle: options.eventTitle,
    league: options.league,
    bestBid: live?.bestBid ?? null,
    bestAsk: live?.bestAsk ?? null,
    lastTrade: live?.lastTrade ?? null,
    spread: live?.spread ?? null,
    marketState: live?.marketState ?? null,
    sharesTraded: live?.sharesTraded ?? null,
    openInterest: live?.openInterest ?? null,
    tradePrice: live?.tradePrice ?? null,
    tradeQuantity: live?.tradeQuantity ?? null,
    tradeTime: live?.tradeTime ?? null,
    updatedAt,
    state: options.liveStatus === "error" ? "error" : updatedAt ? "ok" : "degraded",
    warning: updatedAt ? null : "waiting for first market update",
  };
}

function scoreBoardCandidate(
  focus: PolymarketFocusMarket,
  live: PolymarketLiveSnapshot["markets"][number] | null,
): number {
  let score = 0;

  score += Math.max(focus.liquidity ?? 0, 0) / 10_000;
  score += Math.max(focus.volume ?? 0, 0) / 10_000;
  score += Math.max(focus.openInterest ?? 0, 0) / 10_000;

  if (focus.hoursToStart != null) {
    score += Math.max(0, 48 - Math.min(Math.abs(focus.hoursToStart), 48));
  }

  if (live?.updatedAt) {
    const ageMs = Math.max(0, Date.now() - Date.parse(live.updatedAt));
    score += Math.max(0, 120 - ageMs / 1000);
  }
  if (live?.lastTrade != null) score += 40;
  if (live?.bestBid != null) score += 20;
  if (live?.bestAsk != null) score += 20;
  if (live?.spread != null) score += Math.max(0, 10 - live.spread * 100);

  return score;
}
