import {
  PolymarketUS,
  type AccountBalanceSnapshot,
  type AccountBalanceUpdate,
  type Amount,
  type MarketData,
  type Order,
  type OrderSnapshot,
  type OrderUpdate,
  type PolymarketUSOptions,
  type PositionSnapshot,
  type PositionUpdate,
  type PrivateWebSocket,
  type Trade,
  type UserPosition,
  type MarketsWebSocket,
} from "polymarket-us";

import { createLogger, type AppLogger } from "../lib/logger.js";

const MARKET_DATA_REQUEST_ID = "polymarket-market-data";
const TRADE_REQUEST_ID = "polymarket-trades";
const ORDER_REQUEST_ID = "polymarket-orders";
const POSITION_REQUEST_ID = "polymarket-positions";
const BALANCE_REQUEST_ID = "polymarket-balance";

export interface PolymarketLiveMarketSnapshot {
  marketSlug: string;
  bestBid: number | null;
  bestAsk: number | null;
  lastTrade: number | null;
  spread: number | null;
  marketState: string | null;
  sharesTraded: number | null;
  openInterest: number | null;
  tradePrice: number | null;
  tradeQuantity: number | null;
  tradeTime: string | null;
  updatedAt: string | null;
}

export interface PolymarketLiveAccountSnapshot {
  balance: number | null;
  buyingPower: number | null;
  openOrdersCount: number | null;
  positionCount: number | null;
  lastBalanceUpdateAt: string | null;
  lastOrdersUpdateAt: string | null;
  lastPositionsUpdateAt: string | null;
}

export interface PolymarketLiveSnapshot {
  generatedAt: string;
  status: "ok" | "degraded" | "error" | "unconfigured";
  apiBaseUrl: string;
  keyIdSuffix: string | null;
  streamer: {
    marketsConnected: boolean;
    privateConnected: boolean;
    operatorState: string;
    trackedMarketCount: number;
    trackedMarketSlugs: string[];
    lastMarketMessageAt: string | null;
    lastPrivateMessageAt: string | null;
    lastError: string | null;
  };
  account: PolymarketLiveAccountSnapshot;
  markets: PolymarketLiveMarketSnapshot[];
  warnings: string[];
}

export interface PolymarketStreamRuntimeLike {
  getSnapshot(marketSlugs?: string[]): Promise<PolymarketLiveSnapshot>;
}

export interface PolymarketStreamRuntimeOptions {
  keyId?: string;
  secretKey?: string;
  apiBaseUrl?: string;
  timeoutMs?: number;
  logger?: AppLogger;
  clientFactory?: (options: PolymarketUSOptions) => PolymarketUS;
}

export class PolymarketStreamRuntime implements PolymarketStreamRuntimeLike {
  private readonly keyId: string;
  private readonly secretKey: string;
  private readonly apiBaseUrl: string;
  private readonly timeoutMs: number;
  private readonly logger: AppLogger;
  private readonly clientFactory: (options: PolymarketUSOptions) => PolymarketUS;
  private client: PolymarketUS | null = null;
  private marketsWs: MarketsWebSocket | null = null;
  private privateWs: PrivateWebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private readonly trackedMarketSlugs = new Set<string>();
  private subscribedMarketSignature = "";
  private readonly marketSnapshots = new Map<string, PolymarketLiveMarketSnapshot>();
  private readonly orderStates = new Map<string, string>();
  private readonly positions = new Map<string, UserPosition>();
  private balance: number | null = null;
  private buyingPower: number | null = null;
  private lastMarketMessageAt = 0;
  private lastPrivateMessageAt = 0;
  private lastBalanceUpdateAt = 0;
  private lastOrdersUpdateAt = 0;
  private lastPositionsUpdateAt = 0;
  private lastError: string | null = null;

  constructor(options: PolymarketStreamRuntimeOptions) {
    this.keyId = normalizeOptionalString(options.keyId);
    this.secretKey = normalizeOptionalString(options.secretKey);
    this.apiBaseUrl = normalizeRootBaseUrl(options.apiBaseUrl ?? "https://api.polymarket.us");
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.logger = options.logger ?? createLogger("polymarket-stream");
    this.clientFactory = options.clientFactory ?? ((clientOptions) => new PolymarketUS(clientOptions));
  }

