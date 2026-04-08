import { describe, expect, it, vi } from "vitest";
import { loadTradingOpsLiveData } from "@/lib/trading-ops-live";

vi.mock("@/lib/trading-ops-live", () => ({
  loadTradingOpsLiveData: vi.fn(),
}));

describe("GET /api/trading-ops/live", () => {
  it("returns the live trading ops payload", async () => {
    vi.mocked(loadTradingOpsLiveData).mockResolvedValueOnce({
      generatedAt: "2026-04-08T20:00:00.000Z",
      streamer: {
        connected: true,
        operatorState: "healthy",
        lastLoginAt: "2026-04-08T19:55:00.000Z",
        activeEquitySubscriptions: 4,
        activeAcctActivitySubscriptions: 1,
        cooldownSummary: null,
        warnings: [],
      },
      tape: {
        rows: [],
        freshnessMessage: "Quotes are fresh from the Schwab streamer.",
      },
      watchlists: {
        dipBuyer: { buy: [], watch: [] },
        canslim: { buy: [], watch: [] },
      },
      meta: {
        runId: "20260408-193126",
        decision: "WATCH",
        focusTicker: "ABBV",
        isAfterHours: false,
      },
      warnings: [],
    });

    const { GET } = await import("@/app/api/trading-ops/live/route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.streamer.connected).toBe(true);
    expect(loadTradingOpsLiveData).toHaveBeenCalledOnce();
  });
});
