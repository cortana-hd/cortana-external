import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getBacktesterRepoPath, getCortanaSourceRepo } from "@/lib/runtime-paths";

const execFileAsync = promisify(execFile);
const JSON_TIMEOUT_MS = 10_000;

export type LoadState = "ok" | "degraded" | "missing" | "error";

export type ArtifactState<T> = {
  state: LoadState;
  label: string;
  message: string;
  data: T | null;
  source?: string;
  updatedAt?: string | null;
  warnings: string[];
};

export type MarketOverview = {
  posture: string;
  reason: string;
  regime: string;
  regimeStatus: string;
  positionSizingPct: number | null;
  focusSymbols: string[];
  leaderSource: string;
  alertSummary: string;
  nextAction: string | null;
};

export type RuntimeOverview = {
  operatorState: string;
  operatorAction: string;
  preOpenGateStatus: string | null;
  incidents: Array<{ incidentType: string; severity: string; operatorAction: string }>;
};

export type CanaryOverview = {
  readyForOpen: boolean | null;
  result: string | null;
  warningCount: number;
  checks: Array<{ name: string; result: string }>;
};

export type PredictionOverview = {
  snapshotCount: number;
  recordCount: number;
  oneDayMatured: number;
  oneDayPending: number;
  bestStrategyLabel: string | null;
  decisionGradeHeadline: string | null;
};

export type BenchmarkOverview = {
  horizonKey: string | null;
  maturedCount: number | null;
  bestComparisonLabel: string | null;
};

export type LifecycleOverview = {
  openCount: number;
  closedCount: number;
  totalCapital: number | null;
  availableCapital: number | null;
  grossExposurePct: number | null;
};

export type WorkflowOverview = {
  runId: string;
  stageCounts: Record<string, number>;
  failedStages: string[];
  stageRows: Array<{ name: string; status: string; startedAt: string; endedAt: string }>;
  artifactRows: Array<{ name: string; kind: string; location: string }>;
  canslimSummary: string | null;
};

export type OpsHighwayOverview = {
  criticalAssetCount: number;
  doNotCommitCount: number;
  firstRecoveryStep: string | null;
};

export type TradingRunOverview = {
  runId: string;
  decision: string;
  focusTicker: string | null;
  focusAction: string | null;
  focusStrategy: string | null;
  watchCount: number;
  buyCount: number;
  noBuyCount: number;
  dipBuyerWatch: string[];
  dipBuyerBuy: string[];
  dipBuyerNoBuy: string[];
  canslimWatch: string[];
  canslimBuy: string[];
  canslimNoBuy: string[];
  messagePreview: string | null;
};

export type TradingOpsDashboardData = {
  generatedAt: string;
  repoPath: string;
  cortanaRepoPath: string;
  market: ArtifactState<MarketOverview>;
  runtime: ArtifactState<RuntimeOverview>;
  canary: ArtifactState<CanaryOverview>;
  prediction: ArtifactState<PredictionOverview>;
  benchmark: ArtifactState<BenchmarkOverview>;
  lifecycle: ArtifactState<LifecycleOverview>;
  workflow: ArtifactState<WorkflowOverview>;
  opsHighway: ArtifactState<OpsHighwayOverview>;
  tradingRun: ArtifactState<TradingRunOverview>;
};

type LoaderOptions = {
  backtesterRepoPath?: string;
  cortanaRepoPath?: string;
  runJsonCommand?: (scriptPath: string, args?: string[]) => Promise<unknown>;
};

