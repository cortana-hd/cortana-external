import type { Context } from "hono";
import {
  AuthenticationError,
  type MarketBBO,
  type MarketSettlement,
  PolymarketUS,
  PolymarketUSError,
  RateLimitError,
  type GetActivitiesParams,
  type GetActivitiesResponse,
  type GetMarketResponse,
  type Event,
  type EventsListParams,
  type GetAccountBalancesResponse,
  type GetEventsResponse,
  type GetOpenOrdersParams,
  type GetOpenOrdersResponse,
  type GetUserPositionsParams,
  type GetUserPositionsResponse,
  type PolymarketUSOptions,
  type UserPosition,
} from "polymarket-us";

import { jsonError } from "../lib/response.js";
import { createLogger, type AppLogger } from "../lib/logger.js";
import {
  PolymarketStreamRuntime,
  type PolymarketLiveSnapshot,
  type PolymarketStreamRuntimeLike,
} from "./streamer.js";
import { PolymarketPinsStore, type PinnedPolymarketMarket } from "./pins.js";

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

type PolymarketFocusMarket = {
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

type EventMarketCandidate = {
  event: Event;
  market: NonNullable<Event["markets"]>[number];
};

type SportsFocusFilters = {
  limit: number;
  sort: "composite" | "liquidity" | "volume" | "open_interest" | "nearest_start_time";
  minLiquidity: number | null;
  minVolume: number | null;
  minOpenInterest: number | null;
  maxStartHours: number | null;
};

export interface PolymarketServiceOptions {
  keyId?: string;
  secretKey?: string;
  gatewayBaseUrl?: string;
  apiBaseUrl?: string;
  timeoutMs?: number;
  logger?: AppLogger;
  clientFactory?: (options: PolymarketUSOptions) => PolymarketClient;
  streamRuntime?: PolymarketStreamRuntimeLike;
  pinsStore?: PolymarketPinsStore;
}

interface ServiceResult<T> {
  status: number;
  body: T;
}

function normalizeRootBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/u, "");
}

function normalizeGatewayBaseUrl(baseUrl: string): string {
  return normalizeRootBaseUrl(baseUrl).replace(/\/v1$/u, "");
}

function normalizeOptionalString(value: string | undefined): string {
  return value?.trim() ?? "";
}

function parsePositiveInt(raw: string | undefined, fallback?: number): number | undefined {
  if (!raw?.trim()) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("limit must be a positive integer");
  }
  return parsed;
}

function parseSlugs(raw: string | undefined): string[] | undefined {
  if (!raw?.trim()) {
    return undefined;
  }

  const slugs = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return slugs.length > 0 ? slugs : undefined;
}

