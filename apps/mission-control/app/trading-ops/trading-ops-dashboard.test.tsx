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

const financialServicesFixture: TradingOpsDashboardData["financialServices"] = {
  state: "ok",
  label: "Financial services health",
  message: "7 services healthy.",
  updatedAt: "2026-04-03T23:28:00.000Z",
  source: "http://127.0.0.1:3033/market-data/ops · http://127.0.0.1:3033/alpaca/health · http://127.0.0.1:3033/polymarket/health · http://127.0.0.1:3033/polymarket/live",
  warnings: [],
  badgeText: "7/7",
  data: {
    rows: [
      {
        label: "Alpaca",
        state: "ok",
        summary: "healthy",
        detail: "Broker health and account reachability are reported by Alpaca.",
        source: "/alpaca/health",
        updatedAt: "2026-04-03T23:28:00.000Z",
        badgeText: "healthy",
      },
      {
        label: "FRED",
        state: "ok",
        summary: "configured",
        detail: "Market-data ops sees FRED configured for economic data lookups.",
        source: "/market-data/ops",
        updatedAt: "2026-04-03T23:28:00.000Z",
        badgeText: "configured",
      },
      {
        label: "CoinMarketCap",
        state: "ok",
        summary: "configured",
        detail: "Market-data ops sees CoinMarketCap configured for crypto coverage.",
        source: "/market-data/ops",
        updatedAt: "2026-04-03T23:28:00.000Z",
        badgeText: "configured",
      },
      {
        label: "Schwab REST",
        state: "ok",
        summary: "healthy",
        detail: "Last successful REST quote at Apr 3, 7:27 PM.",
        source: "/market-data/ops",
        updatedAt: "2026-04-03T23:28:00.000Z",
        badgeText: "rest",
      },
      {
        label: "Schwab streamer",
        state: "ok",
        summary: "connected",
        detail: "55 equity subs · 0 acct activity.",
        source: "/market-data/ops",
        updatedAt: "2026-04-03T23:28:00.000Z",
        badgeText: "stream",
      },
      {
        label: "Polymarket REST",
        state: "ok",
        summary: "healthy",
        detail: "API https://api.polymarket.us is reachable.",
        source: "/polymarket/health",
        updatedAt: "2026-04-03T23:28:00.000Z",
        badgeText: "rest",
      },
      {
        label: "Polymarket streamer",
        state: "ok",
        summary: "connected",
        detail: "106 tracked markets · last market msg Apr 3, 7:27 PM.",
        source: "/polymarket/live",
        updatedAt: "2026-04-03T23:28:00.000Z",
        badgeText: "stream",
      },
    ],
    healthyCount: 7,
    degradedCount: 0,
    errorCount: 0,
    checkedAt: "2026-04-03T23:28:00.000Z",
  },
};

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
    label: "Trade lifecycle",
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
  financialServices: financialServicesFixture,
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

