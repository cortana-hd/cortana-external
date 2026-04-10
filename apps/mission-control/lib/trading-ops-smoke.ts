import { promises as fs } from "node:fs";
import path from "node:path";

export type LatestArtifactRun = {
  runId: string;
  status: string | null;
  decision: string | null;
  buyCount: number;
  watchCount: number;
  noBuyCount: number;
  completedAt: string | null;
  notifiedAt: string | null;
};

type TradingRunLike = {
  runId: string;
  status: string | null;
  completedAt: string | null;
  notifiedAt: string | null;
};

export async function loadLatestArtifactRun(cortanaRepoPath: string): Promise<LatestArtifactRun | null> {
  const runsRoot = path.join(cortanaRepoPath, "var", "backtests", "runs");
  const runDirectories = await findLatestRunDirectories(runsRoot);

  for (const entry of runDirectories) {
    const artifact = await parseArtifactRun(entry.path, entry.runId);
    if (artifact) return artifact;
  }

  return null;
}

export function shouldTolerateInFlightRunAheadOfArtifact(
  tradingRun: TradingRunLike,
  latestArtifact: Pick<LatestArtifactRun, "runId">,
): boolean {
  if (tradingRun.runId === latestArtifact.runId) return false;
  if (!isInFlightTradingRunStatus(tradingRun.status)) return false;
  if (tradingRun.completedAt || tradingRun.notifiedAt) return false;
  return tradingRun.runId > latestArtifact.runId;
}

async function findLatestRunDirectories(rootPath: string): Promise<Array<{ runId: string; path: string }>> {
  try {
    const entries = await fs.readdir(rootPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse()
      .map((runId) => ({ runId, path: path.join(rootPath, runId) }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw error;
  }
}

async function parseArtifactRun(runPath: string, runId: string): Promise<LatestArtifactRun | null> {
  try {
    const [summaryRaw, watchlistRaw] = await Promise.all([
      fs.readFile(path.join(runPath, "summary.json"), "utf8"),
      fs.readFile(path.join(runPath, "watchlist-full.json"), "utf8"),
    ]);

    const summary = JSON.parse(summaryRaw) as Record<string, unknown>;
    const watchlist = JSON.parse(watchlistRaw) as Record<string, unknown>;
    const summaryCounts = asRecord(watchlist.summary);

    return {
      runId,
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
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return null;
    if (error instanceof SyntaxError) return null;
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

function isInFlightTradingRunStatus(status: string | null): boolean {
  return status === "queued" || status === "running" || status === "starting" || status === "finalizing";
}
