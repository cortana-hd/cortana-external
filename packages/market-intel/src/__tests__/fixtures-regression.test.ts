import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildPolymarketIntelReport } from "../service.js";

const fixturePath = path.join(
  import.meta.dirname,
  "../__fixtures__/live-events-sample.json",
);
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("fixture regression", () => {
  it("produces stable top-market semantics from saved live payloads", async () => {
    const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as unknown;
    const dir = await mkdtemp(path.join(os.tmpdir(), "market-intel-fixture-regression-"));
    tempDirs.push(dir);
    const registryPath = path.join(dir, "registry.json");

    await writeFile(
      registryPath,
      JSON.stringify({
        schemaVersion: 1,
        updatedAt: "2026-04-09T00:00:00Z",
        entries: [
          {
            id: "fed-easing",
            title: "Fed easing odds",
            category: "macro-rates",
            theme: "rates",
            equityRelevance: "high",
            sectorTags: ["tech", "growth"],
            watchTickers: ["QQQ", "NVDA"],
            confidenceWeight: 0.92,
            minLiquidity: 250000,
            active: true,
            impactModel: "fed_easing",
            probabilityMode: "invert",
            selectors: {
              marketSlugs: [],
              eventSlugs: [],
              keywords: ["fed cut", "fomc"],
            },
          },
          {
            id: "recession-risk",
            title: "US recession odds",
            category: "macro-growth",
            theme: "recession",
            equityRelevance: "high",
            sectorTags: ["defensive"],
            watchTickers: ["XLU", "IWM"],
            confidenceWeight: 0.9,
            minLiquidity: 150000,
            active: true,
            impactModel: "recession_risk",
            selectors: {
              marketSlugs: [],
              eventSlugs: [],
              keywords: ["recession"],
            },
          },
          {
            id: "geopolitical-escalation",
            title: "Geopolitical escalation risk",
            category: "geopolitics",
            theme: "geopolitics",
            equityRelevance: "medium",
            sectorTags: ["energy"],
            watchTickers: ["XOM", "CVX"],
            confidenceWeight: 0.82,
            minLiquidity: 100000,
            active: true,
            impactModel: "geopolitical_escalation",
            selectors: {
              marketSlugs: [],
              eventSlugs: [],
              keywords: ["taiwan"],
            },
          },
        ],
      }),
      "utf8",
    );

    const fetchImpl: typeof fetch = async (input) => {
      const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(rawUrl);
      if (url.pathname.endsWith("/events")) {
        return new Response(JSON.stringify(fixture), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (url.pathname.endsWith("/markets")) {
        const slug = url.searchParams.get("slug");
        const events = fixture as Array<{ markets?: Array<{ slug?: string }> }>;
        const market = events.flatMap((event) => event.markets ?? []).find((item) => item.slug === slug);
        return new Response(JSON.stringify(market ? [market] : []), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      throw new Error(`Unexpected path ${url.pathname}`);
    };

    const report = await buildPolymarketIntelReport({
      registryPath,
      fetchImpl,
      maxMarkets: 4,
      now: new Date("2026-03-14T01:20:00.000Z"),
    });

    expect(report.topMarkets.map((market) => market.displayTitle)).toEqual(
      expect.arrayContaining([
        "Fed easing odds",
        "US recession odds",
        "Geopolitical escalation risk",
      ]),
    );
    const fed = report.topMarkets.find((market) => market.registryEntryId === "fed-easing");
    expect(fed?.probability).toBe(0.765);
  });
});
