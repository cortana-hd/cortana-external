import type {
  GetActivitiesResponse,
  GetMarketResponse,
  MarketSettlement,
  UserPosition,
} from "polymarket-us";

import type { PinnedPolymarketMarket } from "./pins.js";
import type { PolymarketClient } from "./types.js";
import { compareDescending, parseNumber } from "./utils.js";

export async function buildPinnedResults(
  client: PolymarketClient,
  pinnedMarkets: PinnedPolymarketMarket[],
): Promise<Array<Record<string, unknown>>> {
  const results = await Promise.all(
    pinnedMarkets.map(async (market) => {
      const [activities, detail, settlement, position] = await Promise.all([
        safeActivities(client, market.marketSlug),
        safeMarketDetail(client, market.marketSlug),
        safeMarketSettlement(client, market.marketSlug),
        safePosition(client, market.marketSlug),
      ]);
      const realizedPnl = calculateRealizedPnl(activities);
      const settled = settlement !== null;
      const closed = detail?.market.closed ?? false;
      const outcome = detail?.market.outcome ?? null;
      const netPosition = readPositionSize(position);
      const costBasis = parseAmountValue(position?.cost);
      const currentValue = parseAmountValue(position?.cashValue);
      const unrealizedPnl =
        currentValue != null && costBasis != null
          ? Number((currentValue - costBasis).toFixed(4))
          : null;

      return {
        marketSlug: market.marketSlug,
        bucket: market.bucket,
        title: market.title,
        eventTitle: market.eventTitle,
        league: market.league,
        pinnedAt: market.pinnedAt,
        status: settled ? "settled" : closed ? "closed" : "open",
        traded: activities.activities.length > 0,
        realizedPnl,
        netPosition,
        costBasis,
        currentValue,
        unrealizedPnl,
        settledAt: settlement?.settledAt ?? null,
        settlementPrice: parseAmountValue(settlement?.settlementPrice),
        outcome,
        lastActivityAt: latestActivityTimestamp(activities),
        resultLabel: buildResultLabel({
          title: market.title,
          closed,
          settled,
          settlementPrice: parseAmountValue(settlement?.settlementPrice),
          realizedPnl,
        }),
      };
    }),
  );

  return results.sort((left, right) => {
    const leftSettled = left.status === "settled" ? 0 : left.status === "closed" ? 1 : 2;
    const rightSettled = right.status === "settled" ? 0 : right.status === "closed" ? 1 : 2;
    return (
      leftSettled - rightSettled ||
      compareDescending(
        Date.parse(String(left.settledAt ?? left.lastActivityAt ?? 0)) || 0,
        Date.parse(String(right.settledAt ?? right.lastActivityAt ?? 0)) || 0,
      )
    );
  });
}

async function safeActivities(client: PolymarketClient, marketSlug: string): Promise<GetActivitiesResponse> {
  try {
    return await client.portfolio.activities({
      limit: 100,
      marketSlug,
      types: ["ACTIVITY_TYPE_TRADE", "ACTIVITY_TYPE_POSITION_RESOLUTION"],
      sortOrder: "SORT_ORDER_DESCENDING",
    });
  } catch {
    return { activities: [], eof: true };
  }
}

async function safeMarketDetail(client: PolymarketClient, marketSlug: string): Promise<GetMarketResponse | null> {
  try {
    return await client.markets.retrieveBySlug(marketSlug);
  } catch {
    return null;
  }
}

async function safeMarketSettlement(client: PolymarketClient, marketSlug: string): Promise<MarketSettlement | null> {
  try {
    return await client.markets.settlement(marketSlug);
  } catch {
    return null;
  }
}

async function safePosition(client: PolymarketClient, marketSlug: string): Promise<UserPosition | null> {
  try {
    const response = await client.portfolio.positions({
      market: marketSlug,
      limit: 1,
    });
    return response.positions[marketSlug] ?? Object.values(response.positions)[0] ?? null;
  } catch {
    return null;
  }
}

function parseAmountValue(value: { value?: string } | undefined | null): number | null {
  return parseNumber(value?.value);
}

function readPositionSize(position: UserPosition | null | undefined): number | null {
  const size = parseNumber(position?.netPosition);
  return size == null ? null : Math.abs(size);
}

function calculateRealizedPnl(response: GetActivitiesResponse): number | null {
  const deltas: number[] = [];

  for (const activity of response.activities) {
    const tradePnl = parseAmountValue(activity.trade?.realizedPnl);
    if (tradePnl != null) {
      deltas.push(tradePnl);
    }

    const beforeRealized = parseAmountValue(activity.positionResolution?.beforePosition?.realized);
    const afterRealized = parseAmountValue(activity.positionResolution?.afterPosition?.realized);
    if (beforeRealized != null && afterRealized != null) {
      deltas.push(afterRealized - beforeRealized);
    }
  }

  if (deltas.length === 0) {
    return null;
  }

  return Number(deltas.reduce((sum, value) => sum + value, 0).toFixed(4));
}

function latestActivityTimestamp(response: GetActivitiesResponse): string | null {
  for (const activity of response.activities) {
    const timestamp =
      activity.trade?.updateTime ??
      activity.trade?.createTime ??
      activity.positionResolution?.updateTime ??
      null;
    if (timestamp) {
      return timestamp;
    }
  }
  return null;
}

function buildResultLabel(options: {
  title: string;
  closed: boolean;
  settled: boolean;
  settlementPrice: number | null;
  realizedPnl: number | null;
}): string {
  if (options.settled) {
    const outcomeLabel =
      options.settlementPrice == null
        ? "Settled"
        : options.settlementPrice >= 1
          ? `${options.title} won`
          : options.settlementPrice <= 0
            ? `${options.title} lost`
            : `Settled at $${options.settlementPrice.toFixed(4)}`;
    const pnlLabel =
      options.realizedPnl == null
        ? null
        : `${options.realizedPnl >= 0 ? "+" : ""}$${Math.abs(options.realizedPnl).toFixed(2)} realized`;
    return [outcomeLabel, pnlLabel].filter(Boolean).join(" · ");
  }

  if (options.closed) {
    return "Closed, awaiting settlement";
  }

  return "Still live";
}
