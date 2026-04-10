import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { loadTradingOpsPolymarketLiveData } from "@/lib/trading-ops-polymarket-live";

describe("loadTradingOpsPolymarketLiveData", () => {
  it("maps the backend-owned board payload into trading ops live data", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pm-live-loader-"));

    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/polymarket/board/live")) {
        return new Response(
          JSON.stringify({
            generatedAt: "2026-04-10T15:00:00.000Z",
            streamer: {
              marketsConnected: true,
              privateConnected: true,
              operatorState: "healthy",
              trackedMarketCount: 12,
              trackedMarketSlugs: ["event-1", "sport-1", "pin-1"],
              lastMarketMessageAt: "2026-04-10T15:00:00.000Z",
              lastPrivateMessageAt: "2026-04-10T15:00:00.000Z",
              lastError: null,
            },
            account: {
              balance: 0,
              buyingPower: 0,
              openOrdersCount: 0,
              positionCount: 0,
              lastBalanceUpdateAt: "2026-04-10T15:00:00.000Z",
              lastOrdersUpdateAt: "2026-04-10T15:00:00.000Z",
              lastPositionsUpdateAt: "2026-04-10T15:00:00.000Z",
            },
            markets: [
              {
                slug: "pin-1",
                title: "Pinned Event",
                bucket: "events",
                pinned: true,
                pinnedAt: "2026-04-10T14:59:00.000Z",
                eventTitle: "Pinned Event Title",
                league: null,
                bestBid: 0.4,
                bestAsk: 0.5,
                lastTrade: 0.45,
                spread: 0.1,
                marketState: "MARKET_STATE_OPEN",
                sharesTraded: 1000,
                openInterest: 2000,
                tradePrice: 0.45,
                tradeQuantity: 10,
                tradeTime: "2026-04-10T15:00:00.000Z",
                updatedAt: "2026-04-10T15:00:00.000Z",
              },
              {
                slug: "event-1",
                title: "Top Event",
                bucket: "events",
                pinned: false,
                pinnedAt: null,
                eventTitle: "Top Event Title",
                league: null,
                bestBid: 0.6,
                bestAsk: 0.7,
                lastTrade: 0.65,
                spread: 0.1,
                marketState: "MARKET_STATE_OPEN",
                sharesTraded: 2000,
                openInterest: 3000,
                tradePrice: 0.65,
                tradeQuantity: 12,
                tradeTime: "2026-04-10T15:00:00.000Z",
                updatedAt: "2026-04-10T15:00:00.000Z",
              },
              {
                slug: "sport-1",
                title: "Top Sport",
                bucket: "sports",
                pinned: false,
                pinnedAt: null,
                eventTitle: "Top Sport Title",
                league: "nba",
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
                warning: "waiting for first market update",
              },
            ],
            warnings: ["upstream warning"],
            roster: {
              generatedAt: "2026-04-10T14:59:30.000Z",
              candidateEventsCount: 10,
              candidateSportsCount: 10,
            },
          }),
          { status: 200 },
        );
      }

      throw new Error(`Unexpected URL: ${url}`);
    };

    const result = await loadTradingOpsPolymarketLiveData({
      repoRoot,
      baseUrl: "http://127.0.0.1:3033",
      fetchImpl,
    });

    expect(result.generatedAt).toBe("2026-04-10T15:00:00.000Z");
    expect(result.streamer.operatorState).toBe("healthy");
    expect(result.markets).toHaveLength(3);
    expect(result.markets.filter((market) => market.pinned).map((market) => market.slug)).toEqual(["pin-1"]);
    expect(result.markets.filter((market) => market.bucket === "events" && !market.pinned).map((market) => market.slug)).toEqual(["event-1"]);
    expect(result.markets.filter((market) => market.bucket === "sports" && !market.pinned).map((market) => market.slug)).toEqual(["sport-1"]);
    expect(result.warnings).toContain("upstream warning");
    expect(result.warnings).toContain("waiting for first market update");
  });

  it("surfaces board route errors while preserving parsed payload details", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pm-live-loader-error-"));

    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/polymarket/board/live")) {
        return new Response(
          JSON.stringify({
            error: "focus temporarily degraded",
            streamer: {
              operatorState: "degraded",
              trackedMarketCount: 0,
              trackedMarketSlugs: [],
              marketsConnected: false,
              privateConnected: true,
              lastMarketMessageAt: null,
              lastPrivateMessageAt: "2026-04-10T15:01:00.000Z",
              lastError: "rate limited upstream",
            },
            account: {},
            markets: [],
            warnings: ["using cached board discovery"],
          }),
          { status: 503 },
        );
      }

      throw new Error(`Unexpected URL: ${url}`);
    };

    const result = await loadTradingOpsPolymarketLiveData({
      repoRoot,
      baseUrl: "http://127.0.0.1:3033",
      fetchImpl,
    });

    expect(result.streamer.operatorState).toBe("degraded");
    expect(result.warnings).toContain("HTTP 503: focus temporarily degraded");
    expect(result.warnings).toContain("using cached board discovery");
    expect(result.warnings).toContain("rate limited upstream");
  });
});