export async function loadTradingOpsDashboardData(
  options: LoaderOptions = {},
): Promise<TradingOpsDashboardData> {
  const repoPath = options.backtesterRepoPath ?? getBacktesterRepoPath();
  const cortanaRepoPath = options.cortanaRepoPath ?? getCortanaSourceRepo();
  const runJsonCommand = options.runJsonCommand ?? ((scriptPath: string, args: string[] = ["--pretty"]) =>
    runBacktesterJsonScript(repoPath, scriptPath, args));

  const [
    market,
    runtime,
    canary,
    prediction,
    benchmark,
    lifecycle,
    workflow,
    opsHighway,
    tradingRun,
  ] = await Promise.all([
    loadMarketOverview(repoPath),
    loadRuntimeOverview(repoPath, runJsonCommand),
    loadCanaryOverview(repoPath),
    loadPredictionOverview(repoPath),
    loadBenchmarkOverview(repoPath),
    loadLifecycleOverview(repoPath),
    loadWorkflowOverview(repoPath),
    loadOpsHighwayOverview(repoPath, runJsonCommand),
    loadTradingRunOverview(cortanaRepoPath),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    repoPath,
    cortanaRepoPath,
    market,
    runtime,
    canary,
    prediction,
    benchmark,
    lifecycle,
    workflow,
    opsHighway,
    tradingRun,
  };
}

export function summarizeStateVariant(state: LoadState): "success" | "warning" | "destructive" | "outline" {
  if (state === "ok") return "success";
  if (state === "degraded") return "warning";
  if (state === "error") return "destructive";
  return "outline";
}

export function formatRelativeAge(iso: string | null | undefined): string {
  if (!iso) return "unknown age";
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return "unknown age";
  const deltaMs = Date.now() - timestamp;
  if (deltaMs < 60_000) return "just now";
  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;
  if (hours < 48) return remainderMinutes === 0 ? `${hours}h ago` : `${hours}h ${remainderMinutes}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "n/a";
  return `${value.toFixed(1)}%`;
}

export function formatMoney(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "n/a";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

async function loadMarketOverview(repoPath: string): Promise<ArtifactState<MarketOverview>> {
  const regimePath = path.join(repoPath, ".cache", "market_regime_snapshot_SPY.json");
  const leaderPath = path.join(repoPath, "var", "local-workflows");
  const regime = await readJsonFile<Record<string, unknown>>(regimePath);
  const workflow = await findLatestWorkflow(repoPath);
  const latestAlert = workflow
    ? await readJsonFile<Record<string, unknown>>(path.join(workflow.path, "canslim-alert.json"))
    : null;
  const leaderBaskets = workflow
    ? await readJsonFile<Record<string, unknown>>(path.join(workflow.path, "leader-baskets-raw.json"))
    : null;

  const marketStatus = asRecord(regime?.data?.market_status);
  const alertData = asRecord(latestAlert?.data);
  const summary = asRecord(alertData?.summary);
  const market = asRecord(alertData?.market);
  const windows = asRecord(leaderBaskets?.data?.buckets);
  const monthly = asArray(windows?.monthly);
  const focusSymbols = monthly
    .slice(0, 3)
    .map((entry) => asRecord(entry)?.symbol)
    .filter((value): value is string => typeof value === "string");

  if (!marketStatus && !market) {
    return {
      state: "missing",
      label: "No market artifact",
      message: "Backtester has not produced a market regime snapshot yet.",
      data: null,
      source: regimePath,
      warnings: [],
    };
  }

  const regimeLabel = stringValue(market?.regime) ?? stringValue(marketStatus?.regime) ?? "unknown";
  const notes = stringValue(market?.notes) ?? stringValue(marketStatus?.notes) ?? "No posture note available.";
  const status = stringValue(market?.status) ?? stringValue(marketStatus?.status) ?? "unknown";
  const positionSizing = numberValue(market?.position_sizing) ?? numberValue(marketStatus?.position_sizing);
  const renderLines = asArray(alertData?.render_lines).map((line) => String(line));

  return {
    state: status === "degraded" ? "degraded" : "ok",
    label: regimeLabel.toUpperCase(),
    message: notes,
    source: latestAlert?.path ?? regimePath,
    updatedAt:
      stringValue(alertData?.generated_at) ??
      stringValue(regime?.data?.generated_at_utc) ??
      null,
    warnings: compactStrings([
      stringValue(market?.degraded_reason),
      stringValue(marketStatus?.degraded_reason),
    ]),
    data: {
      posture: stringValue(alertData?.degraded_status) === "degraded_safe" ? "Stand aside" : "Review",
      reason: notes,
      regime: regimeLabel,
      regimeStatus: status,
      positionSizingPct: positionSizing == null ? null : positionSizing * 100,
      focusSymbols,
      leaderSource: focusSymbols.length > 0 ? "leader baskets" : "none yet",
      alertSummary:
        renderLines.find((line) => line.startsWith("Summary:")) ??
        renderLines.find((line) => line.includes("BUY")) ??
        summaryLineFromCounts(summary),
      nextAction: stringValue(market?.next_action) ?? stringValue(marketStatus?.next_action),
    },
  };
}

async function loadRuntimeOverview(
  repoPath: string,
  runJsonCommand: (scriptPath: string, args?: string[]) => Promise<unknown>,
): Promise<ArtifactState<RuntimeOverview>> {
  const scriptPath = path.join(repoPath, "runtime_health_snapshot.py");

  try {
    const raw = await runJsonCommand(scriptPath);
    const data = asRecord(raw);
    const service = asRecord(data?.service_health);
    const incidentMarkers = asArray(data?.incident_markers);
    const incidents = incidentMarkers
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      .map((entry) => ({
        incidentType: stringValue(entry.incident_type) ?? "unknown",
        severity: stringValue(entry.severity) ?? "unknown",
        operatorAction: stringValue(entry.operator_action) ?? "No operator action provided.",
      }));
    const operatorState = stringValue(service?.operator_state) ?? "unknown";
    const state: LoadState = operatorState === "healthy" ? "ok" : "degraded";

    return {
      state,
      label: operatorState,
      message: stringValue(service?.operator_action) ?? "No operator action required.",
      data: {
        operatorState,
        operatorAction: stringValue(service?.operator_action) ?? "No operator action required.",
        preOpenGateStatus: stringValue(data?.pre_open_gate_status),
        incidents,
      },
      source: scriptPath,
      updatedAt: stringValue(data?.generated_at),
      warnings: incidents.map((incident) => `${incident.incidentType}:${incident.severity}`),
    };
  } catch (error) {
    return {
      state: "error",
      label: "Runtime unavailable",
      message: formatError(error),
      data: null,
      source: scriptPath,
      warnings: [],
    };
  }
}

async function loadCanaryOverview(repoPath: string): Promise<ArtifactState<CanaryOverview>> {
  const canaryPath = path.join(repoPath, "var", "readiness", "pre-open-canary-latest.json");
  const canary = await readJsonFile<Record<string, unknown>>(canaryPath);

  if (!canary?.data) {
    return {
      state: canary?.error === "missing" ? "missing" : "error",
      label: "Canary unavailable",
      message: canary?.message ?? "Pre-open canary artifact is missing.",
      data: null,
      source: canaryPath,
      warnings: [],
    };
  }

  const data = canary.data;
  const checks = asArray(data.checks)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => ({
      name: stringValue(entry.name) ?? "unknown",
      result: stringValue(entry.result) ?? "unknown",
    }));
  const status = stringValue(data.status) ?? "unknown";

  return {
    state: status === "ok" ? "ok" : "degraded",
    label: stringValue(data.result) ?? status,
    message: checks.length > 0 ? `${checks.filter((check) => check.result !== "ok").length} checks need attention.` : "No canary checks recorded.",
    data: {
      readyForOpen: booleanValue(data.ready_for_open),
      result: stringValue(data.result),
      warningCount: asArray(data.warnings).length,
      checks,
    },
    source: canaryPath,
    updatedAt: stringValue(data.generated_at) ?? stringValue(data.checked_at),
    warnings: asArray(data.warnings).map(String),
  };
}

async function loadPredictionOverview(repoPath: string): Promise<ArtifactState<PredictionOverview>> {
  const reportPath = path.join(repoPath, ".cache", "prediction_accuracy", "reports", "prediction-accuracy-latest.json");
  const report = await readJsonFile<Record<string, unknown>>(reportPath);
  if (!report?.data) {
    return {
      state: report?.error === "missing" ? "missing" : "error",
      label: "No prediction report",
      message: report?.message ?? "Prediction accuracy report not found.",
      data: null,
      source: reportPath,
      warnings: [],
    };
  }

  const data = report.data;
  const horizonStatus = asRecord(asRecord(data.horizon_status)?.["1d"]);
  const summary = asArray(data.summary);
  const bestStrategy = summary
    .map((entry) => asRecord(entry))
    .find((entry) => asRecord(entry?.["1d"]));
  const gradeCounts = asRecord(data.validation_grade_counts);
  const tradeGradeCounts = asRecord(gradeCounts?.trade_validation_grade);

  return {
    state: "ok",
    label: "Prediction loop",
    message: `${numberValue(data.snapshot_count) ?? 0} snapshots, ${numberValue(data.record_count) ?? 0} settled records tracked.`,
    data: {
      snapshotCount: numberValue(data.snapshot_count) ?? 0,
      recordCount: numberValue(data.record_count) ?? 0,
      oneDayMatured: numberValue(horizonStatus?.matured) ?? 0,
      oneDayPending: numberValue(horizonStatus?.pending) ?? 0,
      bestStrategyLabel: bestStrategy
        ? `${stringValue(bestStrategy.strategy)} ${stringValue(bestStrategy.action) ?? ""}`.trim()
        : null,
      decisionGradeHeadline: tradeGradeCounts
        ? Object.entries(tradeGradeCounts)
            .map(([grade, count]) => `${grade}:${count}`)
            .join(" · ")
        : null,
    },
    source: reportPath,
    updatedAt: stringValue(data.generated_at),
    warnings: [],
  };
}

async function loadBenchmarkOverview(repoPath: string): Promise<ArtifactState<BenchmarkOverview>> {
  const benchmarkPath = path.join(repoPath, ".cache", "prediction_accuracy", "reports", "benchmark-comparison-latest.json");
  const benchmark = await readJsonFile<Record<string, unknown>>(benchmarkPath);
  if (!benchmark?.data) {
    return {
      state: benchmark?.error === "missing" ? "missing" : "error",
      label: "No benchmark artifact",
      message: benchmark?.message ?? "Benchmark comparison artifact not found.",
      data: null,
      source: benchmarkPath,
      warnings: [],
    };
  }

  const data = benchmark.data;
  const comparisons = asRecord(data.comparisons);
  const byStrategy = asArray(comparisons?.by_strategy)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  const firstWithMatured = byStrategy.find((entry) => numberValue(asRecord(entry.metrics)?.matured_count));

  return {
    state: "ok",
    label: "Benchmark comparisons",
    message: `Primary horizon ${stringValue(data.horizon_key) ?? "unknown"}.`,
    data: {
      horizonKey: stringValue(data.horizon_key),
      maturedCount: numberValue(asRecord(data.baselines)?.all_predictions && asRecord(asRecord(data.baselines)?.all_predictions)?.matured_count),
      bestComparisonLabel: firstWithMatured
        ? `${stringValue(firstWithMatured.strategy)} vs baseline`
        : null,
    },
    source: benchmarkPath,
    updatedAt: stringValue(data.generated_at),
    warnings: [],
  };
}

async function loadLifecycleOverview(repoPath: string): Promise<ArtifactState<LifecycleOverview>> {
  const cyclePath = path.join(repoPath, ".cache", "trade_lifecycle", "cycle_summary.json");
  const cycle = await readJsonFile<Record<string, unknown>>(cyclePath);

  if (!cycle?.data) {
    return {
      state: cycle?.error === "missing" ? "missing" : "error",
      label: "No lifecycle summary",
      message: cycle?.message ?? "Trade lifecycle summary not found.",
      data: null,
      source: cyclePath,
      warnings: [],
    };
  }

  const data = cycle.data;
  const summary = asRecord(data.summary);
  const portfolioSnapshot = asRecord(data.portfolio_snapshot);

  return {
    state: "ok",
    label: "Paper lifecycle",
    message: `${numberValue(summary?.open_count) ?? 0} open, ${numberValue(summary?.closed_total_count) ?? 0} closed.`,
    data: {
      openCount: numberValue(summary?.open_count) ?? 0,
      closedCount: numberValue(summary?.closed_total_count) ?? 0,
      totalCapital: numberValue(portfolioSnapshot?.total_capital),
      availableCapital: numberValue(portfolioSnapshot?.available_capital),
      grossExposurePct: numberValue(portfolioSnapshot?.gross_exposure_pct) == null ? null : (numberValue(portfolioSnapshot?.gross_exposure_pct) ?? 0) * 100,
    },
    source: cyclePath,
    updatedAt: stringValue(data.generated_at),
    warnings: [],
  };
}

async function loadWorkflowOverview(repoPath: string): Promise<ArtifactState<WorkflowOverview>> {
  const latestWorkflow = await findLatestWorkflow(repoPath);
  if (!latestWorkflow) {
    return {
      state: "missing",
      label: "No workflow run",
      message: "No local workflow runs found yet.",
      data: null,
      source: path.join(repoPath, "var", "local-workflows"),
      warnings: [],
    };
  }

  const stagesPath = path.join(latestWorkflow.path, "run-manifest-stages.tsv");
  const artifactsPath = path.join(latestWorkflow.path, "run-manifest-artifacts.tsv");
  const [stagesRaw, artifactsRaw] = await Promise.all([
    readTextIfExists(stagesPath),
    readTextIfExists(artifactsPath),
  ]);
  const stageRows = parseTsvRows(stagesRaw, 4).map((row) => ({
    name: row[0] ?? "unknown",
    status: row[1] ?? "unknown",
    startedAt: row[2] ?? "",
    endedAt: row[3] ?? "",
  }));
  const artifactRows = parseTsvRows(artifactsRaw, 3).map((row) => ({
    name: row[0] ?? "unknown",
    kind: row[1] ?? "unknown",
    location: row[2] ?? "",
  }));
  const failedStages = stageRows.filter((row) => row.status === "error" || row.status === "failed").map((row) => row.name);
  const stageCounts = stageRows.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});
  const canslimArtifact = await readJsonFile<Record<string, unknown>>(path.join(latestWorkflow.path, "canslim-alert.json"));

  return {
    state: failedStages.length > 0 ? "degraded" : "ok",
    label: latestWorkflow.runId,
    message: failedStages.length > 0 ? `Failed stages: ${failedStages.join(", ")}` : "Latest workflow completed without stage failures.",
    data: {
      runId: latestWorkflow.runId,
      stageCounts,
      failedStages,
      stageRows,
      artifactRows: artifactRows.slice(0, 8),
      canslimSummary:
        asArray(canslimArtifact?.data?.render_lines)
          .map(String)
          .find((line) => line.startsWith("Summary:")) ?? null,
    },
    source: latestWorkflow.path,
    updatedAt: stageRows.at(-1)?.endedAt ?? null,
    warnings: failedStages,
  };
}

async function loadOpsHighwayOverview(
  repoPath: string,
  runJsonCommand: (scriptPath: string, args?: string[]) => Promise<unknown>,
): Promise<ArtifactState<OpsHighwayOverview>> {
  const scriptPath = path.join(repoPath, "ops_highway_snapshot.py");
  try {
    const raw = await runJsonCommand(scriptPath);
    const data = asRecord(raw);
    const backupRestore = asRecord(data?.backup_restore);
    const criticalAssets = asArray(backupRestore?.critical_assets);
    const recovery = asArray(backupRestore?.minimum_recovery_sequence);
    const doNotCommit = asArray(backupRestore?.do_not_commit_paths);

    return {
      state: "ok",
      label: "Ops highway",
      message: `${criticalAssets.length} critical assets tracked for recovery.`,
      data: {
        criticalAssetCount: criticalAssets.length,
        doNotCommitCount: doNotCommit.length,
        firstRecoveryStep: typeof recovery[0] === "string" ? recovery[0] : null,
      },
      source: scriptPath,
      updatedAt: stringValue(data?.generated_at),
      warnings: [],
    };
  } catch (error) {
    return {
      state: "error",
      label: "Ops highway unavailable",
      message: formatError(error),
      data: null,
      source: scriptPath,
      warnings: [],
    };
  }
}

async function loadTradingRunOverview(cortanaRepoPath: string): Promise<ArtifactState<TradingRunOverview>> {
  const runsRoot = path.join(cortanaRepoPath, "var", "backtests", "runs");
  const latestRun = await findLatestRunDirectory(runsRoot);

  if (!latestRun) {
    return {
      state: "missing",
      label: "No trading runs",
      message: "No trading backtest runs have been written yet.",
      data: null,
      source: runsRoot,
      warnings: [],
    };
  }

  const [summary, watchlist, message] = await Promise.all([
    readJsonFile<Record<string, unknown>>(path.join(latestRun.path, "summary.json")),
    readJsonFile<Record<string, unknown>>(path.join(latestRun.path, "watchlist-full.json")),
    readTextIfExists(path.join(latestRun.path, "message.txt")),
  ]);

  const summaryData = summary.data;
  const watchlistData = watchlist.data;
  if (!summaryData || !watchlistData) {
    return {
      state: "degraded",
      label: latestRun.runId,
      message: "Latest run is missing summary or watchlist artifacts.",
      data: null,
      source: latestRun.path,
      updatedAt: stringValue(summaryData?.completedAt) ?? stringValue(summaryData?.completed_at) ?? null,
      warnings: compactStrings([summary.message, watchlist.message]),
    };
  }

  const focus = asRecord(watchlistData.focus);
  const strategies = asRecord(watchlistData.strategies);
  const dipBuyer = asRecord(strategies?.dipBuyer);
  const canslim = asRecord(strategies?.canslim);
  const dipBuyerWatch = extractTickers(dipBuyer?.watch);
  const dipBuyerBuy = extractTickers(dipBuyer?.buy);
  const dipBuyerNoBuy = extractTickers(dipBuyer?.noBuy);
  const canslimWatch = extractTickers(canslim?.watch);
  const canslimBuy = extractTickers(canslim?.buy);
  const canslimNoBuy = extractTickers(canslim?.noBuy);

  return {
    state: "ok",
    label: latestRun.runId,
    message: `Latest trading run finished with ${stringValue(watchlistData.decision) ?? "unknown"} and ${numberValue(asRecord(watchlistData.summary)?.watch) ?? 0} watch names.`,
    source: latestRun.path,
    updatedAt:
      stringValue(summaryData.completedAt) ??
      stringValue(summaryData.completed_at) ??
      stringValue(summaryData.finalizedAt) ??
      null,
    warnings: [],
    data: {
      runId: latestRun.runId,
      decision: stringValue(watchlistData.decision) ?? "unknown",
      focusTicker: stringValue(focus?.ticker),
      focusAction: stringValue(focus?.action),
      focusStrategy: stringValue(focus?.strategy),
      watchCount: numberValue(asRecord(watchlistData.summary)?.watch) ?? 0,
      buyCount: numberValue(asRecord(watchlistData.summary)?.buy) ?? 0,
      noBuyCount: numberValue(asRecord(watchlistData.summary)?.noBuy) ?? 0,
      dipBuyerWatch,
      dipBuyerBuy,
      dipBuyerNoBuy,
      canslimWatch,
      canslimBuy,
      canslimNoBuy,
      messagePreview: message ? message.split(/\r?\n/).slice(0, 6).join("\n") : null,
    },
  };
}

async function runBacktesterJsonScript(
  repoPath: string,
  scriptPath: string,
  args: string[],
): Promise<unknown> {
  const { stdout } = await execFileAsync("uv", ["run", "python", scriptPath, ...args], {
    cwd: path.dirname(repoPath),
    timeout: JSON_TIMEOUT_MS,
    maxBuffer: 1024 * 1024 * 4,
  });
  return JSON.parse(stdout);
}

async function readJsonFile<T>(filePath: string): Promise<{ path: string; data: T | null; message?: string; error?: "missing" | "invalid" | "read" }> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return { path: filePath, data: JSON.parse(raw) as T };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return { path: filePath, data: null, error: "missing", message: "File not found." };
    }
    if (error instanceof SyntaxError) {
      return { path: filePath, data: null, error: "invalid", message: "Could not parse JSON artifact." };
    }
    return { path: filePath, data: null, error: "read", message: formatError(error) };
  }
}

async function readTextIfExists(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return "";
    throw error;
  }
}

async function findLatestWorkflow(repoPath: string): Promise<{ runId: string; path: string } | null> {
  const workflowRoot = path.join(repoPath, "var", "local-workflows");
  try {
    const entries = await fs.readdir(workflowRoot, { withFileTypes: true });
    const latest = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .at(-1);
    return latest ? { runId: latest, path: path.join(workflowRoot, latest) } : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw error;
  }
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

function parseTsvRows(contents: string, columns: number): string[][] {
  return contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const cells = line.split("\t");
      while (cells.length < columns) cells.push("");
      return cells.slice(0, columns);
    });
}

function summaryLineFromCounts(summary: Record<string, unknown> | null | undefined): string {
  if (!summary) return "No recent strategy summary.";
  return [
    `BUY ${numberValue(summary.buy_count) ?? 0}`,
    `WATCH ${numberValue(summary.watch_count) ?? 0}`,
    `NO_BUY ${numberValue(summary.no_buy_count) ?? 0}`,
  ].join(" · ");
}

function extractTickers(value: unknown): string[] {
  return asArray(value)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => stringValue(entry.ticker))
    .filter((ticker): ticker is string => Boolean(ticker));
}

function compactStrings(values: Array<string | null | undefined>): string[] {
  return values.filter((value): value is string => Boolean(value && value.trim()));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
