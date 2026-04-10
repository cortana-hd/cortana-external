import path from "node:path";
import { loadMissionControlScriptEnv } from "../lib/script-env";
import { loadLatestArtifactRun, shouldTolerateInFlightRunAheadOfArtifact } from "../lib/trading-ops-smoke";

async function main() {
  loadMissionControlScriptEnv(path.resolve(__dirname, ".."));
  const [{ loadTradingOpsDashboardData }, { getCortanaSourceRepo }] = await Promise.all([
    import("../lib/trading-ops"),
    import("../lib/runtime-paths"),
  ]);
  const data = await loadTradingOpsDashboardData();
  const latestArtifact = await loadLatestArtifactRun(getCortanaSourceRepo());
  const tradingRun = data.tradingRun.data;

  if (!tradingRun) {
    throw new Error("Trading Ops smoke check failed: latest trading run card has no data.");
  }
  if (!latestArtifact) {
    throw new Error("Trading Ops smoke check failed: no latest artifact run found.");
  }
  if (data.tradingRun.badgeText === "fallback" || tradingRun.sourceType !== "db") {
    throw new Error(`Trading Ops smoke check failed: latest run is not DB-backed (sourceType=${tradingRun.sourceType}, badge=${data.tradingRun.badgeText ?? "none"}).`);
  }
  if (data.tradingRun.state !== "ok") {
    throw new Error(`Trading Ops smoke check failed: latest run card is ${data.tradingRun.state}.`);
  }
  const tolerateInFlightLag = shouldTolerateInFlightRunAheadOfArtifact(tradingRun, latestArtifact);
  if (latestArtifact.runId !== tradingRun.runId) {
    if (tolerateInFlightLag) {
      console.log("Trading Ops smoke check passed.");
      console.log(`Latest DB run ${tradingRun.runId} is still in flight; latest completed artifact remains ${latestArtifact.runId}.`);
      console.log(`Runtime: ${data.runtime.data?.operatorState ?? data.runtime.label} | ${data.runtime.message}`);
      return;
    }
    throw new Error(`Trading Ops smoke check failed: dashboard run ${tradingRun.runId} does not match artifact run ${latestArtifact.runId}.`);
  }
  if ((latestArtifact.status ?? "unknown") !== tradingRun.status) {
    throw new Error(`Trading Ops smoke check failed: dashboard status ${tradingRun.status} does not match artifact status ${latestArtifact.status ?? "unknown"}.`);
  }
  if ((latestArtifact.decision ?? "unknown") !== tradingRun.decision) {
    throw new Error(`Trading Ops smoke check failed: dashboard decision ${tradingRun.decision} does not match artifact decision ${latestArtifact.decision ?? "unknown"}.`);
  }
  if (latestArtifact.buyCount !== tradingRun.buyCount || latestArtifact.watchCount !== tradingRun.watchCount || latestArtifact.noBuyCount !== tradingRun.noBuyCount) {
    throw new Error(
      `Trading Ops smoke check failed: dashboard counts BUY ${tradingRun.buyCount} / WATCH ${tradingRun.watchCount} / NO_BUY ${tradingRun.noBuyCount} do not match artifact counts BUY ${latestArtifact.buyCount} / WATCH ${latestArtifact.watchCount} / NO_BUY ${latestArtifact.noBuyCount}.`,
    );
  }
  if ((latestArtifact.completedAt ?? null) !== tradingRun.completedAt) {
    throw new Error(`Trading Ops smoke check failed: dashboard completedAt ${tradingRun.completedAt ?? "null"} does not match artifact completedAt ${latestArtifact.completedAt ?? "null"}.`);
  }
  if ((latestArtifact.notifiedAt ?? null) !== tradingRun.notifiedAt) {
    throw new Error(`Trading Ops smoke check failed: dashboard notifiedAt ${tradingRun.notifiedAt ?? "null"} does not match artifact notifiedAt ${latestArtifact.notifiedAt ?? "null"}.`);
  }
  if (data.runtime.state === "error") {
    throw new Error(`Trading Ops smoke check failed: runtime card is in error state (${data.runtime.message}).`);
  }

  console.log("Trading Ops smoke check passed.");
  console.log(`Latest run: ${tradingRun.runId} (${tradingRun.runLabel})`);
  console.log(`Decision/counts: ${tradingRun.decision} | BUY ${tradingRun.buyCount} · WATCH ${tradingRun.watchCount} · NO_BUY ${tradingRun.noBuyCount}`);
  console.log(`Delivery: ${tradingRun.notifiedAt ?? "not notified"}`);
  console.log(`Runtime: ${data.runtime.data?.operatorState ?? data.runtime.label} | ${data.runtime.message}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
