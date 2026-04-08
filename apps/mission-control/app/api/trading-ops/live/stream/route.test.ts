import { describe, expect, it, vi } from "vitest";
import { loadTradingOpsLiveData } from "@/lib/trading-ops-live";

vi.mock("@/lib/trading-ops-live", () => ({
  loadTradingOpsLiveData: vi.fn(),
}));

describe("GET /api/trading-ops/live/stream", () => {
  it("streams live trading ops snapshots over SSE", async () => {
    vi.mocked(loadTradingOpsLiveData).mockResolvedValue({
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

    const controller = new AbortController();
    const request = new Request("http://localhost:3000/api/trading-ops/live/stream", {
      signal: controller.signal,
    });

    const { GET } = await import("@/app/api/trading-ops/live/stream/route");
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
