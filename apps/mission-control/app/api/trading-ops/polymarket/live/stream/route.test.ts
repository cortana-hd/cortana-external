import { describe, expect, it, vi } from "vitest";
import { loadTradingOpsPolymarketLiveData } from "@/lib/trading-ops-polymarket-live";

vi.mock("@/lib/trading-ops-polymarket-live", () => ({
  loadTradingOpsPolymarketLiveData: vi.fn(),
}));

describe("GET /api/trading-ops/polymarket/live/stream", () => {
  it("streams live Polymarket snapshots over SSE", async () => {
    vi.mocked(loadTradingOpsPolymarketLiveData).mockResolvedValue({
      generatedAt: "2026-04-09T20:00:02.000Z",
      streamer: {
        marketsConnected: true,
        privateConnected: true,
        operatorState: "healthy",
        trackedMarketCount: 1,
        trackedMarketSlugs: ["rdc-usfed-fomc-2026-04-29-cut25bps"],
        lastMarketMessageAt: "2026-04-09T20:00:01.000Z",
        lastPrivateMessageAt: "2026-04-09T20:00:01.500Z",
        lastError: null,
      },
      account: {
        balance: 0,
        buyingPower: 0,
        openOrdersCount: 0,
        positionCount: 0,
        lastBalanceUpdateAt: "2026-04-09T20:00:01.500Z",
        lastOrdersUpdateAt: null,
        lastPositionsUpdateAt: null,
      },
      markets: [],
      warnings: [],
    });

    const controller = new AbortController();
    const request = new Request("http://localhost:3000/api/trading-ops/polymarket/live/stream", {
      signal: controller.signal,
    });

    const { GET } = await import("@/app/api/trading-ops/polymarket/live/stream/route");
    const response = await GET(request);
    const reader = response.body?.getReader();
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(reader).toBeTruthy();

    const firstChunk = await reader!.read();
    controller.abort();

    expect(firstChunk.done).toBe(false);
    expect(new TextDecoder().decode(firstChunk.value)).toContain("event: ready");
  });
});
