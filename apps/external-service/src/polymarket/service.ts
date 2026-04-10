import type { Context } from "hono";
import {
  AuthenticationError,
  PolymarketUS,
  PolymarketUSError,
  RateLimitError,
  type GetOpenOrdersParams,
  type GetUserPositionsParams,
  type PolymarketUSOptions,
} from "polymarket-us";

import { jsonError } from "../lib/response.js";
import { createLogger, type AppLogger } from "../lib/logger.js";
import {
  PolymarketStreamRuntime,
  type PolymarketLiveSnapshot,
  type PolymarketStreamRuntimeLike,
} from "./streamer.js";
import { PolymarketPinsStore, type PinnedPolymarketMarket } from "./pins.js";
import {
  BOARD_CANDIDATE_LIMIT,
  BOARD_DISCOVERY_TTL_MS,
  BOARD_TOP_LIMIT,
  getBoardTitleKey,
  selectBoardRows,
  toBoardMarketRow,
} from "./board.js";
import {
  dedupeFocusMarkets,
  discoverEventFocusMarkets,
  discoverSportsFocusMarkets,
} from "./focus.js";
import { buildPinnedResults } from "./results.js";
import type {
  BoardDiscoverySnapshot,
  CachedBoardDiscovery,
  PolymarketClient,
  ServiceResult,
  SportsFocusFilters,
} from "./types.js";
import {
  compactStrings,
  normalizeGatewayBaseUrl,
  normalizeOptionalString,
  normalizeRootBaseUrl,
  parseNonNegativeNumber,
  parsePositiveInt,
  parseSlugs,
  parseSportsSort,
} from "./utils.js";

export type { PolymarketClient } from "./types.js";

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
  private boardDiscoveryCache: CachedBoardDiscovery | null = null;
  private boardDiscoveryPromise: Promise<BoardDiscoverySnapshot> | null = null;

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
      const client = this.createClient();
      const [sports, events, pinned] = await Promise.all([
        discoverSportsFocusMarkets(client, filters),
        discoverEventFocusMarkets(client, filters),
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

  async boardLiveHandler(context: Context): Promise<Response> {
    const unconfigured = this.unconfiguredPayload();
    if (unconfigured) {
      return context.json(
        {
          ...unconfigured,
          generatedAt: new Date().toISOString(),
          streamer: {
            marketsConnected: false,
            privateConnected: false,
            operatorState: "unconfigured",
            trackedMarketCount: 0,
            trackedMarketSlugs: [],
            lastMarketMessageAt: null,
            lastPrivateMessageAt: null,
            lastError: null,
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
          markets: [],
          warnings: ["polymarket credentials are not configured"],
        },
        503 as never,
      );
    }

    try {
      const [discovery, pinned] = await Promise.all([
        this.getBoardDiscoverySnapshot(),
        this.pinsStore.list(),
      ]);
      const pinnedSlugs = new Set(pinned.map((entry) => entry.marketSlug));
      const pinnedEventTitleKeys = new Set(
        pinned
          .filter((entry) => entry.bucket === "events")
          .map((entry) => getBoardTitleKey({
            bucket: "events",
            title: entry.title,
            eventTitle: entry.eventTitle,
          })),
      );
      const pinnedSportsTitleKeys = new Set(
        pinned
          .filter((entry) => entry.bucket === "sports")
          .map((entry) => getBoardTitleKey({
            bucket: "sports",
            title: entry.title,
            eventTitle: entry.eventTitle,
          })),
      );

      const candidatePool = dedupeFocusMarkets([
        ...discovery.events,
        ...discovery.sports,
      ]);
      const snapshot = await this.streamRuntime.getSnapshot([
        ...pinned.map((entry) => entry.marketSlug),
        ...candidatePool.map((entry) => entry.marketSlug),
      ]);
      const liveBySlug = new Map(snapshot.markets.map((entry) => [entry.marketSlug, entry]));

      const pinnedRows = pinned.map((entry) => toBoardMarketRow({
        slug: entry.marketSlug,
        title: entry.title,
        bucket: entry.bucket,
        pinned: true,
        pinnedAt: entry.pinnedAt,
        eventTitle: entry.eventTitle,
        league: entry.league,
        live: liveBySlug.get(entry.marketSlug) ?? null,
        liveStatus: snapshot.status,
      }));

      const eventRows = selectBoardRows({
        candidates: discovery.events,
        liveBySlug,
        limit: BOARD_TOP_LIMIT,
        excludeSlugs: pinnedSlugs,
        excludeTitleKeys: pinnedEventTitleKeys,
      });
      const sportsRows = selectBoardRows({
        candidates: discovery.sports,
        liveBySlug,
        limit: BOARD_TOP_LIMIT,
        excludeSlugs: pinnedSlugs,
        excludeTitleKeys: pinnedSportsTitleKeys,
      });

      return context.json(
        {
          generatedAt: new Date().toISOString(),
          streamer: snapshot.streamer,
          account: snapshot.account,
          markets: [...pinnedRows, ...eventRows, ...sportsRows],
          warnings: compactStrings([...discovery.warnings, ...snapshot.warnings]),
          roster: {
            generatedAt: discovery.generatedAt,
            candidateEventsCount: discovery.events.length,
            candidateSportsCount: discovery.sports.length,
          },
        },
        snapshot.status === "error" ? (503 as never) : (200 as never),
      );
    } catch (error) {
      return this.toErrorResponse(context, error, "polymarket board live fetch failed");
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

  private async getBoardDiscoverySnapshot(): Promise<BoardDiscoverySnapshot> {
    const now = Date.now();
    if (this.boardDiscoveryCache && now - this.boardDiscoveryCache.fetchedAt < BOARD_DISCOVERY_TTL_MS) {
      return this.boardDiscoveryCache.snapshot;
    }

    if (this.boardDiscoveryPromise) {
      return this.boardDiscoveryPromise;
    }

    this.boardDiscoveryPromise = this.refreshBoardDiscoverySnapshot().finally(() => {
      this.boardDiscoveryPromise = null;
    });
    return this.boardDiscoveryPromise;
  }

  private async refreshBoardDiscoverySnapshot(): Promise<BoardDiscoverySnapshot> {
    const filters: SportsFocusFilters = {
      limit: BOARD_CANDIDATE_LIMIT,
      sort: "composite",
      minLiquidity: null,
      minVolume: null,
      minOpenInterest: null,
      maxStartHours: null,
    };

    try {
      const client = this.createClient();
      const [sports, events] = await Promise.all([
        discoverSportsFocusMarkets(client, filters),
        discoverEventFocusMarkets(client, filters),
      ]);
      const snapshot: BoardDiscoverySnapshot = {
        generatedAt: new Date().toISOString(),
        events,
        sports,
        warnings: compactStrings([
          sports.length === 0 ? "no active sports focus markets discovered" : null,
          events.length === 0 ? "no active event focus markets discovered" : null,
        ]),
      };
      this.boardDiscoveryCache = {
        fetchedAt: Date.now(),
        snapshot,
      };
      return snapshot;
    } catch (error) {
      if (this.boardDiscoveryCache) {
        const warning = error instanceof Error ? error.message : String(error);
        return {
          ...this.boardDiscoveryCache.snapshot,
          warnings: compactStrings([
            ...this.boardDiscoveryCache.snapshot.warnings,
            `using cached board discovery: ${warning}`,
          ]),
        };
      }
      throw error;
    }
  }

  private async buildPinnedResults(pinnedMarkets: PinnedPolymarketMarket[]): Promise<Array<Record<string, unknown>>> {
    return buildPinnedResults(this.createClient(), pinnedMarkets);
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