  async getSnapshot(marketSlugs: string[] = []): Promise<PolymarketLiveSnapshot> {
    if (!this.keyId || !this.secretKey) {
      return this.buildSnapshot("unconfigured", normalizeSlugs(marketSlugs));
    }

    const slugs = normalizeSlugs(marketSlugs);

    try {
      await this.ensureConnected();
      await this.syncMarketSubscriptions(slugs);
      await this.seedAccountSnapshot();
      await this.seedMissingMarketSnapshots(slugs);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.logger.error("polymarket stream snapshot failed", error);
    }

    return this.buildSnapshot(this.deriveStatus(), slugs);
  }

  private async ensureConnected(): Promise<void> {
    if (this.connectPromise) {
      await this.connectPromise;
      return;
    }

    this.connectPromise = this.connectInternal().finally(() => {
      this.connectPromise = null;
    });
    await this.connectPromise;
  }

  private async connectInternal(): Promise<void> {
    const results = await Promise.allSettled([this.ensureMarketsConnection(), this.ensurePrivateConnection()]);
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => String(result.reason));

    if (failures.length > 0) {
      this.lastError = failures.join("; ");
      if (!this.isMarketsConnected() && !this.isPrivateConnected()) {
        throw new Error(this.lastError);
      }
    }
  }

  private async ensureMarketsConnection(): Promise<void> {
    if (this.isMarketsConnected()) {
      return;
    }

    const ws = this.getClient().ws.markets();
    this.attachMarketsListeners(ws);
    await withTimeout(ws.connect(), this.timeoutMs, "Polymarket markets WebSocket timed out");
    this.marketsWs = ws;
  }

  private async ensurePrivateConnection(): Promise<void> {
    if (this.isPrivateConnected()) {
      return;
    }

    const ws = this.getClient().ws.private();
    this.attachPrivateListeners(ws);
    await withTimeout(ws.connect(), this.timeoutMs, "Polymarket private WebSocket timed out");
    ws.subscribeOrders(ORDER_REQUEST_ID);
    ws.subscribePositions(POSITION_REQUEST_ID);
    ws.subscribeAccountBalance(BALANCE_REQUEST_ID);
    this.privateWs = ws;
  }

  private async syncMarketSubscriptions(marketSlugs: string[]): Promise<void> {
    for (const slug of marketSlugs) {
      this.trackedMarketSlugs.add(slug);
    }

    const desired = Array.from(this.trackedMarketSlugs).sort();
    const signature = desired.join(",");
    if (signature === this.subscribedMarketSignature || !this.marketsWs || !this.isMarketsConnected()) {
      return;
    }

    if (this.subscribedMarketSignature) {
      try {
        this.marketsWs.unsubscribe(MARKET_DATA_REQUEST_ID);
        this.marketsWs.unsubscribe(TRADE_REQUEST_ID);
      } catch (error) {
        this.logger.printf(
          "polymarket stream unsubscribe failed: %s",
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    if (desired.length > 0) {
      this.marketsWs.subscribeMarketData(MARKET_DATA_REQUEST_ID, desired);
      this.marketsWs.subscribeTrades(TRADE_REQUEST_ID, desired);
    }

    this.subscribedMarketSignature = signature;
  }

  private async seedAccountSnapshot(): Promise<void> {
    if (this.lastBalanceUpdateAt > 0 && this.lastOrdersUpdateAt > 0 && this.lastPositionsUpdateAt > 0) {
      return;
    }

    const client = this.getClient();
    const [balancesResult, positionsResult, ordersResult] = await Promise.allSettled([
      client.account.balances(),
      client.portfolio.positions({ limit: 50 }),
      client.orders.list(),
    ]);

    if (balancesResult.status === "fulfilled") {
      const usdBalance = balancesResult.value.balances[0];
      this.balance = parseNumber(usdBalance?.currentBalance) ?? 0;
      this.buyingPower = parseNumber(usdBalance?.buyingPower) ?? 0;
      this.lastBalanceUpdateAt = Date.now();
    }

    if (positionsResult.status === "fulfilled") {
      this.positions.clear();
      for (const [key, position] of Object.entries(positionsResult.value.positions)) {
        if (readPositionSize(position) > 0) {
          this.positions.set(key, position);
        }
      }
      this.lastPositionsUpdateAt = Date.now();
    }

    if (ordersResult.status === "fulfilled") {
      this.orderStates.clear();
      for (const order of ordersResult.value.orders) {
        if (isOpenOrderState(order.state)) {
          this.orderStates.set(order.id, order.state);
        }
      }
      this.lastOrdersUpdateAt = Date.now();
    }
  }

  private async seedMissingMarketSnapshots(marketSlugs: string[]): Promise<void> {
    const missing = marketSlugs.filter((slug) => !this.marketSnapshots.get(slug)?.updatedAt);
    if (missing.length === 0) {
      return;
    }

    const client = this.getClient();
    await Promise.allSettled(
      missing.map(async (marketSlug) => {
        const [bookResult, bboResult] = await Promise.allSettled([
          client.markets.book(marketSlug),
          client.markets.bbo(marketSlug),
        ]);

        const existing = this.marketSnapshots.get(marketSlug) ?? emptyMarketSnapshot(marketSlug);
        const book = bookResult.status === "fulfilled" ? bookResult.value : null;
        const bbo = bboResult.status === "fulfilled" ? bboResult.value : null;
        const bestBid = parseAmount(book?.bids[0]?.px) ?? parseAmount(bbo?.bestBid);
        const bestAsk = parseAmount(book?.offers[0]?.px) ?? parseAmount(bbo?.bestAsk);
        const lastTrade = parseAmount(book?.stats?.lastTradePx) ?? parseAmount(bbo?.lastTradePx);

        this.marketSnapshots.set(marketSlug, {
          ...existing,
          bestBid,
          bestAsk,
          lastTrade,
          spread: bestBid != null && bestAsk != null ? round(bestAsk - bestBid, 4) : null,
          marketState: normalizeOptionalString(book?.state) || null,
          sharesTraded: parseNumber(book?.stats?.sharesTraded) ?? parseNumber(bbo?.sharesTraded),
          openInterest: parseNumber(book?.stats?.openInterest) ?? parseNumber(bbo?.openInterest),
          updatedAt: book?.transactTime ?? new Date().toISOString(),
        });
      }),
    );
  }

  private buildSnapshot(
    status: PolymarketLiveSnapshot["status"],
    requestedSlugs: string[],
  ): PolymarketLiveSnapshot {
    const tracked = Array.from(this.trackedMarketSlugs).sort();
    const slugs = requestedSlugs.length > 0 ? requestedSlugs : tracked;
    const markets = slugs.map((slug) => this.marketSnapshots.get(slug) ?? emptyMarketSnapshot(slug));
    const warnings = compactStrings([
      this.lastError,
      !this.isMarketsConnected() && status !== "unconfigured" ? "markets websocket disconnected" : null,
      !this.isPrivateConnected() && status !== "unconfigured" ? "private websocket disconnected" : null,
    ]);

    return {
      generatedAt: new Date().toISOString(),
      status,
      apiBaseUrl: this.apiBaseUrl,
      keyIdSuffix: this.keyId ? this.keyId.slice(-6) : null,
      streamer: {
        marketsConnected: this.isMarketsConnected(),
        privateConnected: this.isPrivateConnected(),
        operatorState:
          status === "ok"
            ? "healthy"
            : status === "unconfigured"
              ? "unconfigured"
              : status === "degraded"
                ? "degraded"
                : "error",
        trackedMarketCount: tracked.length,
        trackedMarketSlugs: tracked,
        lastMarketMessageAt: toIsoOrNull(this.lastMarketMessageAt),
        lastPrivateMessageAt: toIsoOrNull(this.lastPrivateMessageAt),
        lastError: this.lastError,
      },
      account: {
        balance: this.balance,
        buyingPower: this.buyingPower,
        openOrdersCount: this.orderStates.size,
        positionCount: this.positions.size,
        lastBalanceUpdateAt: toIsoOrNull(this.lastBalanceUpdateAt),
        lastOrdersUpdateAt: toIsoOrNull(this.lastOrdersUpdateAt),
        lastPositionsUpdateAt: toIsoOrNull(this.lastPositionsUpdateAt),
      },
      markets,
      warnings,
    };
  }

  private deriveStatus(): PolymarketLiveSnapshot["status"] {
    if (this.isMarketsConnected() && this.isPrivateConnected()) {
      return this.lastError ? "degraded" : "ok";
    }

    if (this.isMarketsConnected() || this.isPrivateConnected()) {
      return "degraded";
    }

    return "error";
  }

  private attachMarketsListeners(ws: MarketsWebSocket): void {
    ws.on("marketData", (message) => {
      this.lastMarketMessageAt = Date.now();
      this.lastError = null;
      this.upsertMarketData(message);
    });
    ws.on("trade", (message) => {
      this.lastMarketMessageAt = Date.now();
      this.lastError = null;
      this.upsertTrade(message);
    });
    ws.on("error", (error) => {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.logger.printf("polymarket markets websocket error: %s", this.lastError);
    });
    ws.on("close", () => {
      this.logger.log("polymarket markets websocket closed");
    });
  }

  private attachPrivateListeners(ws: PrivateWebSocket): void {
    ws.on("orderSnapshot", (message) => {
      this.lastPrivateMessageAt = Date.now();
      this.lastOrdersUpdateAt = Date.now();
      this.lastError = null;
      this.orderStates.clear();
      for (const order of message.orderSubscriptionSnapshot.orders) {
        this.orderStates.set(order.id, order.state);
      }
    });
    ws.on("orderUpdate", (message) => {
      this.lastPrivateMessageAt = Date.now();
      this.lastOrdersUpdateAt = Date.now();
      this.lastError = null;
      this.applyOrderUpdate(message);
    });
    ws.on("positionSnapshot", (message) => {
      this.lastPrivateMessageAt = Date.now();
      this.lastPositionsUpdateAt = Date.now();
      this.lastError = null;
      this.positions.clear();
      for (const [key, position] of Object.entries(message.positionSubscriptionSnapshot.positions)) {
        if (readPositionSize(position) > 0) {
          this.positions.set(key, position);
        }
      }
    });
    ws.on("positionUpdate", (message) => {
      this.lastPrivateMessageAt = Date.now();
      this.lastPositionsUpdateAt = Date.now();
      this.lastError = null;
      const key = message.positionSubscriptionUpdate.marketSlug;
      const position = message.positionSubscriptionUpdate.position;
      if (readPositionSize(position) > 0) {
        this.positions.set(key, position);
      } else {
        this.positions.delete(key);
      }
    });
    ws.on("accountBalanceSnapshot", (message) => {
      this.lastPrivateMessageAt = Date.now();
      this.lastBalanceUpdateAt = Date.now();
      this.lastError = null;
      this.applyBalanceSnapshot(message);
    });
    ws.on("accountBalanceUpdate", (message) => {
      this.lastPrivateMessageAt = Date.now();
      this.lastBalanceUpdateAt = Date.now();
      this.lastError = null;
      this.applyBalanceUpdate(message);
    });
    ws.on("error", (error) => {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.logger.printf("polymarket private websocket error: %s", this.lastError);
    });
    ws.on("close", () => {
      this.logger.log("polymarket private websocket closed");
    });
  }

  private upsertMarketData(message: MarketData): void {
    const marketSlug = message.marketData.marketSlug;
    const existing = this.marketSnapshots.get(marketSlug) ?? emptyMarketSnapshot(marketSlug);
    const bestBid = parseAmount(message.marketData.bids[0]?.px);
    const bestAsk = parseAmount(message.marketData.offers[0]?.px);
    const lastTrade = parseAmount(message.marketData.stats?.lastTradePx);
    const updatedAt = message.marketData.transactTime ?? new Date().toISOString();

    this.marketSnapshots.set(marketSlug, {
      ...existing,
      bestBid,
      bestAsk,
      lastTrade,
      spread: bestBid != null && bestAsk != null ? round(bestAsk - bestBid, 4) : null,
      marketState: normalizeOptionalString(message.marketData.state) || null,
      sharesTraded: parseNumber(message.marketData.stats?.sharesTraded),
      openInterest: parseNumber(message.marketData.stats?.openInterest),
      updatedAt,
    });
  }

  private upsertTrade(message: Trade): void {
    const marketSlug = message.trade.marketSlug;
    const existing = this.marketSnapshots.get(marketSlug) ?? emptyMarketSnapshot(marketSlug);
    const tradePrice = parseAmount(message.trade.price);

    this.marketSnapshots.set(marketSlug, {
      ...existing,
      lastTrade: tradePrice ?? existing.lastTrade,
      tradePrice,
      tradeQuantity: parseAmount(message.trade.quantity),
      tradeTime: message.trade.tradeTime ?? existing.tradeTime,
      updatedAt: message.trade.tradeTime ?? existing.updatedAt ?? new Date().toISOString(),
    });
  }

  private applyOrderUpdate(message: OrderUpdate): void {
    const order = message.orderSubscriptionUpdate.execution.order;
    if (isOpenOrderState(order.state)) {
      this.orderStates.set(order.id, order.state);
    } else {
      this.orderStates.delete(order.id);
    }
  }

  private applyBalanceSnapshot(message: AccountBalanceSnapshot): void {
    const legacySnapshot = (message as AccountBalanceSnapshot & {
      accountBalancesSnapshot?: { balances?: Array<{ currentBalance?: number; buyingPower?: number }> };
    }).accountBalancesSnapshot;

    if (legacySnapshot) {
      const firstBalance = legacySnapshot.balances?.[0];
      this.balance = parseNumber(firstBalance?.currentBalance) ?? 0;
      this.buyingPower = parseNumber(firstBalance?.buyingPower) ?? 0;
      return;
    }

    const subscriptionSnapshot = (message as AccountBalanceSnapshot & {
      accountBalanceSubscriptionSnapshot?: { balance?: number; buyingPower?: number };
    }).accountBalanceSubscriptionSnapshot;
    this.balance = parseNumber(subscriptionSnapshot?.balance) ?? 0;
    this.buyingPower = parseNumber(subscriptionSnapshot?.buyingPower) ?? 0;
  }

  private applyBalanceUpdate(message: AccountBalanceUpdate): void {
    const legacyUpdate = (message as AccountBalanceUpdate & {
      accountBalancesUpdate?: {
        balanceChange?: { afterBalance?: { currentBalance?: number; buyingPower?: number } };
      };
      accountBalanceUpdate?: {
        balanceChange?: { afterBalance?: { currentBalance?: number; buyingPower?: number } };
      };
    }).accountBalancesUpdate;

    const legacyAfterBalance =
      legacyUpdate?.balanceChange?.afterBalance ??
      (message as AccountBalanceUpdate & {
        accountBalanceUpdate?: {
          balanceChange?: { afterBalance?: { currentBalance?: number; buyingPower?: number } };
        };
      }).accountBalanceUpdate?.balanceChange?.afterBalance;

    if (legacyAfterBalance) {
      this.balance = parseNumber(legacyAfterBalance.currentBalance) ?? 0;
      this.buyingPower = parseNumber(legacyAfterBalance.buyingPower) ?? 0;
      return;
    }

    const subscriptionUpdate = (message as AccountBalanceUpdate & {
      accountBalanceSubscriptionUpdate?: { balance?: number; buyingPower?: number };
    }).accountBalanceSubscriptionUpdate;
    this.balance = parseNumber(subscriptionUpdate?.balance) ?? 0;
    this.buyingPower = parseNumber(subscriptionUpdate?.buyingPower) ?? 0;
  }

  private getClient(): PolymarketUS {
    if (!this.client) {
      this.client = this.clientFactory({
        keyId: this.keyId,
        secretKey: this.secretKey,
        apiBaseUrl: this.apiBaseUrl,
        timeout: this.timeoutMs,
      });
    }

    return this.client;
  }

  private isMarketsConnected(): boolean {
    return this.marketsWs?.isConnected ?? false;
  }

  private isPrivateConnected(): boolean {
    return this.privateWs?.isConnected ?? false;
  }
}

function emptyMarketSnapshot(marketSlug: string): PolymarketLiveMarketSnapshot {
  return {
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
  };
}

function normalizeRootBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/u, "");
}

function normalizeOptionalString(value: string | undefined): string {
  return value?.trim() ?? "";
}

function normalizeSlugs(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ).sort();
}

function parseAmount(value: Amount | undefined): number | null {
  return parseNumber(value?.value);
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

function readPositionSize(position: UserPosition): number {
  const size = parseNumber(position.netPosition);
  return size == null ? 0 : Math.abs(size);
}

function isOpenOrderState(state: Order["state"]): boolean {
  return [
    "ORDER_STATE_NEW",
    "ORDER_STATE_PENDING_NEW",
    "ORDER_STATE_PENDING_REPLACE",
    "ORDER_STATE_PENDING_CANCEL",
    "ORDER_STATE_PENDING_RISK",
    "ORDER_STATE_PARTIALLY_FILLED",
  ].includes(state);
}

function toIsoOrNull(value: number): string | null {
  return value > 0 ? new Date(value).toISOString() : null;
}

function compactStrings(values: Array<string | null | undefined>): string[] {
  return values.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function round(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
