import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { formatOperatorTimestamp, formatRelativeAge } from "@/lib/format-utils";
import { getBacktesterRepoPath, getCortanaSourceRepo } from "@/lib/runtime-paths";
import { shouldTolerateInFlightRunAheadOfArtifact } from "@/lib/trading-ops-smoke";
import {
  prismaTradingRunStateStore,
  type TradingRunStateRecord,
  type TradingRunStateStore,
} from "@/lib/trading-run-state";

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
  badgeText?: string;
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
  isStale: boolean;
  referenceRunLabel: string | null;
  referenceDecision: string | null;
};

export type RuntimeOverview = {
  operatorState: string;
  operatorAction: string;
  preOpenGateStatus: string | null;
  preOpenGateDetail: string | null;
  preOpenGateFreshness: string | null;
  cooldownSummary: string | null;
  providerModeSummary: string | null;
  incidents: Array<{ incidentType: string; severity: string; operatorAction: string }>;
};

export type CanaryOverview = {
  readyForOpen: boolean | null;
  result: string | null;
  warningCount: number;
  checkedAt: string | null;
  freshness: string;
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
  runLabel: string;
  stageCounts: Record<string, number>;
  failedStages: string[];
  stageRows: Array<{ name: string; status: string; startedAt: string; endedAt: string }>;
  artifactRows: Array<{ name: string; kind: string; location: string }>;
  canslimSummary: string | null;
  isStale: boolean;
  referenceRunLabel: string | null;
};

export type OpsHighwayOverview = {
  criticalAssetCount: number;
  doNotCommitCount: number;
  firstRecoveryStep: string | null;
};

export type TradingRunOverview = {
  runId: string;
  runLabel: string;
  status: string;
  deliveryStatus: string | null;
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
  completedAt: string | null;
  notifiedAt: string | null;
  correctionMode: boolean | null;
  lastError: string | null;
  sourceType: "db" | "file_fallback" | "artifact";
};

type TradingRunSignal = {
  runId: string;
  runLabel: string;
  updatedAt: string | null;
  decision: string;
  buyCount: number;
  watchCount: number;
  noBuyCount: number;
  correctionMode: boolean | null;
  source: string | null;
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
  tradingRunStateStore?: TradingRunStateStore | null;
};