function parseNonNegativeNumber(raw: string | undefined, fieldName: string): number | null {
  if (!raw?.trim()) {
    return null;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${fieldName} must be a non-negative number`);
  }

  return parsed;
}

function parseSportsSort(raw: string | undefined): SportsFocusFilters["sort"] {
  const value = raw?.trim().toLowerCase();
  if (!value) {
    return "composite";
  }

  if (
    value === "composite" ||
    value === "liquidity" ||
    value === "volume" ||
    value === "open_interest" ||
    value === "nearest_start_time"
  ) {
    return value;
  }

  throw new Error("sort must be one of composite, liquidity, volume, open_interest, nearest_start_time");
}

export class PolymarketService {
  private readonly keyId: string;
  private readonly secretKey: string;
  private readonly gatewayBaseUrl: string;
  private readonly apiBaseUrl: string;
  private readonly timeoutMs: number;
  private readonly logger: AppLogger;
  private readonly clientFactory: (options: PolymarketUSOptions) => PolymarketClient;
  private readonly streamRuntime: PolymarketStreamRuntimeLike;
  private readonly pinsStore: PolymarketPinsStore;

  constructor(options: PolymarketServiceOptions) {
    this.keyId = normalizeOptionalString(options.keyId);
    this.secretKey = normalizeOptionalString(options.secretKey);
    this.gatewayBaseUrl = normalizeGatewayBaseUrl(options.gatewayBaseUrl ?? "https://gateway.polymarket.us");
    this.apiBaseUrl = normalizeRootBaseUrl(options.apiBaseUrl ?? "https://api.polymarket.us");
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.logger = options.logger ?? createLogger("polymarket");
    this.clientFactory = options.clientFactory ?? ((clientOptions) => new PolymarketUS(clientOptions));
    this.pinsStore = options.pinsStore ?? new PolymarketPinsStore(".cache/polymarket/pinned-markets.json");
    this.streamRuntime =
      options.streamRuntime ??
      new PolymarketStreamRuntime({
        keyId: this.keyId,
        secretKey: this.secretKey,
        apiBaseUrl: this.apiBaseUrl,
        timeoutMs: this.timeoutMs,
        logger: this.logger,
      });
  }

  async checkHealth(): Promise<Record<string, unknown>> {
    return (await this.handleHealth()).body;
  }

  async handleHealth(): Promise<ServiceResult<Record<string, unknown>>> {
    const unconfigured = this.unconfiguredPayload();
    if (unconfigured) {
      return { status: 200, body: unconfigured };
    }

    try {
      const balances = await this.createClient().account.balances();
      return {
        status: 200,
        body: {
          status: "healthy",
          apiBaseUrl: this.apiBaseUrl,
          gatewayBaseUrl: this.gatewayBaseUrl,
          keyIdSuffix: this.keyId.slice(-6),
          balanceCount: balances.balances.length,
        },
      };
    } catch (error) {
      const mapped = this.mapHealthError(error);
      this.logger.error("polymarket health check failed", error);
      return mapped;
    }
  }

  async healthHandler(context: Context): Promise<Response> {
    const result = await this.handleHealth();
    return context.json(result.body, result.status as never);
  }

  async balancesHandler(context: Context): Promise<Response> {
    const unconfigured = this.unconfiguredPayload();
    if (unconfigured) {
      return context.json(unconfigured, 503 as never);
    }

    try {
      const balances = await this.createClient().account.balances();
      return context.json(
        {
          ...balances,
          keyIdSuffix: this.keyId.slice(-6),
        },
        200 as never,
      );
    } catch (error) {
      return this.toErrorResponse(context, error, "polymarket balances fetch failed");
    }
  }

  async positionsHandler(context: Context): Promise<Response> {
    const unconfigured = this.unconfiguredPayload();
    if (unconfigured) {
      return context.json(unconfigured, 503 as never);
    }

    let params: GetUserPositionsParams | undefined;
    try {
      params = {
        market: context.req.query("market"),
        cursor: context.req.query("cursor"),
        limit: parsePositiveInt(context.req.query("limit"), 25),
      };
    } catch (error) {
      return jsonError(context, 400, error instanceof Error ? error.message : String(error));
    }

    try {
      const positions = await this.createClient().portfolio.positions(params);
      return context.json(positions, 200 as never);
    } catch (error) {
      return this.toErrorResponse(context, error, "polymarket positions fetch failed");
    }
  }

  async ordersHandler(context: Context): Promise<Response> {
    const unconfigured = this.unconfiguredPayload();
    if (unconfigured) {
      return context.json(unconfigured, 503 as never);
    }

    const params: GetOpenOrdersParams | undefined = {
      slugs: parseSlugs(context.req.query("slugs") ?? context.req.query("slug")),
    };

    try {
      const orders = await this.createClient().orders.list(params);
      return context.json(orders, 200 as never);
    } catch (error) {
      return this.toErrorResponse(context, error, "polymarket orders fetch failed");
    }
  }

  async focusHandler(context: Context): Promise<Response> {
    const unconfigured = this.unconfiguredPayload();
    if (unconfigured) {
      return context.json(
        {
          ...unconfigured,
          generatedAt: new Date().toISOString(),
          events: [],
          pinned: [],
          sports: [],
        },
        503 as never,
      );
    }

    try {
      const filters = this.parseSportsFocusFilters(context);
      const [sports, events, pinned] = await Promise.all([
        this.discoverSportsFocusMarkets(filters),
        this.discoverEventFocusMarkets(filters),
        this.pinsStore.list(),
      ]);
      return context.json(
        {
          generatedAt: new Date().toISOString(),
          status: "ok",
          apiBaseUrl: this.apiBaseUrl,
          keyIdSuffix: this.keyId.slice(-6),
          filters,
          events,
          pinned,
          sports,
          warnings: [
            ...(sports.length === 0 ? ["no active sports focus markets discovered"] : []),
            ...(events.length === 0 ? ["no active event focus markets discovered"] : []),
          ],
        },
        200 as never,
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("must be")) {
        return jsonError(context, 400, error.message);
      }
      return this.toErrorResponse(context, error, "polymarket focus discovery failed");
    }
  }

  async listPinsHandler(context: Context): Promise<Response> {
    try {
      const pinned = await this.pinsStore.list();
      return context.json(
        {
          generatedAt: new Date().toISOString(),
          pinned,
        },
        200 as never,
      );
    } catch (error) {
      return this.toErrorResponse(context, error, "polymarket pins read failed");
    }
  }

  async addPinHandler(context: Context): Promise<Response> {
    let body: Partial<PinnedPolymarketMarket> | null = null;
    try {
      body = (await context.req.json()) as Partial<PinnedPolymarketMarket>;
    } catch {
      return jsonError(context, 400, "Invalid JSON body");
    }

    if (!body || typeof body.marketSlug !== "string" || typeof body.title !== "string") {
      return jsonError(context, 400, "marketSlug and title are required");
    }
    if (body.bucket !== "events" && body.bucket !== "sports") {
      return jsonError(context, 400, "bucket must be events or sports");
    }

    try {
      const pinned = await this.pinsStore.upsert({
        marketSlug: body.marketSlug,
        bucket: body.bucket,
        title: body.title,
        eventTitle: typeof body.eventTitle === "string" ? body.eventTitle : null,
        league: typeof body.league === "string" ? body.league : null,
      });
      return context.json(
        {
          ok: true,
          pinned,
        },
        200 as never,
      );
    } catch (error) {
      return this.toErrorResponse(context, error, "polymarket pin add failed");
    }
  }

  async removePinHandler(context: Context): Promise<Response> {
    const marketSlug = context.req.param("marketSlug")?.trim();
    if (!marketSlug) {
      return jsonError(context, 400, "marketSlug is required");
    }

    try {
      const pinned = await this.pinsStore.remove(marketSlug);
      return context.json(
        {
          ok: true,
          pinned,
        },
        200 as never,
      );
    } catch (error) {
      return this.toErrorResponse(context, error, "polymarket pin removal failed");
    }
  }

  async resultsHandler(context: Context): Promise<Response> {
    const unconfigured = this.unconfiguredPayload();
    if (unconfigured) {
      return context.json(
        {
          ...unconfigured,
          generatedAt: new Date().toISOString(),
          results: [],
        },
        503 as never,
      );
    }

    try {
      const requestedSlugs = new Set(parseSlugs(context.req.query("slugs") ?? context.req.query("slug")) ?? []);
      const pinned = await this.pinsStore.list();
      const candidates =
        requestedSlugs.size === 0
          ? pinned
          : pinned.filter((entry) => requestedSlugs.has(entry.marketSlug));
      const results = await this.buildPinnedResults(candidates);
      return context.json(
        {
          generatedAt: new Date().toISOString(),
          results,
        },
        200 as never,
      );
    } catch (error) {
      return this.toErrorResponse(context, error, "polymarket results fetch failed");
    }
  }

  private parseSportsFocusFilters(context: Context): SportsFocusFilters {
    return {
      limit: parsePositiveInt(context.req.query("limit"), 5) ?? 5,
      sort: parseSportsSort(context.req.query("sort")),
      minLiquidity: parseNonNegativeNumber(context.req.query("minLiquidity"), "minLiquidity"),
      minVolume: parseNonNegativeNumber(context.req.query("minVolume"), "minVolume"),
      minOpenInterest: parseNonNegativeNumber(context.req.query("minOpenInterest"), "minOpenInterest"),
      maxStartHours: parseNonNegativeNumber(context.req.query("maxStartHours"), "maxStartHours"),
    };
  }

  async liveHandler(context: Context): Promise<Response> {
    const marketSlugs = parseSlugs(context.req.query("slugs") ?? context.req.query("slug")) ?? [];

    try {
      const snapshot = await this.streamRuntime.getSnapshot(marketSlugs);
      return context.json(snapshot, snapshot.status === "error" ? (503 as never) : (200 as never));
    } catch (error) {
      this.logger.error("polymarket live snapshot failed", error);
      return context.json(
        {
          generatedAt: new Date().toISOString(),
          status: "error",
          apiBaseUrl: this.apiBaseUrl,
          keyIdSuffix: this.keyId ? this.keyId.slice(-6) : null,
          streamer: {
            marketsConnected: false,
            privateConnected: false,
            operatorState: "error",
            trackedMarketCount: marketSlugs.length,
            trackedMarketSlugs: marketSlugs,
            lastMarketMessageAt: null,
            lastPrivateMessageAt: null,
            lastError: error instanceof Error ? error.message : String(error),
          },
          account: {
            balance: null,
            buyingPower: null,
            openOrdersCount: null,
            positionCount: null,
            lastBalanceUpdateAt: null,
            lastOrdersUpdateAt: null,
            lastPositionsUpdateAt: null,
          },
          markets: marketSlugs.map((marketSlug) => ({
            marketSlug,
            bestBid: null,
            bestAsk: null,
            lastTrade: null,
            spread: null,
            marketState: null,
            sharesTraded: null,
            openInterest: null,
            tradePrice: null,
            tradeQuantity: null,
            tradeTime: null,
            updatedAt: null,
          })),
          warnings: [error instanceof Error ? error.message : String(error)],
        } satisfies PolymarketLiveSnapshot,
        503 as never,
      );
    }
  }

  private createClient(): PolymarketClient {
    return this.clientFactory({
      keyId: this.keyId,
      secretKey: this.secretKey,
      gatewayBaseUrl: this.gatewayBaseUrl,
      apiBaseUrl: this.apiBaseUrl,
      timeout: this.timeoutMs,
    });
  }

  private async discoverSportsFocusMarkets(filters: SportsFocusFilters): Promise<PolymarketFocusMarket[]> {
    const client = this.createClient();
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

  private async discoverEventFocusMarkets(filters: SportsFocusFilters): Promise<PolymarketFocusMarket[]> {
    const client = this.createClient();
    const events = await this.collectActiveEvents(client, {
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

  private async collectActiveEvents(
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

  private async buildPinnedResults(pinnedMarkets: PinnedPolymarketMarket[]): Promise<Array<Record<string, unknown>>> {
    const client = this.createClient();
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
        compareDescending(Date.parse(String(left.settledAt ?? left.lastActivityAt ?? 0)) || 0, Date.parse(String(right.settledAt ?? right.lastActivityAt ?? 0)) || 0)
      );
    });
  }

  private unconfiguredPayload(): Record<string, unknown> | null {
    if (this.keyId && this.secretKey) {
      return null;
    }

    return {
      status: "unconfigured",
      apiBaseUrl: this.apiBaseUrl,
      gatewayBaseUrl: this.gatewayBaseUrl,
      error: "polymarket credentials are not configured",
    };
  }

  private mapHealthError(error: unknown): ServiceResult<Record<string, unknown>> {
    if (error instanceof RateLimitError) {
      return {
        status: 200,
        body: {
          status: "degraded",
          apiBaseUrl: this.apiBaseUrl,
          gatewayBaseUrl: this.gatewayBaseUrl,
          keyIdSuffix: this.keyId.slice(-6),
          error: error.message,
        },
      };
    }

    if (error instanceof AuthenticationError) {
      return {
        status: 503,
        body: {
          status: "unhealthy",
          apiBaseUrl: this.apiBaseUrl,
          gatewayBaseUrl: this.gatewayBaseUrl,
          keyIdSuffix: this.keyId.slice(-6),
          error: error.message,
        },
      };
    }

    if (error instanceof PolymarketUSError) {
      return {
        status: 503,
        body: {
          status: "unhealthy",
          apiBaseUrl: this.apiBaseUrl,
          gatewayBaseUrl: this.gatewayBaseUrl,
          keyIdSuffix: this.keyId.slice(-6),
          error: error.message,
        },
      };
    }

    return {
      status: 503,
      body: {
        status: "unhealthy",
        apiBaseUrl: this.apiBaseUrl,
        gatewayBaseUrl: this.gatewayBaseUrl,
        keyIdSuffix: this.keyId.slice(-6),
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }

  private toErrorResponse(context: Context, error: unknown, logMessage: string): Response {
    this.logger.error(logMessage, error);

    if (error instanceof RateLimitError) {
      return jsonError(context, 429, error.message, { status: "degraded" });
    }

    if (error instanceof AuthenticationError) {
      return jsonError(context, 401, error.message, { status: "unhealthy" });
    }

    if (error instanceof PolymarketUSError) {
      return jsonError(context, 503, error.message, { status: "unhealthy" });
    }

    return jsonError(context, 500, error instanceof Error ? error.message : String(error), { status: "unhealthy" });
  }
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
    .slice(0, 3)
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

function dedupeFocusMarkets(markets: PolymarketFocusMarket[]): PolymarketFocusMarket[] {
  const deduped = new Map<string, PolymarketFocusMarket>();
  for (const market of markets) {
    if (!deduped.has(market.marketSlug)) {
      deduped.set(market.marketSlug, market);
    }
  }
  return Array.from(deduped.values());
}

async function safeMarketBbo(client: PolymarketClient, marketSlug: string): Promise<MarketBBO | null> {
  try {
    return await client.markets.bbo(marketSlug);
  } catch {
    return null;
  }
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

function compareDescending(left: number | null | undefined, right: number | null | undefined): number {
  const a = left ?? -1;
  const b = right ?? -1;
  return b - a;
}

function compareAscendingNullable(left: number | null | undefined, right: number | null | undefined): number {
  const a = left ?? Number.POSITIVE_INFINITY;
  const b = right ?? Number.POSITIVE_INFINITY;
  return a - b;
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function hoursUntil(isoTimestamp: string): number | null {
  const timestamp = Date.parse(isoTimestamp);
  if (Number.isNaN(timestamp)) {
    return null;
  }
  return (timestamp - Date.now()) / 3_600_000;
}

function isSportsEvent(event: Event): boolean {
  return (event.tags ?? []).some((tag) => tag.slug === "sports");
}
