import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  AuthenticationError,
  RateLimitError,
  type GetActivitiesResponse,
  type GetAccountBalancesResponse,
  type GetEventsResponse,
  type GetMarketResponse,
  type GetOpenOrdersResponse,
  type GetUserPositionsResponse,
} from "polymarket-us";

import { createApp, type ExternalServices } from "../app.js";
import { buildAggregateHealth } from "../health.js";
import { PolymarketPinsStore } from "../polymarket/pins.js";
import { PolymarketService, type PolymarketClient } from "../polymarket/service.js";

const TEST_TEMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "polymarket-tests-"));

function createClient(overrides?: Partial<PolymarketClient>): PolymarketClient {
  return {
    account: {
      balances: async () =>
        ({
          balances: [{ currency: "USD", currentBalance: 12.5, buyingPower: 12.5 }],
        }) satisfies GetAccountBalancesResponse,
    },
    events: {
      list: async () =>
        ({
          events: [
            {
              id: 1,
              slug: "nba-cle-atl-2026-04-10",
              title: "Cleveland vs. Atlanta 2026-04-10",
              active: true,
              closed: false,
              archived: false,
              featured: false,
              markets: [
                {
                  id: 11,
                  slug: "aec-nba-cle-atl-2026-04-10",
                  title: "Cleveland vs. Atlanta moneyline",
                  outcome: "Cleveland",
                  active: true,
                  closed: false,
                },
              ],
              tags: [
                { id: 10, slug: "sports", label: "Sports" },
                { id: 11, slug: "nba", label: "NBA" },
              ],
              series: {
                id: 22,
                slug: "nba-2026",
                title: "NBA 2026",
              },
              liquidity: 100000,
              volume: 150000,
            },
          ],
        }) satisfies GetEventsResponse,
    },
    markets: {
      retrieveBySlug: async () =>
        ({
          market: {
            id: 11,
            slug: "aec-nba-cle-atl-2026-04-10",
            title: "Cleveland vs. Atlanta moneyline",
            outcome: "Cleveland",
            active: true,
            closed: false,
            liquidity: 100000,
            volume: 150000,
            eventSlug: "nba-cle-atl-2026-04-10",
          },
        }) satisfies GetMarketResponse,
      bbo: async () => ({
        marketSlug: "aec-nba-cle-atl-2026-04-10",
        openInterest: "250000",
      }),
      settlement: async () => ({
        marketSlug: "aec-nba-cle-atl-2026-04-10",
        settlementPrice: { value: "1", currency: "USD" },
        settledAt: "2026-04-10T20:00:00.000Z",
      }),
    },
    portfolio: {
      positions: async () =>
        ({
          positions: {
            sample: {
              netPosition: "1",
              qtyBought: "1",
              qtySold: "0",
              cost: { value: "0.45", currency: "USD" },
              realized: { value: "0", currency: "USD" },
              bodPosition: "1",
              expired: false,
            },
          },
          eof: true,
        }) satisfies GetUserPositionsResponse,
      activities: async () =>
        ({
          activities: [],
          eof: true,
        }) satisfies GetActivitiesResponse,
    },
    orders: {
      list: async () =>
        ({
          orders: [],
        }) satisfies GetOpenOrdersResponse,
    },
    ...overrides,
  };
}

