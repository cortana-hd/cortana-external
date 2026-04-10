import { describe, expect, it, vi } from "vitest";

import { PolymarketClient } from "../polymarket-client.js";

describe("polymarket client", () => {
  it("retries transient failures before succeeding", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: "1", slug: "test-market" }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    const client = new PolymarketClient({
      fetchImpl,
      retries: 1,
      timeoutMs: 1000,
    });

    const result = await client["request"]("/markets", { slug: "test-market" });

    expect(result).toEqual([{ id: "1", slug: "test-market" }]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("paginates active events for keyword fallback discovery", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(rawUrl);
      const offset = Number(url.searchParams.get("offset") ?? "0");

      if (offset === 0) {
        return new Response(
          JSON.stringify(Array.from({ length: 200 }, (_, index) => ({
            id: `evt-${index}`,
            slug: `evt-${index}`,
            title: `Noise event ${index}`,
            markets: [],
          }))),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify([
          {
            id: "evt-match",
            slug: "evt-match",
            title: "Inflation event",
            markets: [
              {
                id: "mkt-match",
                slug: "inflation-upside-live",
                question: "Will inflation reaccelerate in 2026?",
              },
            ],
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const client = new PolymarketClient({ fetchImpl, retries: 0, timeoutMs: 1000 });
    const result = await client.fetchByKeywords({
      id: "inflation",
      title: "Inflation",
      category: "macro",
      theme: "inflation",
      equityRelevance: "high",
      sectorTags: [],
      watchTickers: [],
      confidenceWeight: 1,
      minLiquidity: 1,
      active: true,
      impactModel: "inflation_upside",
      selectors: {
        marketSlugs: [],
        eventSlugs: [],
        keywords: ["inflation"],
        includeKeywords: ["inflation"],
      },
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.market.slug).toBe("inflation-upside-live");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("supports US public API envelopes without dropping the /v1 path prefix", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(rawUrl);

      if (url.pathname === "/v1/markets") {
        return new Response(
          JSON.stringify({
            markets: [{ id: "mkt-1", slug: "fed-cut-june", question: "Fed cut by June?", active: true, closed: false }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (url.pathname === "/v1/events") {
        return new Response(
          JSON.stringify({
            events: [
              {
                id: "evt-1",
                slug: "fed-event",
                title: "Fed cut by June?",
                markets: [{ id: "mkt-1", slug: "fed-cut-june", question: "Fed cut by June?", active: true, closed: false }],
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      throw new Error(`Unexpected path ${url.pathname}`);
    });

    const client = new PolymarketClient({
      fetchImpl,
      retries: 0,
      timeoutMs: 1000,
    });

    const marketMatches = await client.fetchByMarketSlugs(["fed-cut-june"]);
    const eventMatches = await client.fetchByEventSlugs(["fed-event"]);

    expect(marketMatches[0]?.market.slug).toBe("fed-cut-june");
    expect(eventMatches[0]?.event?.slug).toBe("fed-event");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
