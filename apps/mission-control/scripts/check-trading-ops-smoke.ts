import { promises as fs } from "node:fs";
import path from "node:path";
import { loadMissionControlScriptEnv } from "../lib/script-env";

type LatestArtifactRun = {
  runId: string;
  status: string | null;
  decision: string | null;
  buyCount: number;
  watchCount: number;
  noBuyCount: number;
  completedAt: string | null;
  notifiedAt: string | null;
};

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
  if (latestArtifact.runId !== tradingRun.runId) {
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

async function loadLatestArtifactRun(cortanaRepoPath: string): Promise<LatestArtifactRun | null> {
  const runsRoot = path.join(cortanaRepoPath, "var", "backtests", "runs");
  const latest = await findLatestRunDirectory(runsRoot);
  if (!latest) return null;

  const [summaryRaw, watchlistRaw] = await Promise.all([
    fs.readFile(path.join(latest.path, "summary.json"), "utf8"),
    fs.readFile(path.join(latest.path, "watchlist-full.json"), "utf8"),
  ]);

  const summary = JSON.parse(summaryRaw) as Record<string, unknown>;
  const watchlist = JSON.parse(watchlistRaw) as Record<string, unknown>;
  const summaryCounts = asRecord(watchlist.summary);

  return {
    runId: latest.runId,
    status: stringValue(summary.status) ?? (stringValue(summary.completedAt) || stringValue(summary.finalizedAt) ? "success" : null),
    decision: stringValue(watchlist.decision) ?? stringValue(asRecord(summary.metrics)?.decision),
    buyCount: numberValue(summaryCounts?.buy) ?? numberValue(asRecord(summary.metrics)?.buy) ?? 0,
    watchCount: numberValue(summaryCounts?.watch) ?? numberValue(asRecord(summary.metrics)?.watch) ?? 0,
    noBuyCount: numberValue(summaryCounts?.noBuy) ?? numberValue(asRecord(summary.metrics)?.noBuy) ?? 0,
    completedAt:
      stringValue(summary.completedAt) ??
      stringValue(summary.completed_at) ??
      stringValue(summary.finalizedAt) ??
      null,
    notifiedAt: stringValue(summary.notifiedAt) ?? stringValue(summary.notified_at) ?? null,
  };
}

async function findLatestRunDirectory(rootPath: string): Promise<{ runId: string; path: string } | null> {
  try {
    const entries = await fs.readdir(rootPath, { withFileTypes: true });
    const latest = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .at(-1);
    return latest ? { runId: latest, path: path.join(rootPath, latest) } : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw error;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
