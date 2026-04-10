import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { loadTradingOpsPolymarketLiveData } from "@/lib/trading-ops-polymarket-live";

describe("loadTradingOpsPolymarketLiveData", () => {
  it("keeps top events and top sports at five visible rows each while pinned markets stay separate", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pm-live-loader-"));
    const reportDir = path.join(repoRoot, "var", "market-intel", "polymarket");
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(
      path.join(reportDir, "latest-report.json"),
      JSON.stringify({
        topMarkets: [
          { slug: "fallback-event-1", displayTitle: "Fallback Event 1", title: "Fallback Event 1" },
          { slug: "fallback-event-2", displayTitle: "Fallback Event 2", title: "Fallback Event 2" },
        ],
      }),
    );

    const eventRows = Array.from({ length: 6 }, (_, index) => ({
      marketSlug: `event-${index + 1}`,
      marketTitle: `Event ${index + 1}`,
      eventTitle: `Event Board ${index + 1}`,
      league: null,
    }));
    const sportsRows = Array.from({ length: 6 }, (_, index) => ({
      marketSlug: `sport-${index + 1}`,
      marketTitle: `Sport ${index + 1}`,
      eventTitle: `Sport Board ${index + 1}`,
      league: "sports",
    }));
    const pinnedRows = [
      {
        marketSlug: "event-1",
        bucket: "events",
        title: "Event 1",
        eventTitle: "Event Board 1",
        league: null,
        pinnedAt: "2026-04-10T11:00:00.000Z",
      },
      {
        marketSlug: "sport-1",
        bucket: "sports",
        title: "Sport 1",
        eventTitle: "Sport Board 1",
        league: "sports",
        pinnedAt: "2026-04-10T11:01:00.000Z",
      },
    ];

    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/polymarket/focus?limit=20")) {
        return new Response(
          JSON.stringify({
            pinned: pinnedRows,
            events: eventRows,
            sports: sportsRows,
          }),
          { status: 200 },
        );
      }

      if (url.includes("/polymarket/live?slugs=")) {
        const slugsParam = new URL(url).searchParams.get("slugs") ?? "";
        const slugs = slugsParam.split(",").filter(Boolean);
        return new Response(
          JSON.stringify({
            streamer: {
              marketsConnected: true,
              privateConnected: true,
              operatorState: "healthy",
              trackedMarketCount: slugs.length,
              trackedMarketSlugs: slugs,
              lastMarketMessageAt: "2026-04-10T11:05:00.000Z",
              lastPrivateMessageAt: "2026-04-10T11:05:00.000Z",
              lastError: null,
            },
            account: {
              balance: 0,
              buyingPower: 0,
              openOrdersCount: 0,
              positionCount: 0,
              lastBalanceUpdateAt: "2026-04-10T11:05:00.000Z",
              lastOrdersUpdateAt: "2026-04-10T11:05:00.000Z",
              lastPositionsUpdateAt: "2026-04-10T11:05:00.000Z",
            },
            markets: slugs.map((slug) => ({
              marketSlug: slug,
              bestBid: 0.4,
              bestAsk: 0.5,
              lastTrade: 0.45,
              spread: 0.1,
              marketState: "MARKET_STATE_OPEN",
              sharesTraded: 1000,
              openInterest: 2000,
              tradePrice: 0.45,
              tradeQuantity: 10,
              tradeTime: "2026-04-10T11:05:00.000Z",
              updatedAt: "2026-04-10T11:05:00.000Z",
            })),
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

    const pinned = result.markets.filter((market) => market.pinned);
    const visibleEvents = result.markets.filter((market) => market.bucket === "events" && !market.pinned);
    const visibleSports = result.markets.filter((market) => market.bucket === "sports" && !market.pinned);

    expect(pinned).toHaveLength(2);
    expect(visibleEvents).toHaveLength(5);
    expect(visibleSports).toHaveLength(5);
    expect(visibleEvents.map((market) => market.slug)).not.toContain("event-1");
    expect(visibleSports.map((market) => market.slug)).not.toContain("sport-1");
    expect(visibleEvents.map((market) => market.slug)).toContain("event-6");
    expect(visibleSports.map((market) => market.slug)).toContain("sport-6");
  });
});
