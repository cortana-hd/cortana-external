import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TradingOpsDashboard } from "@/components/trading-ops-dashboard";
import type { TradingOpsDashboardData } from "@/lib/trading-ops";

class MockEventSource {
  static instances: MockEventSource[] = [];

  readonly url: string;
  readonly listeners = new Map<string, Set<(event: MessageEvent) => void>>();
  onerror: ((event: Event) => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(event: string, handler: (event: MessageEvent) => void) {
    const existing = this.listeners.get(event) ?? new Set<(event: MessageEvent) => void>();
    existing.add(handler);
    this.listeners.set(event, existing);
  }

  close() {
    this.closed = true;
  }

  emit(event: string, data: unknown) {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    const payload = { data: JSON.stringify(data) } as MessageEvent;
    for (const handler of handlers) {
      handler(payload);
    }
  }

  fail() {
    this.onerror?.(new Event("error"));
  }

  static reset() {
    MockEventSource.instances = [];
  }
}

const fixture: TradingOpsDashboardData = {
  generatedAt: "2026-04-03T23:30:00.000Z",
  repoPath: "/Users/hd/Developer/cortana-external/backtester",
  cortanaRepoPath: "/Users/hd/Developer/cortana",
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
      isStale: false,
      referenceRunLabel: null,
      referenceDecision: null,
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
      preOpenGateStatus: "Warn",
      preOpenGateDetail: null,
      preOpenGateFreshness: "Last pre-open readiness check ran 10m ago at Apr 3, 7:15 PM ET.",
      cooldownSummary: "Cooldown is active now. Watchdog still sees provider health, quote smoke failing since Apr 3, 7:02 PM ET.",
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
      checkedAt: "2026-04-03T23:15:22.659140+00:00",
      freshness: "Apr 3, 7:15 PM (15m ago)",
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
      runLabel: "Apr 3, 7:16 PM",
      stageCounts: { ok: 2, error: 1 },
      failedStages: ["dipbuyer_alert"],
      stageRows: [
        { name: "market_regime", status: "ok", startedAt: "2026-04-03T23:15:22Z", endedAt: "2026-04-03T23:15:25Z" },
        { name: "dipbuyer_alert", status: "error", startedAt: "2026-04-03T23:15:29Z", endedAt: "2026-04-03T23:16:03Z" },
      ],
      artifactRows: [{ name: "canslim-alert-json", kind: "strategy_alert", location: "/tmp/canslim-alert.json" }],
      canslimSummary: "Summary: scanned 120 | BUY 0 | WATCH 0 | NO_BUY 0",
      isStale: false,
      referenceRunLabel: null,
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
      runLabel: "Apr 3, 12:38 PM",
      status: "success",
      deliveryStatus: "notified",
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
      completedAt: "2026-04-03T16:38:59.979Z",
      notifiedAt: "2026-04-03T16:40:00.000Z",
      correctionMode: false,
      lastError: null,
      sourceType: "artifact",
    },
  },
};