export async function loadTradingOpsDashboardData(
  options: LoaderOptions = {},
): Promise<TradingOpsDashboardData> {
  const repoPath = options.backtesterRepoPath ?? getBacktesterRepoPath();
  const cortanaRepoPath = options.cortanaRepoPath ?? getCortanaSourceRepo();
  const runJsonCommand = options.runJsonCommand ?? ((scriptPath: string, args: string[] = ["--pretty"]) =>
    runBacktesterJsonScript(repoPath, scriptPath, args));
  const tradingRun = await loadTradingRunOverview(cortanaRepoPath, options.tradingRunStateStore);
  const tradingRunSignal = asTradingRunSignal(tradingRun);

  const [
    market,
    runtime,
    canary,
    prediction,
    benchmark,
    lifecycle,
    workflow,
    opsHighway,
  ] = await Promise.all([
    loadMarketOverview(repoPath, tradingRunSignal),
    loadRuntimeOverview(repoPath, runJsonCommand),
    loadCanaryOverview(repoPath),
    loadPredictionOverview(repoPath),
    loadBenchmarkOverview(repoPath),
    loadLifecycleOverview(repoPath),
    loadWorkflowOverview(repoPath, tradingRunSignal),
    loadOpsHighwayOverview(repoPath, runJsonCommand),
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

export async function loadLatestTradingRunOverview(
  options: {
    cortanaRepoPath?: string;
    tradingRunStateStore?: TradingRunStateStore | null;
  } = {},
): Promise<ArtifactState<TradingRunOverview>> {
  const cortanaRepoPath = options.cortanaRepoPath ?? getCortanaSourceRepo();
  return loadTradingRunOverview(cortanaRepoPath, options.tradingRunStateStore ?? null);
}

export function summarizeStateVariant(state: LoadState): "success" | "warning" | "destructive" | "outline" {
  if (state === "ok") return "success";
  if (state === "degraded") return "warning";
  if (state === "error") return "destructive";
  return "outline";
}

export {
  formatRelativeAge,
  formatPercentDecimal as formatPercent,
  formatCurrency as formatMoney,
  formatOperatorTimestamp,
} from "@/lib/format-utils";

async function loadMarketOverview(
  repoPath: string,
  tradingRunSignal: TradingRunSignal | null,
): Promise<ArtifactState<MarketOverview>> {
  const regimePath = path.join(repoPath, ".cache", "market_regime_snapshot_SPY.json");
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
  const updatedAt =
    stringValue(alertData?.generated_at) ??
    stringValue(regime?.data?.generated_at_utc) ??
    null;
  const staleAgainstTradingRun = isArtifactOlderThanTradingRun(updatedAt, tradingRunSignal);
  const message = staleAgainstTradingRun && tradingRunSignal
    ? `Latest trading run ${tradingRunSignal.runLabel} finished ${tradingRunSignal.decision}; this market brief is older and now treated as supporting context only.`
    : notes;

  return {
    state: staleAgainstTradingRun || status === "degraded" ? "degraded" : "ok",
    label: regimeLabel.toUpperCase(),
    message,
    source: latestAlert?.path ?? regimePath,
    updatedAt,
    badgeText: staleAgainstTradingRun ? "stale" : undefined,
    warnings: compactStrings([
      stringValue(market?.degraded_reason),
      stringValue(marketStatus?.degraded_reason),
      staleAgainstTradingRun && tradingRunSignal
        ? `Latest trading run ${tradingRunSignal.runLabel} is newer than this market brief.`
        : null,
    ]),
    data: {
      posture:
        staleAgainstTradingRun && tradingRunSignal
          ? postureFromTradingDecision(tradingRunSignal.decision)
          : stringValue(alertData?.degraded_status) === "degraded_safe"
            ? "Stand aside"
            : "Review",
      reason: message,
      regime: staleAgainstTradingRun ? regimeFromTradingRunSignal(tradingRunSignal, regimeLabel) : regimeLabel,
      regimeStatus: staleAgainstTradingRun ? "current_run" : status,
      positionSizingPct:
        staleAgainstTradingRun
          ? positionSizingPctFromTradingDecision(tradingRunSignal?.decision)
          : positionSizing == null
            ? null
            : positionSizing * 100,
      focusSymbols: staleAgainstTradingRun ? [] : focusSymbols,
      leaderSource: staleAgainstTradingRun ? "latest trading run" : focusSymbols.length > 0 ? "leader baskets" : "none yet",
      alertSummary:
        (staleAgainstTradingRun && tradingRunSignal ? summarizeTradingRunSignal(tradingRunSignal) : null) ??
        renderLines.find((line) => line.startsWith("Summary:")) ??
        renderLines.find((line) => line.includes("BUY")) ??
        summaryLineFromCounts(summary),
      nextAction:
        (staleAgainstTradingRun && tradingRunSignal
          ? "Use the latest trading run and live runtime health until the market brief refreshes."
          : null) ??
        stringValue(market?.next_action) ??
        stringValue(marketStatus?.next_action),
      isStale: staleAgainstTradingRun,
      referenceRunLabel: staleAgainstTradingRun ? tradingRunSignal?.runLabel ?? null : null,
      referenceDecision: staleAgainstTradingRun ? tradingRunSignal?.decision ?? null : null,
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
        operatorAction: humanizeOperatorText(stringValue(entry.operator_action) ?? "No operator action provided."),
      }));
    const operatorState = stringValue(service?.operator_state) ?? "unknown";
    const state: LoadState = operatorState === "healthy" ? "ok" : "degraded";
    const preOpenGateStatus = normalizePreOpenGateStatus(stringValue(data?.pre_open_gate_status));
    const preOpenGateDetail = humanizeOperatorText(stringValue(data?.pre_open_gate_detail));
    const preOpenGateFreshness = humanizeOperatorText(stringValue(asRecord(data?.pre_open_gate_freshness)?.detail));
    const operatorAction = humanizeOperatorText(stringValue(service?.operator_action) ?? "No operator action required.");
    const cooldownSummary = humanizeOperatorText(stringValue(asRecord(data?.provider_cooldown_summary)?.detail));
    const providerModeSummary = humanizeOperatorText(stringValue(asRecord(data?.provider_mode_summary)?.summary_line));

    return {
      state,
      label: operatorState,
      message:
        operatorAction ??
        providerModeSummary ??
        cooldownSummary ??
        preOpenGateFreshness ??
        preOpenGateDetail ??
        "No operator action required.",
      data: {
        operatorState,
        operatorAction,
        preOpenGateStatus,
        preOpenGateDetail,
        preOpenGateFreshness,
        cooldownSummary,
        providerModeSummary,
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
      label: "Readiness check unavailable",
      message: canary?.message ?? "Pre-open readiness check artifact is missing.",
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
  const checkedAt = stringValue(data.checked_at) ?? stringValue(data.generated_at);
  const isStale = isTimestampOlderThanSeconds(checkedAt, 7200);
  const freshness = checkedAt
    ? `${formatOperatorTimestamp(checkedAt)} (${formatRelativeAge(checkedAt)})`
    : "No check timestamp";

  return {
    state: isStale || status !== "ok" ? "degraded" : "ok",
    label: stringValue(data.result) ?? status,
    message: isStale
      ? `Readiness artifact is stale. Last check was ${formatRelativeAge(checkedAt)}.`
      : checks.length > 0
        ? `${checks.filter((check) => check.result !== "ok").length} checks need attention.`
        : "No readiness checks recorded.",
    data: {
      readyForOpen: booleanValue(data.ready_for_open),
      result: stringValue(data.result),
      warningCount: asArray(data.warnings).length,
      checkedAt,
      freshness,
      checks,
    },
    source: canaryPath,
    updatedAt: stringValue(data.generated_at) ?? checkedAt,
    warnings: [
      ...asArray(data.warnings).map(String),
      ...(isStale ? [`stale:${formatRelativeAge(checkedAt)}`] : []),
    ],
    badgeText: isStale ? "stale" : undefined,
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

async function loadWorkflowOverview(
  repoPath: string,
  tradingRunSignal: TradingRunSignal | null,
): Promise<ArtifactState<WorkflowOverview>> {
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
  const updatedAt = stageRows.at(-1)?.endedAt ?? null;
  const runLabel = formatRunLabel(updatedAt, latestWorkflow.runId);
  const staleAgainstTradingRun = isArtifactOlderThanTradingRun(updatedAt, tradingRunSignal);
  const message = staleAgainstTradingRun && tradingRunSignal
    ? `Latest trading run ${tradingRunSignal.runLabel} completed after this workflow artifact; keeping this workflow for historical context only.`
    : failedStages.length > 0
      ? `Failed stages: ${failedStages.join(", ")}`
      : "Latest workflow completed without stage failures.";

  return {
    state: staleAgainstTradingRun || failedStages.length > 0 ? "degraded" : "ok",
    label: runLabel,
    message,
    data: {
      runId: latestWorkflow.runId,
      runLabel,
      stageCounts,
      failedStages,
      stageRows,
      artifactRows: artifactRows.slice(0, 8),
      canslimSummary:
        asArray(canslimArtifact?.data?.render_lines)
          .map(String)
          .find((line) => line.startsWith("Summary:")) ?? null,
      isStale: staleAgainstTradingRun,
      referenceRunLabel: staleAgainstTradingRun ? tradingRunSignal?.runLabel ?? null : null,
    },
    source: latestWorkflow.path,
    updatedAt,
    badgeText: staleAgainstTradingRun ? "stale" : undefined,
    warnings: compactStrings([
      ...failedStages,
      staleAgainstTradingRun && tradingRunSignal
        ? `Latest trading run ${tradingRunSignal.runLabel} is newer than this workflow artifact.`
        : null,
    ]),
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

async function loadTradingRunOverview(
  cortanaRepoPath: string,
  tradingRunStateStore: TradingRunStateStore | null | undefined,
): Promise<ArtifactState<TradingRunOverview>> {
  const artifactOverview = await loadTradingRunArtifactOverview(cortanaRepoPath);
  const store = tradingRunStateStore === undefined ? prismaTradingRunStateStore : tradingRunStateStore;

  if (!store) {
    return artifactOverview;
  }

  let dbWarnings: string[] = [];
  let dbRecord: TradingRunStateRecord | null = null;
  let dbError: string | null = null;

  try {
    dbWarnings = await store.syncFromArtifacts(cortanaRepoPath);
    dbRecord = await store.loadLatest();
  } catch (error) {
    dbError = formatError(error);
  }

  const compareWarning = compareTradingRunState(dbRecord, artifactOverview.data);
  if (dbRecord && !compareWarning) {
    const dbOverview = tradingRunOverviewFromStateRecord(dbRecord, dbWarnings);
    return artifactOverview.data
      ? { ...dbOverview, warnings: compactStrings([...dbOverview.warnings, ...artifactOverview.warnings]) }
      : dbOverview;
  }

  if (artifactOverview.data) {
    const fallbackReason =
      compareWarning
        ? "DB-backed trading run state disagrees with the latest artifact."
        : dbError
          ? `DB-backed trading run state is unavailable: ${dbError}`
          : "DB-backed trading run state is not populated yet.";
    return {
      ...artifactOverview,
      state: "degraded",
      badgeText: "fallback",
      message: `${artifactOverview.message} Using file fallback because ${fallbackReason}`,
      warnings: compactStrings([
        ...artifactOverview.warnings,
        ...dbWarnings,
        compareWarning,
        dbError ? `DB-backed trading run state unavailable: ${dbError}` : null,
      ]),
      data: {
        ...artifactOverview.data,
        sourceType: "file_fallback",
      },
    };
  }

  return {
    ...artifactOverview,
    warnings: compactStrings([
      ...artifactOverview.warnings,
      ...dbWarnings,
      compareWarning,
      dbError ? `DB-backed trading run state unavailable: ${dbError}` : null,
    ]),
  };
}

async function loadTradingRunArtifactOverview(cortanaRepoPath: string): Promise<ArtifactState<TradingRunOverview>> {
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

  const [summary, watchlist, message, stderr] = await Promise.all([
    readJsonFile<Record<string, unknown>>(path.join(latestRun.path, "summary.json")),
    readJsonFile<Record<string, unknown>>(path.join(latestRun.path, "watchlist-full.json")),
    readTextIfExists(path.join(latestRun.path, "message.txt")),
    readTextIfExists(path.join(latestRun.path, "stderr.txt")),
  ]);

  const summaryData = summary.data;
  if (!summaryData) {
    return {
      state: "degraded",
      label: latestRun.runId,
      message: "Latest run is missing summary.json.",
      data: null,
      source: latestRun.path,
      warnings: compactStrings([summary.message]),
    };
  }

  const watchlistData = watchlist.data;
  const metrics = asRecord(summaryData.metrics);
  const completedAt =
    stringValue(summaryData.completedAt) ??
    stringValue(summaryData.completed_at) ??
    stringValue(summaryData.finalizedAt) ??
    null;
  const startedAt = stringValue(summaryData.startedAt) ?? stringValue(summaryData.started_at) ?? null;
  const createdAt = stringValue(summaryData.createdAt) ?? stringValue(summaryData.created_at) ?? startedAt ?? completedAt;
  const effectiveTimestamp = completedAt ?? startedAt ?? createdAt;
  const runLabel = formatRunLabel(effectiveTimestamp, latestRun.runId);
  const status = stringValue(summaryData.status) ?? (completedAt ? "success" : "unknown");
  const notifiedAt = stringValue(summaryData.notifiedAt) ?? stringValue(summaryData.notified_at) ?? null;
  const deliveryStatus =
    notifiedAt
      ? "notified"
      : status === "failed" || status === "cancelled"
        ? "failed"
        : status === "success" || status === "running" || status === "queued"
          ? "pending"
          : null;
  const lastError =
    stringValue(summaryData.lastError) ??
    stringValue(summaryData.last_error) ??
    stringValue(summaryData.error) ??
    stderr
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ??
    null;

  const focus = asRecord(watchlistData?.focus);
  const strategies = asRecord(watchlistData?.strategies);
  const dipBuyer = asRecord(strategies?.dipBuyer);
  const canslim = asRecord(strategies?.canslim);
  const dipBuyerWatch = extractTickers(dipBuyer?.watch);
  const dipBuyerBuy = extractTickers(dipBuyer?.buy);
  const dipBuyerNoBuy = extractTickers(dipBuyer?.noBuy);
  const canslimWatch = extractTickers(canslim?.watch);
  const canslimBuy = extractTickers(canslim?.buy);
  const canslimNoBuy = extractTickers(canslim?.noBuy);
  const decision = stringValue(watchlistData?.decision) ?? stringValue(metrics?.decision) ?? "unknown";
  const watchCount = numberValue(asRecord(watchlistData?.summary)?.watch) ?? numberValue(metrics?.watch) ?? 0;
  const buyCount = numberValue(asRecord(watchlistData?.summary)?.buy) ?? numberValue(metrics?.buy) ?? 0;
  const noBuyCount = numberValue(asRecord(watchlistData?.summary)?.noBuy) ?? numberValue(metrics?.noBuy) ?? 0;

  return {
    state: status === "failed" || status === "cancelled" || !watchlistData ? "degraded" : "ok",
    label: runLabel,
    message: compactStrings([
      status === "failed" || status === "cancelled"
        ? `Run ${status} ${runLabel}.${lastError ? ` ${lastError}` : ""}`.trim()
        : `Completed ${runLabel} with ${decision} and ${watchCount} watch names.`,
      notifiedAt
        ? `Delivered ${formatOperatorTimestamp(notifiedAt)}.`
        : deliveryStatus === "pending"
          ? "Notification pending."
          : deliveryStatus === "failed"
            ? "Notification unavailable because the run did not complete cleanly."
            : null,
      !watchlistData ? "watchlist-full.json is missing; counts fall back to summary metrics." : null,
    ]).join(" "),
    source: latestRun.path,
    updatedAt: effectiveTimestamp,
    warnings: compactStrings([summary.message, watchlist.message, lastError]),
    data: {
      runId: latestRun.runId,
      runLabel,
      status,
      deliveryStatus,
      decision,
      focusTicker: stringValue(focus?.ticker),
      focusAction: stringValue(focus?.action),
      focusStrategy: stringValue(focus?.strategy),
      watchCount,
      buyCount,
      noBuyCount,
      dipBuyerWatch,
      dipBuyerBuy,
      dipBuyerNoBuy,
      canslimWatch,
      canslimBuy,
      canslimNoBuy,
      messagePreview: message ? message.split(/\r?\n/).slice(0, 6).join("\n") : null,
      completedAt,
      notifiedAt,
      correctionMode: booleanValue(watchlistData?.correctionMode) ?? booleanValue(metrics?.correctionMode),
      lastError,
      sourceType: "artifact",
    },
  };
}

function tradingRunOverviewFromStateRecord(
  record: TradingRunStateRecord,
  warnings: string[],
): ArtifactState<TradingRunOverview> {
  const effectiveTimestamp = record.completedAt ?? record.startedAt ?? record.createdAt;
  const runLabel = formatRunLabel(effectiveTimestamp, record.runId);
  const state: LoadState = record.status === "failed" || record.status === "cancelled" ? "degraded" : "ok";

  return {
    state,
    label: runLabel,
    message:
      record.status === "failed" || record.status === "cancelled"
        ? `DB-backed latest run ${record.status} ${runLabel}.${record.lastError ? ` ${record.lastError}` : ""}`.trim()
        : compactStrings([
            `DB-backed latest run ${runLabel} finished ${record.decision ?? "unknown"}.`,
            record.notifiedAt
              ? `Delivered ${formatOperatorTimestamp(record.notifiedAt)}.`
              : record.deliveryStatus === "pending"
                ? "Notification pending."
                : null,
          ]).join(" "),
    source: "Mission Control Postgres · mc_trading_runs",
    updatedAt: effectiveTimestamp,
    warnings,
    data: {
      runId: record.runId,
      runLabel,
      status: record.status,
      deliveryStatus: record.deliveryStatus,
      decision: record.decision ?? "unknown",
      focusTicker: record.focusTicker,
      focusAction: record.focusAction,
      focusStrategy: record.focusStrategy,
      watchCount: record.watchCount ?? 0,
      buyCount: record.buyCount ?? 0,
      noBuyCount: record.noBuyCount ?? 0,
      dipBuyerWatch: record.dipBuyerWatch,
      dipBuyerBuy: record.dipBuyerBuy,
      dipBuyerNoBuy: record.dipBuyerNoBuy,
      canslimWatch: record.canslimWatch,
      canslimBuy: record.canslimBuy,
      canslimNoBuy: record.canslimNoBuy,
      messagePreview: record.messagePreview,
      completedAt: record.completedAt,
      notifiedAt: record.notifiedAt,
      correctionMode: record.correctionMode,
      lastError: record.lastError,
      sourceType: "db",
    },
  };
}

function compareTradingRunState(
  dbRecord: TradingRunStateRecord | null,
  artifactData: TradingRunOverview | null,
): string | null {
  if (!dbRecord || !artifactData) return null;
  if (shouldTolerateInFlightRunAheadOfArtifact(dbRecord, artifactData)) return null;
  if (dbRecord.runId !== artifactData.runId) return `DB latest run ${dbRecord.runId} does not match file latest run ${artifactData.runId}.`;
  if (dbRecord.status !== artifactData.status) return `DB status ${dbRecord.status} does not match file status ${artifactData.status} for ${artifactData.runId}.`;
  if ((dbRecord.decision ?? "unknown") !== artifactData.decision) {
    return `DB decision ${(dbRecord.decision ?? "unknown")} does not match file decision ${artifactData.decision} for ${artifactData.runId}.`;
  }
  if ((dbRecord.buyCount ?? 0) !== artifactData.buyCount || (dbRecord.watchCount ?? 0) !== artifactData.watchCount || (dbRecord.noBuyCount ?? 0) !== artifactData.noBuyCount) {
    return `DB counts do not match file counts for ${artifactData.runId}.`;
  }
  if ((dbRecord.completedAt ?? null) !== artifactData.completedAt) return `DB completedAt does not match file completedAt for ${artifactData.runId}.`;
  if ((dbRecord.notifiedAt ?? null) !== artifactData.notifiedAt) return `DB notifiedAt does not match file notifiedAt for ${artifactData.runId}.`;
  return null;
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

function summarizeTradingRunSignal(signal: TradingRunSignal): string {
  return `Latest trading run ${signal.runLabel}: BUY ${signal.buyCount} · WATCH ${signal.watchCount} · NO_BUY ${signal.noBuyCount}`;
}

function postureFromTradingDecision(decision: string): string {
  return decision.toUpperCase() === "NO_TRADE" ? "Stand aside" : "Review";
}

function asTradingRunSignal(artifact: ArtifactState<TradingRunOverview>): TradingRunSignal | null {
  if (!artifact.data) return null;
  return {
    runId: artifact.data.runId,
    runLabel: artifact.data.runLabel,
    updatedAt: artifact.updatedAt ?? null,
    decision: artifact.data.decision,
    buyCount: artifact.data.buyCount,
    watchCount: artifact.data.watchCount,
    noBuyCount: artifact.data.noBuyCount,
    correctionMode: artifact.data.correctionMode,
    source: artifact.source ?? null,
  };
}

function isArtifactOlderThanTradingRun(updatedAt: string | null | undefined, tradingRunSignal: TradingRunSignal | null): boolean {
  if (!updatedAt || !tradingRunSignal?.updatedAt) return false;
  const artifactMs = Date.parse(updatedAt);
  const tradingRunMs = Date.parse(tradingRunSignal.updatedAt);
  if (!Number.isFinite(artifactMs) || !Number.isFinite(tradingRunMs)) return false;
  return artifactMs < tradingRunMs;
}

function formatRunLabel(timestamp: string | null | undefined, fallbackId: string): string {
  const formatted = formatOperatorTimestamp(timestamp);
  return formatted === "—" ? fallbackId : formatted;
}

function regimeFromTradingRunSignal(signal: TradingRunSignal | null, fallback: string): string {
  if (signal?.correctionMode === true) return "correction";
  if (signal?.correctionMode === false) return "active";
  return fallback;
}

function positionSizingPctFromTradingDecision(decision: string | null | undefined): number | null {
  if (!decision) return null;
  return decision.toUpperCase() === "NO_TRADE" ? 0 : null;
}

function isTimestampOlderThanSeconds(timestamp: string | null | undefined, seconds: number): boolean {
  if (!timestamp) return false;
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return false;
  return Date.now() - parsed > seconds * 1000;
}

function normalizePreOpenGateStatus(status: string | null): string | null {
  if (!status) return null;
  if (status === "not_available") return "Readiness check unavailable";
  if (status === "stale") return "Stale";
  if (status === "unknown" || status === "not_reported") return "Not reported";
  if (status === "warn") return "Warn";
  if (status === "fail") return "Fail";
  if (status === "pass") return "Pass";
  if (status === "ok") return "OK";
  return status.replaceAll("_", " ");
}

function humanizeOperatorText(value: string): string;
function humanizeOperatorText(value: null): null;
function humanizeOperatorText(value: string | null): string | null;
function humanizeOperatorText(value: string | null): string | null {
  if (!value) return value;
  return value.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, (timestamp) => {
    const formatted = formatOperatorTimestamp(timestamp);
    return formatted === "—" ? timestamp : `${formatted} ET`;
  });
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