function createServices(overrides?: Partial<ExternalServices>): ExternalServices {
  return {
    whoop: {
      getAggregateHealth: async () => ({ status: "healthy" }),
      warmup: async () => {},
      proactiveRefreshIfExpiring: async () => {},
    } as unknown as ExternalServices["whoop"],
    tonal: {
      getAggregateHealth: async () => ({ status: "healthy" }),
      warmup: async () => {},
      proactiveRefreshIfExpiring: async () => {},
    } as unknown as ExternalServices["tonal"],
    alpaca: {
      checkHealth: async () => ({ status: "healthy" }),
    } as unknown as ExternalServices["alpaca"],
    appleHealth: {
      handleHealth: async () => ({ status: 200, body: { status: "healthy" } }),
    } as unknown as ExternalServices["appleHealth"],
    marketData: {
      checkHealth: async () => ({ status: "healthy" }),
    } as unknown as ExternalServices["marketData"],
    polymarket: new PolymarketService({
      keyId: "test-key-id",
      secretKey: "test-secret",
      clientFactory: () => createClient(),
      pinsStore: new PolymarketPinsStore(path.join(TEST_TEMP_ROOT, `pins-${Date.now()}-${Math.random()}.json`)),
      streamRuntime: {
        getSnapshot: async (marketSlugs = []) => ({
          generatedAt: "2026-04-09T20:00:02.000Z",
          status: "ok",
          apiBaseUrl: "https://api.polymarket.us",
          keyIdSuffix: "key-id",
          streamer: {
            marketsConnected: true,
            privateConnected: true,
            operatorState: "healthy",
            trackedMarketCount: marketSlugs.length,
            trackedMarketSlugs: marketSlugs,
            lastMarketMessageAt: "2026-04-09T20:00:01.000Z",
            lastPrivateMessageAt: "2026-04-09T20:00:01.500Z",
            lastError: null,
          },
          account: {
            balance: 0,
            buyingPower: 0,
            openOrdersCount: 0,
            positionCount: 0,
            lastBalanceUpdateAt: null,
            lastOrdersUpdateAt: null,
            lastPositionsUpdateAt: null,
          },
          markets: marketSlugs.map((marketSlug) => ({
            marketSlug,
            bestBid: 0.41,
            bestAsk: 0.43,
            lastTrade: 0.42,
            spread: 0.02,
            marketState: "MARKET_STATE_OPEN",
            sharesTraded: 1500,
            openInterest: 2100,
            tradePrice: 0.42,
            tradeQuantity: 25,
            tradeTime: "2026-04-09T20:00:01.000Z",
            updatedAt: "2026-04-09T20:00:01.000Z",
          })),
          warnings: [],
        }),
      },
    }),
    ...overrides,
  };
}

describe("buildAggregateHealth", () => {
  it("degrades aggregate health when polymarket is unconfigured", () => {
    const result = buildAggregateHealth({
      whoop: { status: "healthy" },
      tonal: { status: "healthy" },
      alpaca: { status: "healthy" },
      appleHealth: { status: "healthy" },
      marketData: { status: "healthy" },
      polymarket: { status: "unconfigured" },
    });

    expect(result.status).toBe("degraded");
    expect(result.statusCode).toBe(200);
  });
});

