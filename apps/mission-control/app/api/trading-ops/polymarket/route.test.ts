import { describe, expect, it, vi } from "vitest";
import { loadTradingOpsPolymarketData } from "@/lib/trading-ops-polymarket";

vi.mock("@/lib/trading-ops-polymarket", () => ({
  loadTradingOpsPolymarketData: vi.fn(),
}));

describe("GET /api/trading-ops/polymarket", () => {
  it("returns the Polymarket trading ops payload", async () => {
    vi.mocked(loadTradingOpsPolymarketData).mockResolvedValueOnce({
      generatedAt: "2026-04-09T20:00:00.000Z",
      account: {
        state: "ok",
        label: "healthy",
        message: "Authenticated account is reachable with 0 balances, 0 positions, 0 open orders.",
        updatedAt: "2026-04-09T20:00:00.000Z",
        source: "http://127.0.0.1:3033/polymarket/health",
        warnings: [],
        badgeText: "...106dac",
        data: {
          status: "healthy",
          keyIdSuffix: "106dac",
          balanceCount: 0,
          positionCount: 0,
          openOrdersCount: 0,
          balances: [],
        },
      },
      signal: {
        state: "ok",
        label: "Signal artifact ready",
        message: "Risk-off confirmation",
        updatedAt: "2026-04-09T12:31:55.267Z",
        source: "/tmp/latest-report.json",
        warnings: [],
        badgeText: "confirms",
        data: {
          generatedAt: "2026-04-09T12:31:55.267Z",
          compactLines: ["Polymarket: Fed easing odds 67%"],
          alignment: "confirms",
          overlaySummary: "Risk-off confirmation",
          overlayDetail: "Polymarket risk-off signals align with the base regime.",
          conviction: "supportive",
          aggressionDial: "lean_more_selective",
          divergenceSummary: "No major divergence",
          topMarkets: [],
        },
      },
      watchlist: {
        state: "ok",
        label: "Watchlist ready",
        message: "Linked watchlist has 6 symbols across stocks, funds.",
        updatedAt: "2026-04-09T12:31:55.267Z",
        source: "/tmp/latest-watchlist.json",
        warnings: [],
        data: {
          updatedAt: "2026-04-09T12:31:55.267Z",
          totalCount: 6,
          buckets: {
            stocks: ["AMD", "MSFT", "NVDA"],
            funds: ["QQQ"],
            crypto: [],
            cryptoProxies: [],
          },
          symbols: [],
        },
      },
      results: {
        state: "ok",
        label: "Pinned results waiting",
        message: "Pinned markets will appear here after settlement.",
        updatedAt: "2026-04-09T12:31:55.267Z",
        source: "http://127.0.0.1:3033/polymarket/results",
        warnings: [],
        data: {
          updatedAt: "2026-04-09T12:31:55.267Z",
          settledCount: 0,
          tradedCount: 0,
          openPositionCount: 0,
          rows: [],
        },
      },
    });

    const { GET } = await import("@/app/api/trading-ops/polymarket/route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.account.data.keyIdSuffix).toBe("106dac");
    expect(body.signal.data.alignment).toBe("confirms");
    expect(loadTradingOpsPolymarketData).toHaveBeenCalledOnce();
  });
});
