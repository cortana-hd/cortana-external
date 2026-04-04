import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TradingOpsDashboard } from "@/components/trading-ops-dashboard";
import type { TradingOpsDashboardData } from "@/lib/trading-ops";

const fixture: TradingOpsDashboardData = {
  generatedAt: "2026-04-03T23:30:00.000Z",
  repoPath: "/Users/hd/Developer/cortana-external/backtester",
  market: {
    state: "degraded",
    label: "CORRECTION",
    message: "Stay defensive until fresher data is available.",
    updatedAt: "2026-04-03T23:15:25.794002+00:00",
    source: "/tmp/canslim-alert.json",
    warnings: ["cached history"],
    data: {
      posture: "Stand aside",
      reason: "Stay defensive until fresher data is available.",
      regime: "correction",
      regimeStatus: "degraded",
      positionSizingPct: 0,
      focusSymbols: ["OXY", "GEV", "FANG"],
      leaderSource: "leader baskets",
      alertSummary: "Summary: scanned 120 | BUY 0 | WATCH 0 | NO_BUY 0",
      nextAction: "Retry after cooldown",
    },
  },
  runtime: {
    state: "degraded",
    label: "provider_cooldown",
    message: "Wait for cooldown to clear.",
    updatedAt: "2026-04-03T23:25:53.853293+00:00",
    source: "/tmp/runtime_health_snapshot.py",
    warnings: ["provider_cooldown:medium"],
    data: {
      operatorState: "provider_cooldown",
      operatorAction: "Wait for cooldown to clear.",
      preOpenGateStatus: "warn",
      incidents: [{ incidentType: "provider_cooldown", severity: "medium", operatorAction: "Wait." }],
    },
  },
  canary: {
    state: "degraded",
    label: "warn",
    message: "1 checks need attention.",
    updatedAt: "2026-04-03T23:15:22.659140+00:00",
    source: "/tmp/pre-open-canary-latest.json",
    warnings: ["service_ready:provider_cooldown"],
    data: {
      readyForOpen: false,
      result: "warn",
      warningCount: 1,
      checks: [{ name: "service_ready", result: "warn" }],
    },
  },
  prediction: {
    state: "ok",
    label: "Prediction loop",
    message: "449 snapshots, 1838 settled records tracked.",
    updatedAt: "2026-04-03T23:16:04.659512+00:00",
    source: "/tmp/prediction-accuracy-latest.json",
    warnings: [],
    data: {
      snapshotCount: 449,
      recordCount: 1838,
      oneDayMatured: 880,
      oneDayPending: 337,
      bestStrategyLabel: "dip_buyer WATCH",
      decisionGradeHeadline: "good:10 · mixed:5",
    },
  },
  benchmark: {
    state: "ok",
    label: "Benchmark comparisons",
    message: "Primary horizon 5d.",
    updatedAt: "2026-04-03T23:16:04.695355+00:00",
    source: "/tmp/benchmark-comparison-latest.json",
    warnings: [],
    data: {
      horizonKey: "5d",
      maturedCount: 7,
      bestComparisonLabel: "canslim vs baseline",
    },
  },
  lifecycle: {
    state: "ok",
    label: "Paper lifecycle",
    message: "1 open, 2 closed.",
    updatedAt: "2026-04-03T22:20:35.951192+00:00",
    source: "/tmp/cycle_summary.json",
    warnings: [],
    data: {
      openCount: 1,
      closedCount: 2,
      totalCapital: 100000,
      availableCapital: 85000,
      grossExposurePct: 15,
    },
  },
  workflow: {
    state: "degraded",
    label: "20260403-231522",
    message: "Failed stages: dipbuyer_alert",
    updatedAt: "2026-04-03T23:16:03Z",
    source: "/tmp/local-workflows/20260403-231522",
    warnings: ["dipbuyer_alert"],
    data: {
      runId: "20260403-231522",
      stageCounts: { ok: 2, error: 1 },
      failedStages: ["dipbuyer_alert"],
      stageRows: [
        { name: "market_regime", status: "ok", startedAt: "2026-04-03T23:15:22Z", endedAt: "2026-04-03T23:15:25Z" },
        { name: "dipbuyer_alert", status: "error", startedAt: "2026-04-03T23:15:29Z", endedAt: "2026-04-03T23:16:03Z" },
      ],
      artifactRows: [{ name: "canslim-alert-json", kind: "strategy_alert", location: "/tmp/canslim-alert.json" }],
      canslimSummary: "Summary: scanned 120 | BUY 0 | WATCH 0 | NO_BUY 0",
    },
  },
  opsHighway: {
    state: "ok",
    label: "Ops highway",
    message: "2 critical assets tracked for recovery.",
    updatedAt: "2026-04-03T23:26:00.000000+00:00",
    source: "/tmp/ops_highway_snapshot.py",
    warnings: [],
    data: {
      criticalAssetCount: 2,
      doNotCommitCount: 1,
      firstRecoveryStep: "Restore repo config.",
    },
  },
  tradingRun: {
    state: "ok",
    label: "20260403-163103",
    message: "Latest trading run finished with WATCH and 36 watch names.",
    updatedAt: "2026-04-03T16:38:59.979Z",
    source: "/Users/hd/Developer/cortana/var/backtests/runs/20260403-163103",
    warnings: [],
    data: {
      runId: "20260403-163103",
      decision: "WATCH",
      focusTicker: "ABBV",
      focusAction: "WATCH",
      focusStrategy: "Dip Buyer",
      watchCount: 36,
      buyCount: 0,
      noBuyCount: 12,
      dipBuyerWatch: ["ABBV", "ACHV", "AEP", "AEE", "ADM", "AES"],
      dipBuyerBuy: [],
      dipBuyerNoBuy: ["AAPL", "AMD"],
      canslimWatch: [],
      canslimBuy: [],
      canslimNoBuy: ["MSFT"],
      messagePreview: "📈 Trading Advisor — Market Snapshot\n🎯 Decision: WATCH",
    },
  },
};

describe("TradingOpsDashboard", () => {
  it("renders the operator overview and key sections", () => {
    const { container } = render(<TradingOpsDashboard data={fixture} />);

    expect(screen.getByText("Backtester operator console")).toBeInTheDocument();
    expect(screen.getByText("What to read first")).toBeInTheDocument();
    expect(screen.getByText("Quick answer")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Watchlists" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "System Health" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Deep Dive" })).toBeInTheDocument();
    expect(screen.getByText("Market posture")).toBeInTheDocument();
    expect(screen.getAllByText("Latest trading run").length).toBeGreaterThan(0);
    expect(screen.getByText("ABBV · WATCH")).toBeInTheDocument();
    expect(screen.getAllByText("OXY, GEV, FANG").length).toBeGreaterThan(0);
    expect(screen.getByText(/Dip Buyer currently has/i)).toBeInTheDocument();
    expect(container).toHaveTextContent("Failed stages: dipbuyer_alert");

    const watchlistsTab = screen.getByRole("tab", { name: "Watchlists" });
    fireEvent.mouseDown(watchlistsTab);
    fireEvent.click(watchlistsTab);
    expect(container).toHaveTextContent("Latest trading run watchlists");
    expect(container).toHaveTextContent("BUY 0 · WATCH 6 · NO_BUY 2");
    expect(container).toHaveTextContent("ABBV, ACHV, AEP, AEE, ADM, AES");
  });
});