function findEventSource(url: string) {
  return MockEventSource.instances.find((instance) => instance.url === url);
}

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
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renders the terminal header and key sections", () => {
    const { container } = render(<TradingOpsDashboard data={fixture} />);

    expect(screen.getAllByText("Cortana Trading Ops").length).toBeGreaterThan(0);
    expect(screen.getByText("Operator checklist (4 steps)")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Live" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Watchlists" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Polymarket" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "System Health" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Deep Dive" })).toBeInTheDocument();
    expect(screen.getAllByText("Market posture").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Latest trading run").length).toBeGreaterThan(0);
    expect(screen.getByText("Polymarket status")).toBeInTheDocument();
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

    const systemHealthTab = screen.getByRole("tab", { name: "System Health" });
    fireEvent.mouseDown(systemHealthTab);
    fireEvent.click(systemHealthTab);
    expect(screen.getByText("Financial services health")).toBeInTheDocument();
    expect(container).toHaveTextContent("Schwab REST");
    expect(container).toHaveTextContent("Polymarket streamer");
    expect(container).toHaveTextContent("Schwab streamer");

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

    expect(findEventSource("/api/trading-ops/live/stream")).toBeDefined();
    await act(async () => {
      findEventSource("/api/trading-ops/live/stream")?.emit("snapshot", {
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

  it("renders the Polymarket overview card and tab content", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/trading-ops/polymarket") {
        return new Response(
          JSON.stringify({
            generatedAt: "2026-04-09T20:00:00.000Z",
            account: {
              state: "ok",
              label: "healthy",
              message: "Authenticated account is reachable with 0 balances, 0 positions, 0 open orders.",
              updatedAt: "2026-04-09T20:00:00.000Z",
              source: "/api/trading-ops/polymarket",
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
                compactLines: [
                  "Polymarket: Fed easing odds 67% (0 pts/24h); Inflation upside risk 56% (+15 pts/24h); US recession odds 30% (-4 pts/24h)",
                ],
                alignment: "confirms",
                overlaySummary: "Risk-off confirmation",
                overlayDetail: "Polymarket risk-off signals align with a weak or degraded market regime.",
                conviction: "supportive",
                aggressionDial: "lean_more_selective",
                divergenceSummary: "No major divergence",
                topMarkets: [
                  {
                    slug: "rdc-usfed-fomc-2026-04-29-cut25bps",
                    title: "Fed easing odds",
                    theme: "rates",
                    probability: 0.673,
                    change24h: -0.001,
                    severity: "major",
                    persistence: "one_off",
                    regimeEffect: "mixed",
                    watchTickers: ["QQQ", "NVDA", "AMD", "MSFT"],
                    qualityTier: "medium",
                  },
                ],
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
                  stocks: ["AMD", "MSFT", "NVDA", "CVX"],
                  funds: ["QQQ", "XLE"],
                  crypto: [],
                  cryptoProxies: [],
                },
                symbols: [
                  {
                    symbol: "AMD",
                    assetClass: "stock",
                    themes: ["rates"],
                    sourceTitles: ["Fed easing odds"],
                    severity: "major",
                    persistence: "one_off",
                    probability: 0.673,
                    score: 0.7116,
                  },
                  {
                    symbol: "MSFT",
                    assetClass: "stock",
                    themes: ["rates"],
                    sourceTitles: ["Fed easing odds"],
                    severity: "major",
                    persistence: "one_off",
                    probability: 0.673,
                    score: 0.7116,
                  },
                ],
              },
            },
            results: {
              state: "ok",
              label: "Pinned results waiting",
              message: "Pinned markets will appear here after settlement.",
              updatedAt: "2026-04-09T12:31:55.267Z",
              source: "/api/trading-ops/polymarket/results",
              warnings: [],
              data: {
                updatedAt: "2026-04-09T12:31:55.267Z",
                settledCount: 0,
                tradedCount: 0,
                openPositionCount: 0,
                rows: [],
              },
            },
          }),
        );
      }

      return new Promise<Response>(() => {
        // Keep the unrelated live snapshot fetches dormant; this test only exercises Polymarket.
      });
    }) as typeof fetch);

    const { container } = render(<TradingOpsDashboard data={fixture} />);

    await act(async () => {
      findEventSource("/api/trading-ops/polymarket/live/stream")?.emit("snapshot", {
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
        markets: [
          {
            slug: "rdc-usfed-fomc-2026-04-29-cut25bps",
            title: "Fed easing odds",
            bucket: "events",
            pinned: false,
            pinnedAt: null,
            eventTitle: "Fed Decision in April",
            league: null,
            bestBid: 0.41,
            bestAsk: 0.43,
            lastTrade: 0.42,
            spread: 0.02,
            marketState: "MARKET_STATE_OPEN",
            sharesTraded: 1500,
            openInterest: 2100,
            tradePrice: 0.42,
            tradeQuantity: 25,
            tradeTime: "2026-04-09T20:00:01.000Z",
            updatedAt: "2026-04-09T20:00:01.000Z",
            state: "ok",
            warning: null,
          },
        ],
        warnings: [],
      });
    });

    await waitFor(() => {
      expect(container).toHaveTextContent("Risk-off confirmation");
      expect(container).toHaveTextContent("AMD, MSFT");
      expect(container).toHaveTextContent("1 live markets");
    });

    const polymarketTab = screen.getByRole("tab", { name: "Polymarket" });
    fireEvent.mouseDown(polymarketTab);
    fireEvent.click(polymarketTab);

    await waitFor(() => {
      expect(container).toHaveTextContent("Signal overlay");
      expect(container).toHaveTextContent("Linked watchlist");
      expect(container).toHaveTextContent("Live stream");
      expect(container).toHaveTextContent("Fed easing odds");
      expect(container).toHaveTextContent("...106dac");
      expect(container).toHaveTextContent("$0.4100");
      expect(container).not.toHaveTextContent("Schwab market bridge");
    });
  });

  it("highlights roster changes when a new Polymarket board market enters", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/trading-ops/polymarket") {
        return new Response(
          JSON.stringify({
            generatedAt: "2026-04-10T11:45:00.000Z",
            account: {
              state: "ok",
              label: "healthy",
              message: "Authenticated account is reachable with 0 balances, 0 positions, 0 open orders.",
              updatedAt: "2026-04-10T11:45:00.000Z",
              source: "/api/trading-ops/polymarket",
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
              message: "Neutral",
              updatedAt: "2026-04-10T11:45:00.000Z",
              source: "/tmp/latest-report.json",
              warnings: [],
              badgeText: "neutral",
              data: {
                generatedAt: "2026-04-10T11:45:00.000Z",
                compactLines: ["Polymarket: live event board ready"],
                alignment: "neutral",
                overlaySummary: "Neutral",
                overlayDetail: null,
                conviction: "neutral",
                aggressionDial: "steady",
                divergenceSummary: null,
                topMarkets: [],
              },
            },
            watchlist: {
              state: "ok",
              label: "Watchlist ready",
              message: "Linked watchlist has 0 symbols across stocks, funds.",
              updatedAt: "2026-04-10T11:45:00.000Z",
              source: "/tmp/latest-watchlist.json",
              warnings: [],
              data: {
                updatedAt: "2026-04-10T11:45:00.000Z",
                totalCount: 0,
                buckets: {
                  stocks: [],
                  funds: [],
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
              updatedAt: "2026-04-10T11:45:00.000Z",
              source: "/api/trading-ops/polymarket/results",
              warnings: [],
              data: {
                updatedAt: "2026-04-10T11:45:00.000Z",
                settledCount: 0,
                tradedCount: 0,
                openPositionCount: 0,
                rows: [],
              },
            },
          }),
        );
      }

      return new Promise<Response>(() => {
        // Keep unrelated fetches dormant.
      });
    }) as typeof fetch);

    const { container } = render(<TradingOpsDashboard data={fixture} />);

    const polymarketTab = screen.getByRole("tab", { name: "Polymarket" });
    fireEvent.mouseDown(polymarketTab);
    fireEvent.click(polymarketTab);

    await act(async () => {
      findEventSource("/api/trading-ops/polymarket/live/stream")?.emit("snapshot", {
        generatedAt: "2026-04-10T11:45:02.000Z",
        streamer: {
          marketsConnected: true,
          privateConnected: true,
          operatorState: "healthy",
          trackedMarketCount: 1,
          trackedMarketSlugs: ["rdc-usfed-fomc-2026-04-29-cut25bps"],
          lastMarketMessageAt: "2026-04-10T11:45:01.000Z",
          lastPrivateMessageAt: "2026-04-10T11:45:01.500Z",
          lastError: null,
        },
        account: {
          balance: 0,
          buyingPower: 0,
          openOrdersCount: 0,
          positionCount: 0,
          lastBalanceUpdateAt: "2026-04-10T11:45:01.500Z",
          lastOrdersUpdateAt: null,
          lastPositionsUpdateAt: null,
        },
        markets: [
          {
            slug: "rdc-usfed-fomc-2026-04-29-cut25bps",
            title: "Fed easing odds",
            bucket: "events",
            pinned: false,
            pinnedAt: null,
            eventTitle: "Fed Decision in April",
            league: null,
            bestBid: 0.41,
            bestAsk: 0.43,
            lastTrade: 0.42,
            spread: 0.02,
            marketState: "MARKET_STATE_OPEN",
            sharesTraded: 1500,
            openInterest: 2100,
            tradePrice: 0.42,
            tradeQuantity: 25,
            tradeTime: "2026-04-10T11:45:01.000Z",
            updatedAt: "2026-04-10T11:45:01.000Z",
            state: "ok",
            warning: null,
          },
        ],
        warnings: [],
      });
    });

    await waitFor(() => {
      expect(container).toHaveTextContent("Fed easing odds");
    });

    await act(async () => {
      findEventSource("/api/trading-ops/polymarket/live/stream")?.emit("snapshot", {
        generatedAt: "2026-04-10T11:46:02.000Z",
        streamer: {
          marketsConnected: true,
          privateConnected: true,
          operatorState: "healthy",
          trackedMarketCount: 1,
          trackedMarketSlugs: ["cpic-uscpi-apr2026yoy-2026-05-12-3pt9pct"],
          lastMarketMessageAt: "2026-04-10T11:46:01.000Z",
          lastPrivateMessageAt: "2026-04-10T11:46:01.500Z",
          lastError: null,
        },
        account: {
          balance: 0,
          buyingPower: 0,
          openOrdersCount: 0,
          positionCount: 0,
          lastBalanceUpdateAt: "2026-04-10T11:46:01.500Z",
          lastOrdersUpdateAt: null,
          lastPositionsUpdateAt: null,
        },
        markets: [
          {
            slug: "cpic-uscpi-apr2026yoy-2026-05-12-3pt9pct",
            title: "Exactly 3.9",
            bucket: "events",
            pinned: false,
            pinnedAt: null,
            eventTitle: "CPI year-over-year in April",
            league: null,
            bestBid: 0.08,
            bestAsk: 0.09,
            lastTrade: 0.09,
            spread: 0.01,
            marketState: "MARKET_STATE_OPEN",
            sharesTraded: 300,
            openInterest: 900,
            tradePrice: 0.09,
            tradeQuantity: 5,
            tradeTime: "2026-04-10T11:46:01.000Z",
            updatedAt: "2026-04-10T11:46:01.000Z",
            state: "ok",
            warning: null,
          },
        ],
        warnings: [],
      });
    });

    await waitFor(() => {
      expect(container).toHaveTextContent("Exactly 3.9");
      expect(screen.getAllByText("NEW").length).toBeGreaterThan(0);
      expect(container).toHaveTextContent("1 new");
      expect(container).toHaveTextContent("Roster updated");
    });
  });

  it("keeps Polymarket panels neutral before the first live snapshot arrives", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/trading-ops/polymarket" || url === "/api/trading-ops/polymarket/live") {
        throw new Error("temporary network issue");
      }

      return new Promise<Response>(() => {
        // Keep unrelated fetches dormant.
      });
    }) as typeof fetch);

    const { container } = render(<TradingOpsDashboard data={fixture} />);

    const polymarketTab = screen.getByRole("tab", { name: "Polymarket" });
    fireEvent.mouseDown(polymarketTab);
    fireEvent.click(polymarketTab);

    await act(async () => {
      findEventSource("/api/trading-ops/polymarket/live/stream")?.fail();
    });

    await waitFor(() => {
      expect(container).toHaveTextContent("Waiting for Polymarket live streams to settle after page load.");
      expect(container).toHaveTextContent("Waiting for Polymarket account state.");
    });

    expect(container).not.toHaveTextContent("Polymarket live unavailable");
  });

  it("keeps reconnecting Polymarket payloads neutral during startup grace, then surfaces them after warmup", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-16T17:58:00.000Z"));

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === "/api/trading-ops/polymarket") {
        return new Response(
          JSON.stringify({
            generatedAt: "2026-04-16T17:58:01.000Z",
            account: {
              state: "error",
              label: "error",
              message: "Live account stream is error. 0 live balance snapshots, 0 positions, 0 open orders.",
              updatedAt: "2026-04-16T17:58:01.000Z",
              source: "/api/trading-ops/polymarket/live",
              warnings: ["stream not ready"],
              data: {
                status: "error",
                keyIdSuffix: null,
                balanceCount: 0,
                positionCount: 0,
                openOrdersCount: 0,
                balances: [],
              },
            },
            signal: {
              state: "missing",
              label: "No live event stream",
              message: "Polymarket event markets are not streaming yet.",
              updatedAt: "2026-04-16T17:58:01.000Z",
              source: "/api/trading-ops/polymarket/live",
              warnings: ["stream not ready"],
              data: null,
            },
            watchlist: {
              state: "degraded",
              label: "Live linked watchlist degraded",
              message: "Live linked watchlist has 3 symbols across funds.",
              updatedAt: "2026-04-16T17:58:01.000Z",
              source: "/api/trading-ops/polymarket/live",
              warnings: ["stream not ready"],
              data: {
                updatedAt: "2026-04-16T17:58:01.000Z",
                totalCount: 3,
                buckets: {
                  stocks: [],
                  funds: ["SPY", "QQQ", "DIA"],
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
              updatedAt: "2026-04-16T17:58:01.000Z",
              source: "/api/trading-ops/polymarket/results",
              warnings: [],
              data: {
                updatedAt: "2026-04-16T17:58:01.000Z",
                settledCount: 0,
                tradedCount: 0,
                openPositionCount: 0,
                rows: [],
              },
            },
          }),
        );
      }

      if (url === "/api/trading-ops/polymarket/live") {
        return new Response(
          JSON.stringify({
            generatedAt: "2026-04-16T17:58:01.000Z",
            streamer: {
              marketsConnected: false,
              privateConnected: false,
              operatorState: "reconnecting",
              trackedMarketCount: 0,
              trackedMarketSlugs: [],
              lastMarketMessageAt: null,
              lastPrivateMessageAt: null,
              lastError: "operation aborted",
            },
            account: {
              balance: null,
              buyingPower: null,
              openOrdersCount: 0,
              positionCount: 0,
              lastBalanceUpdateAt: null,
              lastOrdersUpdateAt: null,
              lastPositionsUpdateAt: null,
            },
            roster: {
              candidateEventsCount: 0,
              candidateSportsCount: 0,
            },
            markets: [],
            warnings: ["operation aborted"],
          }),
        );
      }

      return new Promise<Response>(() => {
        // Keep unrelated fetches dormant.
      });
    }) as typeof fetch);

    const { container } = render(<TradingOpsDashboard data={fixture} />);

    const polymarketTab = screen.getByRole("tab", { name: "Polymarket" });
    fireEvent.mouseDown(polymarketTab);
    fireEvent.click(polymarketTab);

    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(1);
    });

    expect(container).toHaveTextContent("Waiting for Polymarket live streams to settle after page load.");
    expect(container).toHaveTextContent("Waiting for Polymarket account state.");

    expect(container).not.toHaveTextContent("Markets reconnecting");
    expect(container).not.toHaveTextContent("Live account stream is error.");

    await act(async () => {
      vi.advanceTimersByTime(12_001);
      await Promise.resolve();
    });

    expect(container).toHaveTextContent("One or more Polymarket streams are reconnecting.");
    expect(container).toHaveTextContent("Live account stream is error. 0 live balance snapshots, 0 positions, 0 open orders.");
  });

  it("shows the freshest pinned market timestamp when quote updates are newer than the last trade", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/trading-ops/polymarket") {
        return new Response(
          JSON.stringify({
            generatedAt: "2026-04-10T12:00:00.000Z",
            account: {
              state: "ok",
              label: "healthy",
              message: "Authenticated account is reachable.",
              updatedAt: "2026-04-10T12:00:00.000Z",
              source: "/api/trading-ops/polymarket",
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
              message: "Neutral",
              updatedAt: "2026-04-10T12:00:00.000Z",
              source: "/tmp/latest-report.json",
              warnings: [],
              badgeText: "neutral",
              data: {
                generatedAt: "2026-04-10T12:00:00.000Z",
                compactLines: ["Polymarket: pinned market live"],
                alignment: "neutral",
                overlaySummary: "Neutral",
                overlayDetail: null,
                conviction: "neutral",
                aggressionDial: "steady",
                divergenceSummary: null,
                topMarkets: [],
              },
            },
            watchlist: {
              state: "ok",
              label: "Watchlist ready",
              message: "Linked watchlist has 0 symbols across stocks, funds.",
              updatedAt: "2026-04-10T12:00:00.000Z",
              source: "/tmp/latest-watchlist.json",
              warnings: [],
              data: {
                updatedAt: "2026-04-10T12:00:00.000Z",
                totalCount: 0,
                buckets: { stocks: [], funds: [], crypto: [], cryptoProxies: [] },
                symbols: [],
              },
            },
            results: {
              state: "ok",
              label: "Pinned results waiting",
              message: "Pinned markets will appear here after settlement.",
              updatedAt: "2026-04-10T12:00:00.000Z",
              source: "/api/trading-ops/polymarket/results",
              warnings: [],
              data: {
                updatedAt: "2026-04-10T12:00:00.000Z",
                settledCount: 0,
                tradedCount: 0,
                openPositionCount: 0,
                rows: [],
              },
            },
          }),
        );
      }

      return new Promise<Response>(() => {
        // Keep unrelated fetches dormant.
      });
    }) as typeof fetch);

    const { container } = render(<TradingOpsDashboard data={fixture} />);

    const polymarketTab = screen.getByRole("tab", { name: "Polymarket" });
    fireEvent.mouseDown(polymarketTab);
    fireEvent.click(polymarketTab);

    await act(async () => {
      findEventSource("/api/trading-ops/polymarket/live/stream")?.emit("snapshot", {
        generatedAt: "2026-04-10T12:00:02.000Z",
        streamer: {
          marketsConnected: true,
          privateConnected: true,
          operatorState: "healthy",
          trackedMarketCount: 1,
          trackedMarketSlugs: ["fed-maintains"],
          lastMarketMessageAt: "2026-04-10T12:00:01.000Z",
          lastPrivateMessageAt: "2026-04-10T12:00:01.500Z",
          lastError: null,
        },
        account: {
          balance: 0,
          buyingPower: 0,
          openOrdersCount: 0,
          positionCount: 0,
          lastBalanceUpdateAt: "2026-04-10T12:00:01.500Z",
          lastOrdersUpdateAt: null,
          lastPositionsUpdateAt: null,
        },
        markets: [
          {
            slug: "fed-maintains",
            title: "Fed maintains rate",
            bucket: "events",
            pinned: true,
            pinnedAt: "2026-04-10T11:59:30.000Z",
            eventTitle: "Fed Decision in April",
            league: null,
            bestBid: 0.96,
            bestAsk: 0.97,
            lastTrade: 0.97,
            spread: 0.01,
            marketState: "MARKET_STATE_OPEN",
            sharesTraded: 1500,
            openInterest: 2100,
            tradePrice: 0.97,
            tradeQuantity: 25,
            tradeTime: "2026-04-10T11:41:00.000Z",
            updatedAt: "2026-04-10T12:02:00.000Z",
            state: "ok",
            warning: null,
          },
        ],
        warnings: [],
      });
    });

    await waitFor(() => {
      expect(container).toHaveTextContent("Fed maintains rate");
      expect(container).toHaveTextContent("Apr 10, 8:02 AM");
      expect(container).not.toHaveTextContent("Apr 10, 7:41 AM");
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
            freshnessMessage: "Using last-known Schwab streamer quotes while the stream reconnects.",
            rows: [
              { ...liveRow("SPY", "SPY", "SPY", 510.12, 1.25), source: "schwab_streamer_shared", state: "degraded" },
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
      findEventSource("/api/trading-ops/live/stream")?.fail();
    });

    await waitFor(() => {
      expect(container).toHaveTextContent("Using last-known Schwab streamer quotes while the stream reconnects.");
      expect(container).not.toHaveTextContent("REST fallback");
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
    expect(container).toHaveTextContent("Snapshots");
    expect(container).toHaveTextContent("449");
    expect(container).toHaveTextContent("1d Matured");
    expect(container).toHaveTextContent("880");
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