describe("TradingOpsDashboard", () => {
  beforeEach(() => {
    MockEventSource.reset();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {
        // Keep live polling dormant unless a test explicitly resolves it.
      })) as typeof fetch,
    );
    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the terminal header and key sections", () => {
    const { container } = render(<TradingOpsDashboard data={fixture} />);

    expect(screen.getAllByText("Cortana Trading Ops").length).toBeGreaterThan(0);
    expect(screen.getByText("Operator checklist (4 steps)")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Live" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Watchlists" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "System Health" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Deep Dive" })).toBeInTheDocument();
    expect(screen.getAllByText("Market posture").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Latest trading run").length).toBeGreaterThan(0);
    expect(container).toHaveTextContent("Focus ABBV · WATCH");
    expect(screen.getAllByText("OXY, GEV, FANG").length).toBeGreaterThan(0);
    expect(container).toHaveTextContent("Cooldown is active now. Watchdog still sees provider health, quote smoke failing since Apr 3, 7:02 PM ET.");
    expect(container).toHaveTextContent("Apr 3, 12:38 PM");
    expect(container).toHaveTextContent("Apr 3, 12:40 PM");
    expect(container).toHaveTextContent("success");
    expect(container).toHaveTextContent("Direct artifact read");
    expect(container).toHaveTextContent("Internal id 20260403-163103");
    expect(screen.getByText(/Dip Buyer currently has/i)).toBeInTheDocument();
    expect(container).toHaveTextContent("Failed stages: dipbuyer_alert");
    expect(container).toHaveTextContent("Apr 3, 7:16 PM");

    const watchlistsTab = screen.getByRole("tab", { name: "Watchlists" });
    fireEvent.mouseDown(watchlistsTab);
    fireEvent.click(watchlistsTab);
    expect(container).toHaveTextContent("Latest trading run watchlists");
    expect(container).toHaveTextContent("BUY 0 · WATCH 6 · NO_BUY 2");
    expect(container).toHaveTextContent("ABBV");
    expect(container).toHaveTextContent("ACHV");
    expect(container).toHaveTextContent("AEP");
  });

  it("renders compact live summary and live tab data", async () => {
    const { container } = render(<TradingOpsDashboard data={fixture} />);

    expect(MockEventSource.instances[0]?.url).toBe("/api/trading-ops/live/stream");
    await act(async () => {
      MockEventSource.instances[0]?.emit("snapshot", {
        generatedAt: "2026-04-08T20:00:00.000Z",
        streamer: {
          connected: true,
          operatorState: "healthy",
          lastLoginAt: "2026-04-08T19:55:00.000Z",
          activeEquitySubscriptions: 8,
          activeAcctActivitySubscriptions: 1,
          cooldownSummary: null,
          warnings: [],
        },
        tape: {
          freshnessMessage: "Quotes are fresh from the Schwab streamer.",
          rows: [
            liveRow("SPY", "SPY", "SPY", 510.12, 1.25),
            liveRow("QQQ", "QQQ", "QQQ", 441.18, 2.1),
            liveRow("IWM", "IWM", "IWM", 206.45, 1.05),
            liveRow("DOW", "DOW", "DIA", 389.45, 2.55),
            liveRow("NASDAQ", "NASDAQ", "QQQ", 441.18, 2.1),
            liveRow("GLD", "GLD", "GLD", 232.2, -0.33),
          ],
        },
        watchlists: {
          dipBuyer: {
            buy: [liveRow("ABBV", "ABBV", "ABBV", 179.1, 0.42)],
            watch: [liveRow("ACHV", "ACHV", "ACHV", 6.18, 4.5), liveRow("ADM", "ADM", "ADM", 63.77, 0.65)],
          },
          canslim: {
            buy: [liveRow("NVDA", "NVDA", "NVDA", 122.5, 3.22)],
            watch: [liveRow("MSFT", "MSFT", "MSFT", 427.9, 1.98)],
          },
        },
      meta: {
        runId: "20260403-163103",
        runLabel: "Apr 3, 12:38 PM",
        decision: "WATCH",
        focusTicker: "ABBV",
        isAfterHours: false,
        },
        warnings: [],
      });
    });

    await waitFor(() => {
      expect(container).toHaveTextContent("Streamer connected");
      expect(container).toHaveTextContent("DOW");
      expect(container).toHaveTextContent("NASDAQ");
      expect(container).toHaveTextContent("Apr 3, 12:38 PM");
    });

    const liveTab = screen.getByRole("tab", { name: "Live" });
    fireEvent.mouseDown(liveTab);
    fireEvent.click(liveTab);

    await waitFor(() => {
      expect(container).toHaveTextContent("Live tape");
      expect(container).toHaveTextContent("Dip Buyer live watchlist");
      expect(container).toHaveTextContent("CANSLIM live watchlist");
      expect(container).toHaveTextContent("NVDA");
      expect(container).toHaveTextContent("MSFT");
    });
  });

  it("falls back cleanly when the live stream errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(
        JSON.stringify({
          generatedAt: "2026-04-08T20:01:00.000Z",
          streamer: {
            connected: false,
            operatorState: "reconnecting",
            lastLoginAt: "2026-04-08T19:55:00.000Z",
            activeEquitySubscriptions: 0,
            activeAcctActivitySubscriptions: 0,
            cooldownSummary: "REST cooldown is active.",
            warnings: ["streamer:reconnecting"],
          },
          tape: {
            freshnessMessage: "Using REST fallback while streamer reconnects.",
            rows: [
              { ...liveRow("SPY", "SPY", "SPY", 510.12, 1.25), source: "schwab", state: "ok" },
            ],
          },
          watchlists: {
            dipBuyer: { buy: [], watch: [] },
            canslim: { buy: [], watch: [] },
          },
          meta: {
            runId: "20260403-163103",
            runLabel: "Apr 3, 12:38 PM",
            decision: "WATCH",
            focusTicker: "ABBV",
            isAfterHours: false,
          },
          warnings: [],
        }),
      )) as typeof fetch);

    const { container } = render(<TradingOpsDashboard data={fixture} />);
    await act(async () => {
      MockEventSource.instances[0]?.fail();
    });

    await waitFor(() => {
      expect(container).toHaveTextContent("REST fallback");
      expect(container).toHaveTextContent("Using REST fallback while streamer reconnects.");
    });
  });

  it("renders alert banner when incidents exist", () => {
    render(<TradingOpsDashboard data={fixture} />);
    expect(screen.getByText(/provider_cooldown: Wait\./)).toBeInTheDocument();
  });

  it("renders alert banner when latest trading run is in explicit fallback", () => {
    const fallbackFixture: TradingOpsDashboardData = {
      ...fixture,
      runtime: {
        ...fixture.runtime,
        state: "ok",
        message: "No operator action required.",
        warnings: [],
        data: fixture.runtime.data
          ? {
              ...fixture.runtime.data,
              incidents: [],
              operatorState: "healthy",
              operatorAction: "No operator action required.",
            }
          : fixture.runtime.data,
      },
      tradingRun: {
        ...fixture.tradingRun,
        state: "degraded",
        badgeText: "fallback",
        message: "Using file fallback because DB-backed trading run state is unavailable.",
      },
    };

    render(<TradingOpsDashboard data={fallbackFixture} />);
    expect(screen.getByText(/trading_run_state_fallback:/)).toBeInTheDocument();
  });

  it("renders terminal header metrics", () => {
    const { container } = render(<TradingOpsDashboard data={fixture} />);
    expect(container).toHaveTextContent("CORRECTION");
    expect(container).toHaveTextContent("0.0%");
    expect(container).toHaveTextContent("15.0%");
    expect(container).toHaveTextContent("1 open / 2 closed");
  });

  it("renders runtime readiness-check missing language and stale badge text", () => {
    const staleFixture: TradingOpsDashboardData = {
      ...fixture,
      market: {
        ...fixture.market,
        badgeText: "stale",
        data: fixture.market.data
          ? {
              ...fixture.market.data,
              isStale: true,
              focusSymbols: [],
              referenceRunLabel: "Apr 7, 12:10 PM",
            }
          : fixture.market.data,
      },
      runtime: {
        ...fixture.runtime,
        data: fixture.runtime.data
          ? {
              ...fixture.runtime.data,
              preOpenGateStatus: "Readiness check unavailable",
              preOpenGateDetail: "Pre-open readiness check artifact is missing at /tmp/pre-open-canary-latest.json.",
              preOpenGateFreshness: "Pre-open readiness check artifact is missing at /tmp/pre-open-canary-latest.json.",
              cooldownSummary: null,
              incidents: [],
              operatorState: "healthy",
              operatorAction: "No operator action required.",
            }
          : fixture.runtime.data,
        state: "ok",
        warnings: [],
        message: "No operator action required.",
      },
      tradingRun: {
        ...fixture.tradingRun,
        badgeText: "fallback",
        state: "degraded",
        data: fixture.tradingRun.data
          ? {
              ...fixture.tradingRun.data,
              sourceType: "file_fallback",
            }
          : fixture.tradingRun.data,
      },
    };

    const { container } = render(<TradingOpsDashboard data={staleFixture} />);
    expect(container).toHaveTextContent("stale");
    expect(container).toHaveTextContent("Readiness check unavailable");
    expect(container).toHaveTextContent("Pre-open readiness check artifact is missing at /tmp/pre-open-canary-latest.json.");
    expect(container).toHaveTextContent("Pre-open readiness check");
    expect(container).toHaveTextContent("No operator action required.");
    expect(container).toHaveTextContent("File artifact fallback");
  });
});

function liveRow(symbol: string, label: string, sourceSymbol: string, price: number, changePercent: number) {
  return {
    symbol,
    label,
    sourceSymbol,
    price,
    changePercent,
    source: "schwab_streamer",
    timestamp: "2026-04-08T20:00:00.000Z",
    state: "ok",
    warning: null,
  };
}
