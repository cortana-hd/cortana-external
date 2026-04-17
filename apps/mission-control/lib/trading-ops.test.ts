import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatRelativeAge, loadTradingOpsDashboardData } from "@/lib/trading-ops";

async function writeJson(filePath: string, payload: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(payload, null, 2));
}

const externalServiceFetch = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);

  if (url.endsWith("/market-data/ops")) {
    return new Response(
      JSON.stringify({
        generatedAt: "2026-04-03T23:28:00.000Z",
        data: {
          serviceOperatorState: "healthy",
          providerMetrics: {
            lastSuccessfulSchwabRestAt: "2026-04-03T23:27:00.000Z",
            schwabCooldownUntil: null,
            schwabTokenStatus: "ready",
          },
          health: {
            providers: {
              coinmarketcap: "configured",
              schwab: "configured",
              schwabStreamer: "enabled",
              schwabStreamerMeta: {
                connected: true,
                operatorState: "healthy",
                lastMessageAt: "2026-04-03T23:27:58.000Z",
                lastLoginAt: "2026-04-03T22:15:15.425Z",
                activeSubscriptions: {
                  LEVELONE_EQUITIES: 55,
                  ACCT_ACTIVITY: 0,
                },
              },
              fred: "configured",
            },
          },
        },
      }),
    );
  }

  if (url.endsWith("/alpaca/health")) {
    return new Response(JSON.stringify({ status: "healthy", environment: "paper", target_environment: "paper" }));
  }

  if (url.endsWith("/polymarket/health")) {
    return new Response(
      JSON.stringify({
        generatedAt: "2026-04-03T23:28:00.000Z",
        status: "healthy",
        apiBaseUrl: "https://api.polymarket.us",
        gatewayBaseUrl: "https://gateway.polymarket.us",
        keyIdSuffix: "106dac",
        balanceCount: 0,
      }),
    );
  }

  if (url.endsWith("/polymarket/live")) {
    return new Response(
      JSON.stringify({
        generatedAt: "2026-04-03T23:28:00.000Z",
        status: "ok",
        streamer: {
          marketsConnected: true,
          privateConnected: true,
          operatorState: "healthy",
          trackedMarketCount: 106,
          trackedMarketSlugs: ["rdc-usfed-fomc-2026-04-29-cut25bps"],
          lastMarketMessageAt: "2026-04-03T23:27:59.000Z",
          lastPrivateMessageAt: "2026-04-03T23:27:58.000Z",
          lastError: null,
        },
        account: {
          balance: 0,
          buyingPower: 0,
          openOrdersCount: 0,
          positionCount: 0,
          lastBalanceUpdateAt: "2026-04-03T23:27:58.000Z",
          lastOrdersUpdateAt: "2026-04-03T23:27:58.000Z",
          lastPositionsUpdateAt: "2026-04-03T23:27:58.000Z",
        },
        markets: [],
        warnings: [],
      }),
    );
  }

  return new Response(JSON.stringify({ status: "ok" }));
}) as typeof fetch;