describe("polymarket routes", () => {
  it("exposes authenticated balances, positions, and orders", async () => {
    const app = createApp(createServices());

    const [healthResponse, balancesResponse, positionsResponse, ordersResponse, focusResponse, liveResponse, resultsResponse] = await Promise.all([
      app.request("/polymarket/health"),
      app.request("/polymarket/balances"),
      app.request("/polymarket/positions?limit=10"),
      app.request("/polymarket/orders"),
      app.request("/polymarket/focus"),
      app.request("/polymarket/live?slugs=fed-cut"),
      app.request("/polymarket/results"),
    ]);

    expect(healthResponse.status).toBe(200);
    expect(await healthResponse.json()).toMatchObject({ status: "healthy", balanceCount: 1 });

    expect(balancesResponse.status).toBe(200);
    expect(await balancesResponse.json()).toMatchObject({
      balances: [{ currency: "USD", currentBalance: 12.5, buyingPower: 12.5 }],
    });

    expect(positionsResponse.status).toBe(200);
    expect(await positionsResponse.json()).toMatchObject({
      positions: {
        sample: { netPosition: "1" },
      },
    });

    expect(ordersResponse.status).toBe(200);
    expect(await ordersResponse.json()).toMatchObject({ orders: [] });

    expect(focusResponse.status).toBe(200);
    expect(await focusResponse.json()).toMatchObject({
      status: "ok",
      events: [],
      sports: [
        {
          bucket: "sports",
          marketSlug: "aec-nba-cle-atl-2026-04-10",
          liquidity: 100000,
          volume: 150000,
          openInterest: 250000,
        },
      ],
    });

    expect(liveResponse.status).toBe(200);
    expect(await liveResponse.json()).toMatchObject({
      status: "ok",
      streamer: { operatorState: "healthy", trackedMarketSlugs: ["fed-cut"] },
    });

    expect(resultsResponse.status).toBe(200);
    expect(await resultsResponse.json()).toMatchObject({
      results: [],
    });
  });

  it("persists pinned markets and exposes them through focus", async () => {
    const app = createApp(createServices());

    const addResponse = await app.request("/polymarket/pins", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        marketSlug: "rdc-usfed-fomc-2026-04-29-cut25bps",
        bucket: "events",
        title: "Fed easing odds",
        eventTitle: "Fed Decision in April",
        league: null,
      }),
    });

    expect(addResponse.status).toBe(200);
    expect(await addResponse.json()).toMatchObject({
      ok: true,
      pinned: [
        {
          marketSlug: "rdc-usfed-fomc-2026-04-29-cut25bps",
          bucket: "events",
          title: "Fed easing odds",
        },
      ],
    });

    const [pinsResponse, focusResponse] = await Promise.all([
      app.request("/polymarket/pins"),
      app.request("/polymarket/focus"),
    ]);

    expect(pinsResponse.status).toBe(200);
    expect(await pinsResponse.json()).toMatchObject({
      pinned: [
        {
          marketSlug: "rdc-usfed-fomc-2026-04-29-cut25bps",
          bucket: "events",
          title: "Fed easing odds",
        },
      ],
    });

    expect(focusResponse.status).toBe(200);
    expect(await focusResponse.json()).toMatchObject({
      pinned: [
        {
          marketSlug: "rdc-usfed-fomc-2026-04-29-cut25bps",
          bucket: "events",
          title: "Fed easing odds",
        },
      ],
    });
  });

  it("keeps multiple ranked event markets available for focus refill", async () => {
    const app = createApp(createServices({
      polymarket: new PolymarketService({
        keyId: "test-key-id",
        secretKey: "test-secret",
        clientFactory: () =>
          createClient({
            events: {
              list: async () => ({
                events: [
                  {
                    id: 101,
                    slug: "cpi-april-2026",
                    title: "CPI year-over-year in April",
                    active: true,
                    closed: false,
                    archived: false,
                    featured: false,
                    markets: [
                      {
                        id: 1001,
                        slug: "cpic-uscpi-apr2026yoy-2026-05-12-3pt5pct",
                        title: "Exactly 3.5",
                        outcome: "3.5",
                        active: true,
                        closed: false,
                        liquidity: 90000,
                        volume: 120000,
                      },
                      {
                        id: 1002,
                        slug: "cpic-uscpi-apr2026yoy-2026-05-12-3pt9pct",
                        title: "Exactly 3.9",
                        outcome: "3.9",
                        active: true,
                        closed: false,
                        liquidity: 85000,
                        volume: 110000,
                      },
                    ],
                    tags: [
                      { id: 1, slug: "economics", label: "Economics" },
                    ],
                    liquidity: 100000,
                    volume: 140000,
                  },
                  {
                    id: 102,
                    slug: "fed-april-2026",
                    title: "Fed Decision in April",
                    active: true,
                    closed: false,
                    archived: false,
                    featured: false,
                    markets: [
                      {
                        id: 1003,
                        slug: "rdc-usfed-fomc-2026-04-29-maintains",
                        title: "Maintains",
                        outcome: "Maintains",
                        active: true,
                        closed: false,
                        liquidity: 70000,
                        volume: 100000,
                      },
                      {
                        id: 1004,
                        slug: "rdc-usfed-fomc-2026-04-29-cutgt25bps",
                        title: "Cut >25bps",
                        outcome: "Cut >25bps",
                        active: true,
                        closed: false,
                        liquidity: 65000,
                        volume: 90000,
                      },
                    ],
                    tags: [
                      { id: 2, slug: "economics", label: "Economics" },
                    ],
                    liquidity: 80000,
                    volume: 105000,
                  },
                  {
                    id: 103,
                    slug: "us-senate-midterms-2026",
                    title: "U.S. Senate Midterm Winner",
                    active: true,
                    closed: false,
                    archived: false,
                    featured: false,
                    markets: [
                      {
                        id: 1005,
                        slug: "paccc-usse-midterms-2026-11-03-dem",
                        title: "Democratic Party",
                        outcome: "Democratic Party",
                        active: true,
                        closed: false,
                        liquidity: 60000,
                        volume: 80000,
                      },
                    ],
                    tags: [
                      { id: 3, slug: "politics", label: "Politics" },
                    ],
                    liquidity: 65000,
                    volume: 85000,
                  },
                ],
              }),
            },
            markets: {
              retrieveBySlug: async () => ({
                market: {
                  id: 999,
                  slug: "placeholder",
                  title: "placeholder",
                  outcome: "yes",
                  active: true,
                  closed: false,
                },
              }),
              bbo: async (slug: string) => ({
                marketSlug: slug,
                openInterest: "250000",
              }),
              settlement: async () => ({
                marketSlug: "placeholder",
                settlementPrice: { value: "1", currency: "USD" },
                settledAt: "2026-04-10T20:00:00.000Z",
              }),
            },
          }),
        pinsStore: new PolymarketPinsStore(path.join(TEST_TEMP_ROOT, `event-refill-${Date.now()}-${Math.random()}.json`)),
      }),
    }));

    const focusResponse = await app.request("/polymarket/focus?limit=5");

    expect(focusResponse.status).toBe(200);
    expect(await focusResponse.json()).toMatchObject({
      events: [
        { marketSlug: "cpic-uscpi-apr2026yoy-2026-05-12-3pt5pct" },
        { marketSlug: "cpic-uscpi-apr2026yoy-2026-05-12-3pt9pct" },
        { marketSlug: "rdc-usfed-fomc-2026-04-29-maintains" },
        { marketSlug: "rdc-usfed-fomc-2026-04-29-cutgt25bps" },
        { marketSlug: "paccc-usse-midterms-2026-11-03-dem" },
      ],
    });
  });

  it("removes pinned markets", async () => {
    const app = createApp(createServices());

    await app.request("/polymarket/pins", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        marketSlug: "aec-nba-cle-atl-2026-04-10",
        bucket: "sports",
        title: "Cleveland vs. Atlanta moneyline",
        eventTitle: "Cleveland vs. Atlanta 2026-04-10",
        league: "nba",
      }),
    });

    const removeResponse = await app.request("/polymarket/pins/aec-nba-cle-atl-2026-04-10", {
      method: "DELETE",
    });

    expect(removeResponse.status).toBe(200);
    expect(await removeResponse.json()).toMatchObject({ ok: true, pinned: [] });
  });

  it("builds settled results for pinned markets", async () => {
    const app = createApp(createServices({
      polymarket: new PolymarketService({
        keyId: "test-key-id",
        secretKey: "test-secret",
        clientFactory: () =>
          createClient({
            markets: {
              retrieveBySlug: async () => ({
                market: {
                  id: 55,
                  slug: "rdc-usfed-fomc-2026-04-29-cut25bps",
                  title: "Fed easing odds",
                  outcome: "Cut >25bps",
                  active: false,
                  closed: true,
                },
              }),
              bbo: async () => ({
                marketSlug: "rdc-usfed-fomc-2026-04-29-cut25bps",
              }),
              settlement: async () => ({
                marketSlug: "rdc-usfed-fomc-2026-04-29-cut25bps",
                settlementPrice: { value: "1", currency: "USD" },
                settledAt: "2026-04-10T21:00:00.000Z",
              }),
            },
            portfolio: {
              positions: async () => ({ positions: {}, eof: true }),
              activities: async () => ({
                activities: [
                  {
                    type: "ACTIVITY_TYPE_TRADE",
                    trade: {
                      id: "trade-1",
                      marketSlug: "rdc-usfed-fomc-2026-04-29-cut25bps",
                      state: "FILLED",
                      price: { value: "0.42", currency: "USD" },
                      qty: "10",
                      realizedPnl: { value: "5.80", currency: "USD" },
                      updateTime: "2026-04-10T21:00:00.000Z",
                    },
                  },
                ],
                eof: true,
              }),
            },
          }),
        pinsStore: new PolymarketPinsStore(path.join(TEST_TEMP_ROOT, `results-${Date.now()}-${Math.random()}.json`)),
      }),
    }));

    await app.request("/polymarket/pins", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        marketSlug: "rdc-usfed-fomc-2026-04-29-cut25bps",
        bucket: "events",
        title: "Fed easing odds",
        eventTitle: "Fed Decision in April",
        league: null,
      }),
    });

    const response = await app.request("/polymarket/results");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      results: [
        {
          marketSlug: "rdc-usfed-fomc-2026-04-29-cut25bps",
          status: "settled",
          traded: true,
          realizedPnl: 5.8,
          settlementPrice: 1,
          resultLabel: "Fed easing odds won · +$5.80 realized",
        },
      ],
    });
  });

  it("builds live economics for open pinned positions", async () => {
    const app = createApp(createServices({
      polymarket: new PolymarketService({
        keyId: "test-key-id",
        secretKey: "test-secret",
        clientFactory: () =>
          createClient({
            markets: {
              retrieveBySlug: async () => ({
                market: {
                  id: 77,
                  slug: "rdc-usfed-fomc-2026-04-29-maintains",
                  title: "Fed easing odds",
                  outcome: "Maintains",
                  active: true,
                  closed: false,
                },
              }),
              bbo: async () => ({
                marketSlug: "rdc-usfed-fomc-2026-04-29-maintains",
              }),
              settlement: async () => {
                throw new Error("not settled");
              },
            },
            portfolio: {
              positions: async () => ({
                positions: {
                  "rdc-usfed-fomc-2026-04-29-maintains": {
                    netPosition: "12",
                    qtyBought: "12",
                    qtySold: "0",
                    cost: { value: "6.24", currency: "USD" },
                    realized: { value: "0", currency: "USD" },
                    bodPosition: "12",
                    expired: false,
                    cashValue: { value: "11.64", currency: "USD" },
                  },
                },
                eof: true,
              }),
              activities: async () => ({
                activities: [
                  {
                    type: "ACTIVITY_TYPE_TRADE",
                    trade: {
                      id: "trade-2",
                      marketSlug: "rdc-usfed-fomc-2026-04-29-maintains",
                      state: "FILLED",
                      price: { value: "0.52", currency: "USD" },
                      qty: "12",
                      updateTime: "2026-04-10T21:30:00.000Z",
                    },
                  },
                ],
                eof: true,
              }),
            },
          }),
        pinsStore: new PolymarketPinsStore(path.join(TEST_TEMP_ROOT, `live-${Date.now()}-${Math.random()}.json`)),
      }),
    }));

    await app.request("/polymarket/pins", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        marketSlug: "rdc-usfed-fomc-2026-04-29-maintains",
        bucket: "events",
        title: "Fed easing odds",
        eventTitle: "Fed Decision in April",
        league: null,
      }),
    });

    const response = await app.request("/polymarket/results");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      results: [
        {
          marketSlug: "rdc-usfed-fomc-2026-04-29-maintains",
          status: "open",
          traded: true,
          netPosition: 12,
          costBasis: 6.24,
          currentValue: 11.64,
          unrealizedPnl: 5.4,
        },
      ],
    });
  });

  it("returns unconfigured when credentials are missing", async () => {
    const app = createApp(
      createServices({
        polymarket: new PolymarketService({}),
      }),
    );

    const response = await app.request("/polymarket/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "unconfigured" });
  });

  it("returns unconfigured on the live route when credentials are missing", async () => {
    const app = createApp(
      createServices({
        polymarket: new PolymarketService({}),
      }),
    );

    const response = await app.request("/polymarket/live");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "unconfigured" });
  });

  it("surfaces authentication failures on direct account routes", async () => {
    const app = createApp(
      createServices({
        polymarket: new PolymarketService({
          keyId: "test-key-id",
          secretKey: "bad-secret",
          clientFactory: () =>
            createClient({
              account: {
                balances: async () => {
                  throw new AuthenticationError("Invalid credentials");
                },
              },
            }),
        }),
      }),
    );

    const response = await app.request("/polymarket/balances");

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "Invalid credentials", status: "unhealthy" });
  });

  it("marks health degraded when the API is rate limited", async () => {
    const app = createApp(
      createServices({
        polymarket: new PolymarketService({
          keyId: "test-key-id",
          secretKey: "test-secret",
          clientFactory: () =>
            createClient({
              account: {
                balances: async () => {
                  throw new RateLimitError("Too many requests");
                },
              },
            }),
        }),
      }),
    );

    const response = await app.request("/polymarket/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "degraded", error: "Too many requests" });
  });

  it("includes polymarket in aggregate health", async () => {
    const app = createApp(
      createServices({
        polymarket: new PolymarketService({
          keyId: "test-key-id",
          secretKey: "test-secret",
          clientFactory: () =>
            createClient({
              account: {
                balances: async () => {
                  throw new AuthenticationError("Invalid credentials");
                },
              },
            }),
        }),
      }),
    );

    const response = await app.request("/health");
    const body = (await response.json()) as { status: string; polymarket: { status: string } };

    expect(response.status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.polymarket.status).toBe("unhealthy");
  });
});
