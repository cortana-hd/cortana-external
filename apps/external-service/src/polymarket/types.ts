import type {
  GetActivitiesParams,
  GetActivitiesResponse,
  GetMarketResponse,
  Event,
  EventsListParams,
  GetAccountBalancesResponse,
  GetEventsResponse,
  GetOpenOrdersParams,
  GetOpenOrdersResponse,
  GetUserPositionsParams,
  GetUserPositionsResponse,
  MarketBBO,
  MarketSettlement,
} from "polymarket-us";

export interface PolymarketClient {
  account: {
    balances(): Promise<GetAccountBalancesResponse>;
  };
  events: {
    list(params?: EventsListParams): Promise<GetEventsResponse>;
  };
  portfolio: {
    positions(params?: GetUserPositionsParams): Promise<GetUserPositionsResponse>;
    activities(params?: GetActivitiesParams): Promise<GetActivitiesResponse>;
  };
  orders: {
    list(params?: GetOpenOrdersParams): Promise<GetOpenOrdersResponse>;
  };
  markets: {
    retrieveBySlug(slug: string): Promise<GetMarketResponse>;
    bbo(slug: string): Promise<MarketBBO>;
    settlement(slug: string): Promise<MarketSettlement>;
  };
}

export type PolymarketFocusMarket = {
  bucket: "sports" | "events";
  league: string | null;
  eventSlug: string;
  eventTitle: string;
  eventStartTime: string | null;
  marketSlug: string;
  marketTitle: string;
  liquidity: number | null;
  volume: number | null;
  openInterest: number | null;
  hoursToStart: number | null;
};

export type EventMarketCandidate = {
  event: Event;
  market: NonNullable<Event["markets"]>[number];
};

export type BoardDiscoverySnapshot = {
  generatedAt: string;
  events: PolymarketFocusMarket[];
  sports: PolymarketFocusMarket[];
  warnings: string[];
};

export type CachedBoardDiscovery = {
  fetchedAt: number;
  snapshot: BoardDiscoverySnapshot;
};

export type SportsFocusFilters = {
  limit: number;
  sort: "composite" | "liquidity" | "volume" | "open_interest" | "nearest_start_time";
  minLiquidity: number | null;
  minVolume: number | null;
  minOpenInterest: number | null;
  maxStartHours: number | null;
};

export interface ServiceResult<T> {
  status: number;
  body: T;
}
