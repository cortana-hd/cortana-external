import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { formatRelativeAge, loadTradingOpsDashboardData } from "@/lib/trading-ops";

async function writeJson(filePath: string, payload: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(payload, null, 2));
}

describe("trading ops loader", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map(async (dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("loads mixed live snapshots and persisted artifacts into one dashboard payload", async () => {
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

    const data = await loadTradingOpsDashboardData({ backtesterRepoPath: repoPath, cortanaRepoPath, runJsonCommand });

    expect(data.market.state).toBe("degraded");
    expect(data.market.badgeText).toBeUndefined();
    expect(data.market.data?.focusSymbols).toEqual(["OXY", "GEV", "FANG"]);
    expect(data.runtime.data?.operatorState).toBe("provider_cooldown");
    expect(data.runtime.data?.preOpenGateStatus).toBe("Warn");
    expect(data.runtime.data?.preOpenGateDetail).toBeNull();
    expect(data.canary.data?.warningCount).toBe(1);
    expect(data.prediction.data?.oneDayMatured).toBe(880);
    expect(data.benchmark.data?.horizonKey).toBe("5d");
    expect(data.lifecycle.data?.openCount).toBe(1);
    expect(data.workflow.state).toBe("degraded");
    expect(data.workflow.data?.failedStages).toEqual(["dipbuyer_alert"]);
    expect(data.workflow.data?.runLabel).toBe("Apr 3, 7:16 PM");
    expect(data.workflow.data?.isStale).toBe(false);
    expect(data.opsHighway.data?.criticalAssetCount).toBe(2);
    expect(data.tradingRun.state).toBe("ok");
    expect(data.tradingRun.data?.runLabel).toBe("Apr 3, 12:38 PM");
    expect(data.tradingRun.data?.notifiedAt).toBeNull();
    expect(data.tradingRun.data?.focusTicker).toBe("ABBV");
    expect(data.tradingRun.data?.dipBuyerWatch).toEqual(["ABBV", "ACHV", "AEP", "AEE", "ADM", "AES"]);
    expect(data.tradingRun.data?.dipBuyerBuy).toEqual(["ABC"]);
    expect(data.tradingRun.data?.dipBuyerNoBuy).toEqual(["AAPL", "AMD"]);
    expect(data.tradingRun.data?.canslimBuy).toEqual(["NVDA"]);
    expect(data.tradingRun.data?.canslimWatch).toEqual(["MSFT"]);
    expect(data.tradingRun.data?.canslimNoBuy).toEqual(["TSLA"]);
  });

  it("handles missing artifacts without throwing", async () => {
    const repoPath = await mkdtemp(path.join(os.tmpdir(), "trading-ops-empty-"));
    tempDirs.push(repoPath);

    const data = await loadTradingOpsDashboardData({
      backtesterRepoPath: repoPath,
      cortanaRepoPath: repoPath,
      runJsonCommand: async () => {
        throw new Error("script unavailable");
      },
    });

    expect(data.market.state).toBe("missing");
    expect(data.workflow.state).toBe("missing");
    expect(data.runtime.state).toBe("error");
    expect(data.opsHighway.state).toBe("error");
    expect(data.tradingRun.state).toBe("missing");
  });

  it("marks older market and workflow artifacts as stale when a newer trading run exists", async () => {
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
    });

    expect(data.market.state).toBe("degraded");
    expect(data.market.message).toContain("Latest trading run Apr 7, 10:53 AM finished NO_TRADE");
    expect(data.market.data?.posture).toBe("Stand aside");
    expect(data.market.data?.regime).toBe("active");
    expect(data.market.data?.focusSymbols).toEqual([]);
    expect(data.market.data?.referenceRunLabel).toBe("Apr 7, 10:53 AM");
    expect(data.market.data?.alertSummary).toBe("Latest trading run Apr 7, 10:53 AM: BUY 0 · WATCH 0 · NO_BUY 96");
    expect(data.market.warnings).toContain("Latest trading run Apr 7, 10:53 AM is newer than this market brief.");
    expect(data.workflow.state).toBe("degraded");
    expect(data.workflow.data?.isStale).toBe(true);
    expect(data.workflow.badgeText).toBe("stale");
    expect(data.workflow.data?.referenceRunLabel).toBe("Apr 7, 10:53 AM");
    expect(data.workflow.message).toContain("Latest trading run Apr 7, 10:53 AM completed after this workflow artifact");
    expect(data.workflow.warnings).toContain("Latest trading run Apr 7, 10:53 AM is newer than this workflow artifact.");
  });

  it("renders missing pre-open canary state as not available instead of unknown", async () => {
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
            pre_open_gate_detail: "Pre-open canary artifact is missing at /tmp/pre-open-canary-latest.json.",
            service_health: {
              operator_state: "healthy",
              operator_action: "No operator action required.",
            },
            incident_markers: [],
          };
        }
        throw new Error("script unavailable");
      },
    });

    expect(data.runtime.state).toBe("ok");
    expect(data.runtime.data?.preOpenGateStatus).toBe("Canary not available");
    expect(data.runtime.data?.preOpenGateDetail).toContain("Pre-open canary artifact is missing");
  });
});

describe("formatRelativeAge", () => {
  it("formats short and long relative ages", () => {
    const now = Date.now();
    expect(formatRelativeAge(new Date(now - 20_000).toISOString())).toBe("just now");
    expect(formatRelativeAge(new Date(now - 65 * 60_000).toISOString())).toContain("1h");
  });
});
