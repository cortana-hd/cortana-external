import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { loadTradingOpsPolymarketData } from "@/lib/trading-ops-polymarket";

describe("loadTradingOpsPolymarketData", () => {
  it("keeps startup reconnect payloads neutral until the first live snapshot arrives", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pm-loader-neutral-"));

    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/polymarket/board/live")) {
        return new Response(
          JSON.stringify({
            streamer: {
              marketsConnected: false,
              privateConnected: false,
              operatorState: "reconnecting",
              trackedMarketCount: 0,
              trackedMarketSlugs: [],
              lastMarketMessageAt: null,
              lastPrivateMessageAt: null,
              lastError: "This operation was aborted",
            },
            account: {},
            roster: {
              candidateEventsCount: 0,
              candidateSportsCount: 0,
            },
            markets: [],
            warnings: ["stream not ready"],
          }),
          { status: 200 },
        );
      }

      if (url.endsWith("/polymarket/results")) {
        throw new Error("This operation was aborted");
      }

      throw new Error(`Unexpected URL: ${url}`);
    };

    const result = await loadTradingOpsPolymarketData({
      repoRoot,
      baseUrl: "http://127.0.0.1:3033",
      fetchImpl,
    });

    expect(result.account.state).toBe("missing");
    expect(result.account.badgeText).toBe("loading");
    expect(result.account.message).toContain("Waiting for the first Polymarket account snapshot.");
    expect(result.signal.state).toBe("missing");
    expect(result.signal.badgeText).toBe("loading");
    expect(result.watchlist.state).toBe("missing");
    expect(result.watchlist.badgeText).toBe("loading");
    expect(result.results.state).toBe("missing");
    expect(result.results.badgeText).toBe("loading");
    expect(result.results.warnings).toEqual([]);
  });

  it("still surfaces non-startup live failures after warmup semantics are excluded", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pm-loader-error-"));

    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/polymarket/board/live")) {
        return new Response(
          JSON.stringify({
            error: "focus temporarily degraded",
            streamer: {
              marketsConnected: false,
              privateConnected: false,
              operatorState: "degraded",
              trackedMarketCount: 0,
              trackedMarketSlugs: [],
              lastMarketMessageAt: "2026-04-10T15:01:00.000Z",
              lastPrivateMessageAt: null,
              lastError: "focus temporarily degraded",
            },
            account: {},
            roster: {
              candidateEventsCount: 0,
              candidateSportsCount: 0,
            },
            markets: [],
            warnings: ["focus temporarily degraded"],
          }),
          { status: 503 },
        );
      }

      if (url.endsWith("/polymarket/results")) {
        return new Response(JSON.stringify({ error: "results backend unavailable" }), { status: 503 });
      }

      throw new Error(`Unexpected URL: ${url}`);
    };

    const result = await loadTradingOpsPolymarketData({
      repoRoot,
      baseUrl: "http://127.0.0.1:3033",
      fetchImpl,
    });

    expect(result.account.state).toBe("error");
    expect(result.signal.state).toBe("missing");
    expect(result.results.state).toBe("degraded");
    expect(result.results.warnings).toContain("HTTP 503: results backend unavailable");
  });
});