describe("trading ops loader", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map(async (dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
    externalServiceFetch.mockClear();
    vi.unstubAllGlobals();
  });

  it("loads mixed live snapshots and persisted artifacts into one dashboard payload", async () => {
    vi.stubGlobal("fetch", externalServiceFetch);
    const repoPath = await mkdtemp(path.join(os.tmpdir(), "trading-ops-"));
    const cortanaRepoPath = await mkdtemp(path.join(os.tmpdir(), "trading-ops-cortana-"));
    tempDirs.push(repoPath);
    tempDirs.push(cortanaRepoPath);

    await writeJson(path.join(repoPath, ".cache", "market_regime_snapshot_SPY.json"), {
      generated_at_utc: "2026-04-03T23:16:06.970801+00:00",
      market_status: {
        regime: "correction",
        status: "degraded",
        notes: "Stay defensive.",
        position_sizing: 0,
        degraded_reason: "cached history",
        next_action: "Retry after cooldown",
      },
    });
    await writeJson(path.join(repoPath, "var", "readiness", "pre-open-canary-latest.json"), {
      generated_at: "2026-04-03T23:15:22.659140+00:00",
      checked_at: "2026-04-03T23:15:22.659140+00:00",
      result: "warn",
      status: "degraded",
      ready_for_open: false,
      warnings: ["service_ready:provider_cooldown"],
      checks: [{ name: "service_ready", result: "warn" }],
    });
    await writeJson(path.join(repoPath, ".cache", "prediction_accuracy", "reports", "prediction-accuracy-latest.json"), {
      generated_at: "2026-04-03T23:16:04.659512+00:00",
      snapshot_count: 449,
      record_count: 1838,
      horizon_status: { "1d": { matured: 880, pending: 337 } },
      validation_grade_counts: { trade_validation_grade: { good: 10, mixed: 5 } },
      summary: [{ strategy: "dip_buyer", action: "WATCH", "1d": { samples: 100 } }],
    });
    await writeJson(path.join(repoPath, ".cache", "prediction_accuracy", "reports", "benchmark-comparison-latest.json"), {
      generated_at: "2026-04-03T23:16:04.695355+00:00",
      horizon_key: "5d",
      baselines: { all_predictions: { matured_count: 7 } },
      comparisons: { by_strategy: [{ strategy: "canslim", metrics: { matured_count: 7 } }] },
    });
    await writeJson(path.join(repoPath, ".cache", "prediction_accuracy", "reports", "decision-review-latest.json"), {
      generated_at: "2026-04-03T23:16:04.700000+00:00",
      opportunity_cost: {
        by_action: [{ action: "NO_BUY", overblock_rate: 0 }],
      },
      veto_effectiveness: [{ veto: "market_regime", count: 16 }],
    });
    await writeJson(path.join(repoPath, ".cache", "trade_lifecycle", "cycle_summary.json"), {
      generated_at: "2026-04-03T22:20:35.951192+00:00",
      summary: { open_count: 1, closed_total_count: 2 },
      portfolio_snapshot: { total_capital: 100000, available_capital: 85000, gross_exposure_pct: 0.15 },
    });
    await writeJson(path.join(repoPath, "var", "local-workflows", "20260403-231522", "canslim-alert.json"), {
      generated_at: "2026-04-03T23:15:25.794002+00:00",
      degraded_status: "degraded_safe",
      market: { regime: "correction", status: "degraded", notes: "Stay defensive.", position_sizing: 0, next_action: "Retry later" },
      render_lines: ["Summary: scanned 120 | evaluated 0 | BUY 0 | WATCH 0 | NO_BUY 0"],
      summary: { buy_count: 0, watch_count: 0, no_buy_count: 0 },
    });
    await writeJson(path.join(repoPath, "var", "local-workflows", "20260403-231522", "leader-baskets-raw.json"), {
      buckets: { monthly: [{ symbol: "OXY" }, { symbol: "GEV" }, { symbol: "FANG" }] },
    });
    await mkdir(path.join(repoPath, "var", "local-workflows", "20260403-231522"), { recursive: true });
    await writeFile(
      path.join(repoPath, "var", "local-workflows", "20260403-231522", "run-manifest-stages.tsv"),
      "market_regime\tok\t2026-04-03T23:15:22Z\t2026-04-03T23:15:25Z\ncanslim_alert\tok\t2026-04-03T23:15:25Z\t2026-04-03T23:15:29Z\ndipbuyer_alert\terror\t2026-04-03T23:15:29Z\t2026-04-03T23:16:03Z\n",
    );
    await writeFile(
      path.join(repoPath, "var", "local-workflows", "20260403-231522", "run-manifest-artifacts.tsv"),
      "canslim-alert-json\tstrategy_alert\t/tmp/canslim-alert.json\n",
    );
    await writeJson(path.join(cortanaRepoPath, "var", "backtests", "runs", "20260403-163103", "summary.json"), {
      runId: "20260403-163103",
      completedAt: "2026-04-03T16:38:59.979Z",
    });
    await writeJson(path.join(cortanaRepoPath, "var", "backtests", "runs", "20260403-163103", "watchlist-full.json"), {
      decision: "WATCH",
      summary: { buy: 0, watch: 36, noBuy: 12 },
      focus: { ticker: "ABBV", action: "WATCH", strategy: "Dip Buyer" },
      strategies: {
        dipBuyer: {
          buy: [{ ticker: "ABC" }],
          watch: [{ ticker: "ABBV" }, { ticker: "ACHV" }, { ticker: "AEP" }, { ticker: "AEE" }, { ticker: "ADM" }, { ticker: "AES" }],
          noBuy: [{ ticker: "AAPL" }, { ticker: "AMD" }],
        },
        canslim: {
          buy: [{ ticker: "NVDA" }],
          watch: [{ ticker: "MSFT" }],
          noBuy: [{ ticker: "TSLA" }],
        },
      },
    });
    await writeFile(
      path.join(cortanaRepoPath, "var", "backtests", "runs", "20260403-163103", "message.txt"),
      "📈 Trading Advisor — Market Snapshot\n🎯 Decision: WATCH\n🔥 Focus: ABBV — WATCH (Dip Buyer)\n",
    );

    const runJsonCommand = async (scriptPath: string) => {
      if (scriptPath.endsWith("runtime_health_snapshot.py")) {
        return {
          generated_at: "2026-04-03T23:25:53.853293+00:00",
          pre_open_gate_status: "warn",
        pre_open_gate_freshness: {
          status: "fresh",
          detail: "Last pre-open readiness check ran 11m ago at 2026-04-03T23:15:22.659140+00:00.",
        },
        provider_mode_summary: {
          summary_line: "Live quotes: schwab_primary | history: cache_or_alpaca_fallback | fundamentals: schwab_primary | metadata: schwab_primary",
        },
        provider_cooldown_summary: {
          active: true,
          detail: "Cooldown is active now. Watchdog still sees provider health, quote smoke failing since 2026-04-03T23:02:00.000000+00:00.",
          },
          service_health: {
            operator_state: "provider_cooldown",
            operator_action: "Wait for cooldown to clear.",
          },
          incident_markers: [{ incident_type: "provider_cooldown", severity: "medium", operator_action: "Wait." }],
        };
      }

      return {
        generated_at: "2026-04-03T23:26:00.000000+00:00",
        backup_restore: {
          critical_assets: [{ asset_key: "postgres" }, { asset_key: "schwab_token" }],
          do_not_commit_paths: ["/tmp/.env"],
          minimum_recovery_sequence: ["Restore repo config."],
        },
      };
    };

    const data = await loadTradingOpsDashboardData({
      backtesterRepoPath: repoPath,
      cortanaRepoPath,
      runJsonCommand,
      tradingRunStateStore: null,
    });

    expect(data.market.state).toBe("degraded");
    expect(data.market.badgeText).toBeUndefined();
    expect(data.market.data?.focusSymbols).toEqual(["OXY", "GEV", "FANG"]);
    expect(data.runtime.data?.operatorState).toBe("provider_cooldown");
    expect(data.runtime.data?.preOpenGateStatus).toBe("Warn");
    expect(data.runtime.data?.preOpenGateDetail).toBeNull();
    expect(data.runtime.data?.preOpenGateFreshness).toContain("Last pre-open readiness check ran");
    expect(data.runtime.data?.providerModeSummary).toContain("Live quotes: schwab_primary");
    expect(data.runtime.data?.cooldownSummary).toContain("Cooldown is active now");
    expect(data.canary.data?.warningCount).toBe(1);
    expect(data.canary.data?.checkedAt).toBe("2026-04-03T23:15:22.659140+00:00");
    expect(data.canary.data?.freshness).toContain("Apr 3");
    expect(data.prediction.state).toBe("degraded");
    expect(data.prediction.badgeText).toBe("stale");
    expect(data.prediction.message).toContain("Prediction accuracy report is stale");
    expect(data.prediction.data?.oneDayMatured).toBe(880);
    expect(data.operatorVerdict.state).toBe("degraded");
    expect(data.operatorVerdict.label).toBe("Research only");
    expect(data.operatorVerdict.data?.verdictLabel).toBe("Do not size up");
    expect(data.benchmark.data?.horizonKey).toBe("5d");
    expect(data.lifecycle.data?.openCount).toBe(1);
    expect(data.workflow.state).toBe("degraded");
    expect(data.workflow.data?.failedStages).toEqual(["dipbuyer_alert"]);
    expect(data.workflow.data?.runLabel).toBe("Apr 3, 7:16 PM");
    expect(data.workflow.data?.isStale).toBe(false);
    expect(data.opsHighway.data?.criticalAssetCount).toBe(2);
    expect(data.financialServices.state).toBe("ok");
    expect(data.financialServices.data?.healthyCount).toBe(7);
    expect(data.financialServices.data?.errorCount).toBe(0);
    expect(data.financialServices.data?.rows.map((row) => row.label)).toEqual([
      "Alpaca",
      "FRED",
      "CoinMarketCap",
      "Schwab REST",
      "Schwab streamer",
      "Polymarket REST",
      "Polymarket streamer",
    ]);
    expect(data.tradingRun.state).toBe("ok");
    expect(data.tradingRun.data?.runLabel).toBe("Apr 3, 12:38 PM");
    expect(data.tradingRun.data?.status).toBe("success");
    expect(data.tradingRun.data?.deliveryStatus).toBe("pending");
    expect(data.tradingRun.data?.notifiedAt).toBeNull();
    expect(data.tradingRun.data?.focusTicker).toBe("ABBV");
    expect(data.tradingRun.data?.sourceType).toBe("artifact");
    expect(data.tradingRun.data?.dipBuyerWatch).toEqual(["ABBV", "ACHV", "AEP", "AEE", "ADM", "AES"]);
    expect(data.tradingRun.data?.dipBuyerBuy).toEqual(["ABC"]);
    expect(data.tradingRun.data?.dipBuyerNoBuy).toEqual(["AAPL", "AMD"]);
    expect(data.tradingRun.data?.canslimBuy).toEqual(["NVDA"]);
    expect(data.tradingRun.data?.canslimWatch).toEqual(["MSFT"]);
    expect(data.tradingRun.data?.canslimNoBuy).toEqual(["TSLA"]);
  });

  it("keeps the Schwab streamer row explicit when the connection drops", async () => {
    const disconnectedFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/market-data/ops")) {
        return new Response(
          JSON.stringify({
            generatedAt: "2026-04-16T15:10:00.000Z",
            data: {
              serviceOperatorState: "healthy",
              providerMetrics: {
                lastSuccessfulSchwabRestAt: "2026-04-16T15:09:00.000Z",
                schwabCooldownUntil: null,
                schwabTokenStatus: "ready",
              },
              health: {
                providers: {
                  coinmarketcap: "configured",
                  schwab: "configured",
                  schwabStreamer: "enabled",
                  schwabStreamerMeta: {
                    connected: false,
                    operatorState: "healthy",
                    lastMessageAt: "2026-04-16T15:08:50.000Z",
                    lastDisconnectAt: "2026-04-16T15:09:55.000Z",
                    lastDisconnectReason: "1000:",
                    lastHeartbeatAt: "2026-04-16T15:08:59.000Z",
                    activeSubscriptions: {
                      LEVELONE_EQUITIES: 55,
                      ACCT_ACTIVITY: 0,
                    },
                  },
                  fred: "configured",
                },
              },
            },
          }),
        );
      }
      return externalServiceFetch(input);
    }) as typeof fetch;

    vi.stubGlobal("fetch", disconnectedFetch);
    const repoPath = await mkdtemp(path.join(os.tmpdir(), "trading-ops-streamer-drop-"));
    tempDirs.push(repoPath);

    const data = await loadTradingOpsDashboardData({
      backtesterRepoPath: repoPath,
      cortanaRepoPath: repoPath,
      runJsonCommand: async () => {
        throw new Error("script unavailable");
      },
      tradingRunStateStore: null,
    });

    const streamerRow = data.financialServices.data?.rows.find((row) => row.label === "Schwab streamer");
    expect(streamerRow?.state).toBe("degraded");
    expect(streamerRow?.summary).toBe("disconnected");
    expect(streamerRow?.badgeText).toBeNull();
    expect(streamerRow?.detail).toContain("Disconnected: 1000:");
    expect(streamerRow?.detail).toContain("Last disconnect");
  });

  it("handles missing artifacts without throwing", async () => {
    vi.stubGlobal("fetch", externalServiceFetch);
    const repoPath = await mkdtemp(path.join(os.tmpdir(), "trading-ops-empty-"));
    tempDirs.push(repoPath);

    const data = await loadTradingOpsDashboardData({
      backtesterRepoPath: repoPath,
      cortanaRepoPath: repoPath,
      runJsonCommand: async () => {
        throw new Error("script unavailable");
      },
      tradingRunStateStore: null,
    });

    expect(data.market.state).toBe("missing");
    expect(data.workflow.state).toBe("missing");
    expect(data.runtime.state).toBe("error");
    expect(data.opsHighway.state).toBe("error");
    expect(data.tradingRun.state).toBe("missing");
  });

  it("marks older market and workflow artifacts as stale when a newer trading run exists", async () => {
    vi.stubGlobal("fetch", externalServiceFetch);
    const repoPath = await mkdtemp(path.join(os.tmpdir(), "trading-ops-stale-"));
    const cortanaRepoPath = await mkdtemp(path.join(os.tmpdir(), "trading-ops-stale-cortana-"));
    tempDirs.push(repoPath);
    tempDirs.push(cortanaRepoPath);

    await writeJson(path.join(repoPath, ".cache", "market_regime_snapshot_SPY.json"), {
      generated_at_utc: "2026-04-03T23:16:06.970801+00:00",
      market_status: {
        regime: "correction",
        status: "ok",
        notes: "Legacy market brief.",
        position_sizing: 0.5,
        next_action: "Keep scanning",
      },
    });
    await writeJson(path.join(repoPath, "var", "local-workflows", "20260403-231522", "canslim-alert.json"), {
      generated_at: "2026-04-03T23:15:25.794002+00:00",
      market: { regime: "correction", status: "ok", notes: "Legacy market brief.", position_sizing: 0.5, next_action: "Keep scanning" },
      render_lines: ["Summary: scanned 120 | BUY 2 | WATCH 4 | NO_BUY 10"],
      summary: { buy_count: 2, watch_count: 4, no_buy_count: 10 },
    });
    await writeJson(path.join(repoPath, "var", "local-workflows", "20260403-231522", "leader-baskets-raw.json"), {
      buckets: { monthly: [{ symbol: "OXY" }, { symbol: "GEV" }] },
    });
    await writeJson(path.join(repoPath, ".cache", "trade_lifecycle", "cycle_summary.json"), {
      generated_at: "2026-04-03T22:20:35.951192+00:00",
      summary: { open_count: 1, closed_total_count: 2 },
      portfolio_snapshot: { total_capital: 100000, available_capital: 85000, gross_exposure_pct: 0.15 },
    });
    await mkdir(path.join(repoPath, "var", "local-workflows", "20260403-231522"), { recursive: true });
    await writeFile(
      path.join(repoPath, "var", "local-workflows", "20260403-231522", "run-manifest-stages.tsv"),
      "market_regime\tok\t2026-04-03T23:15:22Z\t2026-04-03T23:15:25Z\ncanslim_alert\tok\t2026-04-03T23:15:25Z\t2026-04-03T23:15:29Z\n",
    );
    await writeJson(path.join(cortanaRepoPath, "var", "backtests", "runs", "20260407-144340", "summary.json"), {
      runId: "20260407-144340",
      completedAt: "2026-04-07T14:53:16.745Z",
      metrics: { correctionMode: false },
    });
    await writeJson(path.join(cortanaRepoPath, "var", "backtests", "runs", "20260407-144340", "watchlist-full.json"), {
      decision: "NO_TRADE",
      summary: { buy: 0, watch: 0, noBuy: 96 },
      focus: {},
      strategies: { dipBuyer: { buy: [], watch: [], noBuy: [] }, canslim: { buy: [], watch: [], noBuy: [] } },
    });

    const data = await loadTradingOpsDashboardData({
      backtesterRepoPath: repoPath,
      cortanaRepoPath,
      runJsonCommand: async () => {
        throw new Error("script unavailable");
      },
      tradingRunStateStore: null,
    });

    expect(data.market.state).toBe("degraded");
    expect(data.market.message).toContain("Latest trading run Apr 7, 10:53 AM finished NO_TRADE");
    expect(data.market.data?.posture).toBe("Stand aside");
    expect(data.market.data?.regime).toBe("active");
    expect(data.market.data?.focusSymbols).toEqual([]);
    expect(data.market.data?.referenceRunLabel).toBe("Apr 7, 10:53 AM");
    expect(data.market.data?.alertSummary).toBe("Latest trading run Apr 7, 10:53 AM: BUY 0 · WATCH 0 · NO_BUY 96");
    expect(data.market.warnings).toContain("Latest trading run Apr 7, 10:53 AM is newer than this market brief.");
    expect(data.market.source).toContain("canslim-alert.json");
    expect(data.workflow.state).toBe("degraded");
    expect(data.workflow.data?.isStale).toBe(true);
    expect(data.workflow.badgeText).toBe("stale");
    expect(data.workflow.data?.referenceRunLabel).toBe("Apr 7, 10:53 AM");
    expect(data.workflow.message).toContain("Latest trading run Apr 7, 10:53 AM completed after this workflow artifact");
    expect(data.workflow.warnings).toContain("Latest trading run Apr 7, 10:53 AM is newer than this workflow artifact.");
    expect(data.lifecycle.state).toBe("degraded");
    expect(data.lifecycle.badgeText).toBe("stale");
    expect(data.lifecycle.message).toContain("Latest trading run Apr 7, 10:53 AM is newer than this lifecycle summary");
  });

  it("renders missing pre-open readiness-check state as not available instead of unknown", async () => {
    vi.stubGlobal("fetch", externalServiceFetch);
    const repoPath = await mkdtemp(path.join(os.tmpdir(), "trading-ops-runtime-"));
    tempDirs.push(repoPath);

    const data = await loadTradingOpsDashboardData({
      backtesterRepoPath: repoPath,
      cortanaRepoPath: repoPath,
      runJsonCommand: async (scriptPath: string) => {
        if (scriptPath.endsWith("runtime_health_snapshot.py")) {
          return {
            generated_at: "2026-04-07T16:08:10.071538+00:00",
            pre_open_gate_status: "not_available",
            pre_open_gate_detail: "Pre-open readiness check artifact is missing at /tmp/pre-open-canary-latest.json.",
            pre_open_gate_freshness: {
              status: "missing",
              detail: "Pre-open readiness check artifact is missing at /tmp/pre-open-canary-latest.json.",
            },
            service_health: {
              operator_state: "healthy",
              operator_action: "No operator action required.",
            },
            incident_markers: [],
          };
        }
        throw new Error("script unavailable");
      },
      tradingRunStateStore: null,
    });

    expect(data.runtime.state).toBe("ok");
    expect(data.runtime.data?.preOpenGateStatus).toBe("Readiness check unavailable");
    expect(data.runtime.data?.preOpenGateDetail).toContain("Pre-open readiness check artifact is missing");
    expect(data.runtime.data?.preOpenGateFreshness).toContain("Pre-open readiness check artifact is missing");
  });

  it("refreshes the prediction loop summary when newer settled artifacts exist", async () => {
    vi.stubGlobal("fetch", externalServiceFetch);
    const repoPath = await mkdtemp(path.join(os.tmpdir(), "trading-ops-prediction-refresh-"));
    tempDirs.push(repoPath);

    const reportPath = path.join(repoPath, ".cache", "prediction_accuracy", "reports", "prediction-accuracy-latest.json");
    await writeJson(reportPath, {
      generated_at: "2026-04-03T23:16:04.659512+00:00",
      snapshot_count: 449,
      record_count: 1838,
      horizon_status: { "1d": { matured: 880, pending: 337 } },
      validation_grade_counts: { trade_validation_grade: { good: 10, mixed: 5 } },
      summary: [{ strategy: "dip_buyer", action: "WATCH", "1d": { samples: 100 } }],
    });
    const settledPath = path.join(repoPath, ".cache", "prediction_accuracy", "settled", "20260416-194539-704667-dip_buyer.json");
    await writeJson(settledPath, {
      generated_at: "2026-04-16T19:45:39.704667+00:00",
      records: [],
    });
    const sharedMtime = new Date("2026-04-16T19:50:00.000Z");
    await utimes(reportPath, sharedMtime, sharedMtime);
    await utimes(settledPath, sharedMtime, sharedMtime);

    const runJsonCommand = vi.fn(async (scriptPath: string, args?: string[]) => {
      if (scriptPath.endsWith("prediction_accuracy_report.py")) {
        expect(args).toEqual(["--json", "--max-snapshots-per-run", "1"]);
        return {
          prediction_accuracy: {
            generated_at: "2026-04-16T19:49:24.074811+00:00",
            snapshot_count: 468,
            record_count: 1984,
            horizon_status: { "1d": { matured: 924, pending: 401 } },
            validation_grade_counts: { trade_validation_grade: { good: 340, mixed: 320, unknown: 900 } },
            summary: [{ strategy: "canslim", action: "NO_BUY", "1d": { samples: 412 } }],
          },
        };
      }
      if (scriptPath.endsWith("runtime_health_snapshot.py")) {
        return {
          generated_at: "2026-04-16T19:49:24.074811+00:00",
          service_health: {
            operator_state: "healthy",
            operator_action: "No operator action required.",
          },
          incident_markers: [],
        };
      }
      if (scriptPath.endsWith("ops_highway_snapshot.py")) {
        return {
          generated_at: "2026-04-16T19:49:24.074811+00:00",
          backup_restore: {
            critical_assets: [],
            do_not_commit_paths: [],
            minimum_recovery_sequence: [],
          },
        };
      }
      throw new Error(`unexpected script: ${scriptPath}`);
    });

    const data = await loadTradingOpsDashboardData({
      backtesterRepoPath: repoPath,
      cortanaRepoPath: repoPath,
      runJsonCommand,
      tradingRunStateStore: null,
    });

    expect(runJsonCommand).toHaveBeenCalledWith(expect.stringMatching(/prediction_accuracy_report\.py$/), ["--json", "--max-snapshots-per-run", "1"]);
    expect(data.prediction.state).toBe("ok");
    expect(data.prediction.badgeText).toBeUndefined();
    expect(data.prediction.data?.snapshotCount).toBe(468);
    expect(data.prediction.data?.recordCount).toBe(1984);
    expect(data.prediction.data?.oneDayMatured).toBe(924);
  });

  it("rejects obviously mock-contaminated artifacts", async () => {
    vi.stubGlobal("fetch", externalServiceFetch);
    const repoPath = await mkdtemp(path.join(os.tmpdir(), "trading-ops-mock-artifact-"));
    tempDirs.push(repoPath);

    await writeJson(path.join(repoPath, ".cache", "prediction_accuracy", "reports", "prediction-accuracy-latest.json"), {
      generated_at: "2026-04-16T15:00:00.000Z",
      snapshot_count: 1,
      record_count: 1,
      horizon_status: { "1d": { matured: 1, pending: 0 } },
      validation_grade_counts: { trade_validation_grade: { good: 1 } },
      summary: [{ strategy: "MagicMock", action: "WATCH" }],
    });

    const data = await loadTradingOpsDashboardData({
      backtesterRepoPath: repoPath,
      cortanaRepoPath: repoPath,
      runJsonCommand: async () => {
        throw new Error("script unavailable");
      },
      tradingRunStateStore: null,
    });

    expect(data.prediction.state).toBe("error");
    expect(data.prediction.message).toContain("corrupt or test-generated");
  });

  it("renders provider cooldown timestamps in ET instead of raw ISO", async () => {
    vi.stubGlobal("fetch", externalServiceFetch);
    const repoPath = await mkdtemp(path.join(os.tmpdir(), "trading-ops-runtime-human-"));
    tempDirs.push(repoPath);

    const data = await loadTradingOpsDashboardData({
      backtesterRepoPath: repoPath,
      cortanaRepoPath: repoPath,
      tradingRunStateStore: null,
      runJsonCommand: async (scriptPath: string) => {
        if (scriptPath.endsWith("runtime_health_snapshot.py")) {
          return {
            generated_at: "2026-04-07T17:32:10.071538+00:00",
            pre_open_gate_status: "not_available",
            pre_open_gate_detail: "Pre-open readiness check artifact is missing at /tmp/pre-open-canary-latest.json.",
            pre_open_gate_freshness: {
              status: "missing",
              detail: "Pre-open readiness check artifact is missing at /tmp/pre-open-canary-latest.json.",
            },
            provider_cooldown_summary: {
              active: true,
              detail: "Cooldown is active now. Watchdog still sees provider health, quote smoke failing since 2026-04-07T17:12:29.777Z. Wait until 2026-04-07T17:35:29.777Z or inspect upstream connectivity/auth.",
            },
            service_health: {
              operator_state: "provider_cooldown",
              operator_action: "Schwab REST is cooling down after repeated failures. Wait until 2026-04-07T17:35:29.777Z or inspect upstream connectivity/auth.",
            },
            incident_markers: [
              {
                incident_type: "provider_cooldown",
                severity: "medium",
                operator_action: "Wait until 2026-04-07T17:35:29.777Z or inspect upstream connectivity/auth.",
              },
            ],
          };
        }
        throw new Error("script unavailable");
      },
    });

    expect(data.runtime.message).toContain("Apr 7, 1:35 PM ET");
    expect(data.runtime.message).not.toContain("2026-04-07T17:35:29.777Z");
    expect(data.runtime.data?.operatorAction).toContain("Apr 7, 1:35 PM ET");
    expect(data.runtime.data?.incidents[0]?.operatorAction).toContain("Apr 7, 1:35 PM ET");
    expect(data.runtime.data?.cooldownSummary).toContain("Apr 7, 1:35 PM ET");
  });

  it("marks stale canary artifacts as stale supporting health state", async () => {
    vi.stubGlobal("fetch", externalServiceFetch);
    const repoPath = await mkdtemp(path.join(os.tmpdir(), "trading-ops-canary-stale-"));
    tempDirs.push(repoPath);

    await writeJson(path.join(repoPath, "var", "readiness", "pre-open-canary-latest.json"), {
      generated_at: "2026-04-03T23:15:22.659140+00:00",
      checked_at: "2026-04-03T23:15:22.659140+00:00",
      result: "pass",
      status: "ok",
      ready_for_open: true,
      warnings: [],
      checks: [{ name: "service_ready", result: "pass" }],
    });

    const data = await loadTradingOpsDashboardData({
      backtesterRepoPath: repoPath,
      cortanaRepoPath: repoPath,
      runJsonCommand: async () => {
        throw new Error("script unavailable");
      },
      tradingRunStateStore: null,
    });

    expect(data.canary.state).toBe("degraded");
    expect(data.canary.badgeText).toBe("stale");
    expect(data.canary.message).toContain("Readiness artifact is stale");
  });

  it("prefers DB-backed latest trading run state when the store matches the latest artifact", async () => {
    vi.stubGlobal("fetch", externalServiceFetch);
    const repoPath = await mkdtemp(path.join(os.tmpdir(), "trading-ops-db-"));
    const cortanaRepoPath = await mkdtemp(path.join(os.tmpdir(), "trading-ops-db-cortana-"));
    tempDirs.push(repoPath);
    tempDirs.push(cortanaRepoPath);

    await writeJson(path.join(cortanaRepoPath, "var", "backtests", "runs", "20260407-160126", "summary.json"), {
      runId: "20260407-160126",
      status: "success",
      createdAt: "2026-04-07T16:01:26.865Z",
      startedAt: "2026-04-07T16:01:26.865Z",
      completedAt: "2026-04-07T16:10:52.486Z",
      notifiedAt: "2026-04-07T16:11:11.107Z",
      metrics: { decision: "NO_TRADE", correctionMode: false, buy: 0, watch: 0, noBuy: 96 },
    });
    await writeJson(path.join(cortanaRepoPath, "var", "backtests", "runs", "20260407-160126", "watchlist-full.json"), {
      decision: "NO_TRADE",
      correctionMode: false,
      summary: { buy: 0, watch: 0, noBuy: 96 },
      strategies: { dipBuyer: { buy: [], watch: [], noBuy: [] }, canslim: { buy: [], watch: [], noBuy: [] } },
    });

    const data = await loadTradingOpsDashboardData({
      backtesterRepoPath: repoPath,
      cortanaRepoPath,
      runJsonCommand: async () => {
        throw new Error("script unavailable");
      },
      tradingRunStateStore: {
        syncFromArtifacts: async () => [],
        loadLatest: async () => ({
          runId: "20260407-160126",
          schemaVersion: 1,
          strategy: "Trading market-session unified",
          status: "success",
          createdAt: "2026-04-07T16:01:26.865Z",
          startedAt: "2026-04-07T16:01:26.865Z",
          completedAt: "2026-04-07T16:10:52.486Z",
          notifiedAt: "2026-04-07T16:11:11.107Z",
          deliveryStatus: "notified",
          decision: "NO_TRADE",
          confidence: 0.9,
          risk: "LOW",
          correctionMode: false,
          buyCount: 0,
          watchCount: 0,
          noBuyCount: 96,
          symbolsScanned: 240,
          candidatesEvaluated: 0,
          focusTicker: null,
          focusAction: null,
          focusStrategy: null,
          dipBuyerBuy: [],
          dipBuyerWatch: [],
          dipBuyerNoBuy: [],
          canslimBuy: [],
          canslimWatch: [],
          canslimNoBuy: [],
          artifactDirectory: path.join(cortanaRepoPath, "var", "backtests", "runs", "20260407-160126"),
          summaryPath: path.join(cortanaRepoPath, "var", "backtests", "runs", "20260407-160126", "summary.json"),
          messagePath: null,
          watchlistPath: path.join(cortanaRepoPath, "var", "backtests", "runs", "20260407-160126", "watchlist-full.json"),
          messagePreview: null,
          metrics: { decision: "NO_TRADE" },
          lastError: null,
          sourceHost: "Hs-Mac-mini.local",
        }),
      },
    });

    expect(data.tradingRun.state).toBe("ok");
    expect(data.tradingRun.source).toBe("Mission Control Postgres · mc_trading_runs");
    expect(data.tradingRun.data?.sourceType).toBe("db");
    expect(data.tradingRun.data?.deliveryStatus).toBe("notified");
    expect(data.tradingRun.message).toContain("DB-backed latest run Apr 7, 12:10 PM finished NO_TRADE.");
  });

  it("falls back explicitly when DB-backed latest run state disagrees with the latest artifact", async () => {
    vi.stubGlobal("fetch", externalServiceFetch);
    const repoPath = await mkdtemp(path.join(os.tmpdir(), "trading-ops-db-fallback-"));
    const cortanaRepoPath = await mkdtemp(path.join(os.tmpdir(), "trading-ops-db-fallback-cortana-"));
    tempDirs.push(repoPath);
    tempDirs.push(cortanaRepoPath);

    await writeJson(path.join(cortanaRepoPath, "var", "backtests", "runs", "20260407-160126", "summary.json"), {
      runId: "20260407-160126",
      status: "success",
      createdAt: "2026-04-07T16:01:26.865Z",
      startedAt: "2026-04-07T16:01:26.865Z",
      completedAt: "2026-04-07T16:10:52.486Z",
      notifiedAt: "2026-04-07T16:11:11.107Z",
      metrics: { decision: "NO_TRADE", correctionMode: false, buy: 0, watch: 0, noBuy: 96 },
    });
    await writeJson(path.join(cortanaRepoPath, "var", "backtests", "runs", "20260407-160126", "watchlist-full.json"), {
      decision: "NO_TRADE",
      correctionMode: false,
      summary: { buy: 0, watch: 0, noBuy: 96 },
      strategies: { dipBuyer: { buy: [], watch: [], noBuy: [] }, canslim: { buy: [], watch: [], noBuy: [] } },
    });

    const data = await loadTradingOpsDashboardData({
      backtesterRepoPath: repoPath,
      cortanaRepoPath,
      runJsonCommand: async () => {
        throw new Error("script unavailable");
      },
      tradingRunStateStore: {
        syncFromArtifacts: async () => [],
        loadLatest: async () => ({
          runId: "20260407-160126",
          schemaVersion: 1,
          strategy: "Trading market-session unified",
          status: "success",
          createdAt: "2026-04-07T16:01:26.865Z",
          startedAt: "2026-04-07T16:01:26.865Z",
          completedAt: "2026-04-07T16:10:52.486Z",
          notifiedAt: "2026-04-07T16:11:11.107Z",
          deliveryStatus: "notified",
          decision: "WATCH",
          confidence: 0.9,
          risk: "LOW",
          correctionMode: false,
          buyCount: 0,
          watchCount: 12,
          noBuyCount: 84,
          symbolsScanned: 240,
          candidatesEvaluated: 12,
          focusTicker: "NVDA",
          focusAction: "WATCH",
          focusStrategy: "CANSLIM",
          dipBuyerBuy: [],
          dipBuyerWatch: [],
          dipBuyerNoBuy: [],
          canslimBuy: [],
          canslimWatch: ["NVDA"],
          canslimNoBuy: [],
          artifactDirectory: path.join(cortanaRepoPath, "var", "backtests", "runs", "20260407-160126"),
          summaryPath: path.join(cortanaRepoPath, "var", "backtests", "runs", "20260407-160126", "summary.json"),
          messagePath: null,
          watchlistPath: path.join(cortanaRepoPath, "var", "backtests", "runs", "20260407-160126", "watchlist-full.json"),
          messagePreview: null,
          metrics: { decision: "WATCH" },
          lastError: null,
          sourceHost: "Hs-Mac-mini.local",
        }),
      },
    });

    expect(data.tradingRun.state).toBe("degraded");
    expect(data.tradingRun.badgeText).toBe("fallback");
    expect(data.tradingRun.data?.sourceType).toBe("file_fallback");
    expect(data.tradingRun.message).toContain("Using file fallback because DB-backed trading run state disagrees");
    expect(data.tradingRun.warnings).toContain("DB decision WATCH does not match file decision NO_TRADE for 20260407-160126.");
  });

  it("keeps the DB-backed view when a newer run is still in flight ahead of the latest completed artifact", async () => {
    vi.stubGlobal("fetch", externalServiceFetch);
    const repoPath = await mkdtemp(path.join(os.tmpdir(), "trading-ops-db-inflight-"));
    const cortanaRepoPath = await mkdtemp(path.join(os.tmpdir(), "trading-ops-db-inflight-cortana-"));
    tempDirs.push(repoPath);
    tempDirs.push(cortanaRepoPath);

    await writeJson(path.join(cortanaRepoPath, "var", "backtests", "runs", "20260410-133146", "summary.json"), {
      runId: "20260410-133146",
      status: "success",
      createdAt: "2026-04-10T13:31:46.000Z",
      startedAt: "2026-04-10T13:31:46.000Z",
      completedAt: "2026-04-10T13:49:28.000Z",
      notifiedAt: "2026-04-10T13:50:07.000Z",
      metrics: { decision: "NO_TRADE", correctionMode: false, buy: 0, watch: 1, noBuy: 95 },
    });
    await writeJson(path.join(cortanaRepoPath, "var", "backtests", "runs", "20260410-133146", "watchlist-full.json"), {
      decision: "NO_TRADE",
      correctionMode: false,
      summary: { buy: 0, watch: 1, noBuy: 95 },
      strategies: { dipBuyer: { buy: [], watch: ["SPY"], noBuy: [] }, canslim: { buy: [], watch: [], noBuy: [] } },
    });
    await mkdir(path.join(cortanaRepoPath, "var", "backtests", "runs", "20260410-163223"), { recursive: true });

    const data = await loadTradingOpsDashboardData({
      backtesterRepoPath: repoPath,
      cortanaRepoPath,
      runJsonCommand: async () => {
        throw new Error("script unavailable");
      },
      tradingRunStateStore: {
        syncFromArtifacts: async () => [],
        loadLatest: async () => ({
          runId: "20260410-163223",
          schemaVersion: 1,
          strategy: "Trading market-session unified",
          status: "running",
          createdAt: "2026-04-10T16:32:23.000Z",
          startedAt: "2026-04-10T16:32:23.000Z",
          completedAt: null,
          notifiedAt: null,
          deliveryStatus: "pending",
          decision: "WATCH",
          confidence: 0.8,
          risk: "LOW",
          correctionMode: false,
          buyCount: 0,
          watchCount: 3,
          noBuyCount: 92,
          symbolsScanned: 240,
          candidatesEvaluated: 3,
          focusTicker: "SPY",
          focusAction: "WATCH",
          focusStrategy: "dipBuyer",
          dipBuyerBuy: [],
          dipBuyerWatch: ["SPY", "QQQ", "IWM"],
          dipBuyerNoBuy: [],
          canslimBuy: [],
          canslimWatch: [],
          canslimNoBuy: [],
          artifactDirectory: path.join(cortanaRepoPath, "var", "backtests", "runs", "20260410-163223"),
          summaryPath: path.join(cortanaRepoPath, "var", "backtests", "runs", "20260410-163223", "summary.json"),
          messagePath: null,
          watchlistPath: path.join(cortanaRepoPath, "var", "backtests", "runs", "20260410-163223", "watchlist-full.json"),
          messagePreview: null,
          metrics: { decision: "WATCH" },
          lastError: null,
          sourceHost: "Hs-Mac-mini.local",
        }),
      },
    });

    expect(data.tradingRun.state).toBe("ok");
    expect(data.tradingRun.badgeText).toBeUndefined();
    expect(data.tradingRun.data?.sourceType).toBe("db");
    expect(data.tradingRun.data?.runId).toBe("20260410-163223");
    expect(data.tradingRun.message).toContain("Notification pending.");
  });
});

describe("formatRelativeAge", () => {
  it("formats short and long relative ages", () => {
    const now = Date.now();
    expect(formatRelativeAge(new Date(now - 20_000).toISOString())).toBe("just now");
    expect(formatRelativeAge(new Date(now - 65 * 60_000).toISOString())).toContain("1h");
  });
});
