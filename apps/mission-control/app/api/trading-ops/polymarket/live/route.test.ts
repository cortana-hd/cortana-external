import { describe, expect, it, vi } from "vitest";
import { loadTradingOpsPolymarketLiveData } from "@/lib/trading-ops-polymarket-live";

vi.mock("@/lib/trading-ops-polymarket-live", () => ({
  loadTradingOpsPolymarketLiveData: vi.fn(),
}));

describe("GET /api/trading-ops/polymarket/live", () => {
  it("returns the Polymarket live trading ops payload", async () => {
    vi.mocked(loadTradingOpsPolymarketLiveData).mockResolvedValueOnce({
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

    const { GET } = await import("@/app/api/trading-ops/polymarket/live/route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.streamer.operatorState).toBe("healthy");
    expect(loadTradingOpsPolymarketLiveData).toHaveBeenCalledOnce();
  });
});
