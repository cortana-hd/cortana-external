import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { formatOperatorTimestamp, formatRelativeAge } from "@/lib/format-utils";
import { getBacktesterRepoPath, getCortanaSourceRepo } from "@/lib/runtime-paths";
import { findWorkspaceRoot } from "@/lib/service-workspace";
import { shouldTolerateInFlightRunAheadOfArtifact } from "@/lib/trading-ops-smoke";
import {
  prismaTradingRunStateStore,
  type TradingRunStateRecord,
  type TradingRunStateStore,
} from "@/lib/trading-run-state";

const execFileAsync = promisify(execFile);
const JSON_TIMEOUT_MS = 10_000;
const DEFAULT_EXTERNAL_SERVICE_PORT = "3033";
const STALE_SUMMARY_MAX_AGE_SECONDS = 24 * 60 * 60;

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

export type OperatorVerdictOverview = {
  verdictLabel: string;
  cautionLabel: string;
  oneDayMatured: number;
  fiveDayMatured: number;
  buySamples: number;
  buyAvgReturnPct: number | null;
  buyHitRate: number | null;
  watchSamples: number;
  watchAvgReturnPct: number | null;
  watchHitRate: number | null;
  noBuySamples: number;
  noBuyAvoidanceRate: number | null;
  highConfidenceBuySamples: number;
  highConfidenceBuyAvgReturnPct: number | null;
  highConfidenceBuyHitRate: number | null;
  overblockRate: number | null;
  topBlocker: string | null;
  actionItems: string[];
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

export type FinancialServiceHealthRow = {
  label: string;
  state: LoadState;
  summary: string;
  detail: string;
  source: string;
  updatedAt: string | null;
  badgeText?: string | null;
};

export type FinancialServicesHealthOverview = {
  rows: FinancialServiceHealthRow[];
  healthyCount: number;
  degradedCount: number;
  errorCount: number;
  checkedAt: string | null;
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
  operatorVerdict: ArtifactState<OperatorVerdictOverview>;
  prediction: ArtifactState<PredictionOverview>;
  benchmark: ArtifactState<BenchmarkOverview>;
  lifecycle: ArtifactState<LifecycleOverview>;
  workflow: ArtifactState<WorkflowOverview>;
  opsHighway: ArtifactState<OpsHighwayOverview>;
  financialServices: ArtifactState<FinancialServicesHealthOverview>;
  tradingRun: ArtifactState<TradingRunOverview>;
};

type LoaderOptions = {
  backtesterRepoPath?: string;
  cortanaRepoPath?: string;
  externalServiceBaseUrl?: string;
  runJsonCommand?: (scriptPath: string, args?: string[]) => Promise<unknown>;
  fetchImpl?: typeof fetch;
  tradingRunStateStore?: TradingRunStateStore | null;
};

export async function loadTradingOpsDashboardData(
  options: LoaderOptions = {},
): Promise<TradingOpsDashboardData> {
  const repoPath = options.backtesterRepoPath ?? getBacktesterRepoPath();
  const cortanaRepoPath = options.cortanaRepoPath ?? getCortanaSourceRepo();
  const externalServiceBaseUrl = options.externalServiceBaseUrl ?? await resolveExternalServiceBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;
  const runJsonCommand = options.runJsonCommand ?? ((scriptPath: string, args: string[] = ["--pretty"]) =>
    runBacktesterJsonScript(repoPath, scriptPath, args));
  const tradingRun = await loadTradingRunOverview(cortanaRepoPath, options.tradingRunStateStore);
  const tradingRunSignal = asTradingRunSignal(tradingRun);

  const [
    market,
    runtime,
    canary,
    operatorVerdict,
    prediction,
    benchmark,
    lifecycle,
    workflow,
    opsHighway,
    financialServices,
  ] = await Promise.all([
    loadMarketOverview(repoPath, tradingRunSignal),
    loadRuntimeOverview(repoPath, runJsonCommand),
    loadCanaryOverview(repoPath),
    loadOperatorVerdictOverview(repoPath),
    loadPredictionOverview(repoPath, runJsonCommand),
    loadBenchmarkOverview(repoPath),
    loadLifecycleOverview(repoPath, tradingRunSignal),
    loadWorkflowOverview(repoPath, tradingRunSignal),
    loadOpsHighwayOverview(repoPath, runJsonCommand),
    loadFinancialServicesOverview(externalServiceBaseUrl, fetchImpl),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    repoPath,
    cortanaRepoPath,
    market,
    runtime,
    canary,
    operatorVerdict,
    prediction,
    benchmark,
    lifecycle,
    workflow,
    opsHighway,
    financialServices,
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

async function loadFinancialServicesOverview(
  baseUrl: string,
  fetchImpl: typeof fetch,
): Promise<ArtifactState<FinancialServicesHealthOverview>> {
  const checkedAt = new Date().toISOString();
  const [opsResult, alpacaResult, polymarketHealthResult, polymarketLiveResult] = await Promise.all([
    fetchJson(`${baseUrl}/market-data/ops`, fetchImpl, 5_000),
    fetchJson(`${baseUrl}/alpaca/health`, fetchImpl, 4_000),
    fetchJson(`${baseUrl}/polymarket/health`, fetchImpl, 4_000),
    fetchJson(`${baseUrl}/polymarket/live`, fetchImpl, 4_000),
  ]);

  const opsBody = asRecord(opsResult.body);
  const opsData = asRecord(opsBody?.data);
  const opsHealth = asRecord(opsData?.health);
  const opsProviders = asRecord(opsHealth?.providers);
  const providerMetrics = asRecord(opsData?.providerMetrics);
  const schwabStreamerMeta = asRecord(opsProviders?.schwabStreamerMeta);
  const polymarketHealth = asRecord(polymarketHealthResult.body);
  const polymarketLive = asRecord(polymarketLiveResult.body);
  const polymarketStreamer = asRecord(polymarketLive?.streamer);

  const rows = [
    buildConfiguredServiceRow({
      label: "Alpaca",
      source: "/alpaca/health",
      status: stringValue(asRecord(alpacaResult.body)?.status),
      okValues: ["healthy", "ok"],
      healthyLabel: "healthy",
      detail:
        stringValue(asRecord(alpacaResult.body)?.error) ??
        "Broker health and account reachability are reported by Alpaca.",
    }),
    buildConfiguredServiceRow({
      label: "FRED",
      source: "/market-data/ops",
      status: stringValue(opsProviders?.fred),
      okValues: ["configured"],
      healthyLabel: "configured",
      detail: "Market-data ops sees FRED configured for economic data lookups.",
    }),
    buildConfiguredServiceRow({
      label: "CoinMarketCap",
      source: "/market-data/ops",
      status: stringValue(opsProviders?.coinmarketcap),
      okValues: ["configured"],
      healthyLabel: "configured",
      detail: "Market-data ops sees CoinMarketCap configured for crypto coverage.",
    }),
    buildSchwabRestRow(providerMetrics, opsProviders, opsData, opsResult),
    buildSchwabStreamerRow(schwabStreamerMeta, opsProviders, opsResult),
    buildPolymarketRestRow(polymarketHealthResult, polymarketHealth),
    buildPolymarketStreamerRow(polymarketLiveResult, polymarketLive, polymarketStreamer),
  ];

  const healthyCount = rows.filter((row) => row.state === "ok").length;
  const degradedCount = rows.filter((row) => row.state === "degraded").length;
  const errorCount = rows.filter((row) => row.state === "error").length;
  const summary = errorCount > 0
    ? `${errorCount} services need attention.`
    : degradedCount > 0
      ? `${healthyCount} services healthy, ${degradedCount} degraded.`
      : `${healthyCount} services healthy.`;

  return {
    state: errorCount > 0 ? "error" : degradedCount > 0 ? "degraded" : "ok",
    label: "Financial services health",
    message: summary,
    source: `${baseUrl}/market-data/ops · ${baseUrl}/alpaca/health · ${baseUrl}/polymarket/health · ${baseUrl}/polymarket/live`,
    updatedAt: checkedAt,
    warnings: compactStrings([
      opsResult.error,
      alpacaResult.error,
      polymarketHealthResult.error,
      polymarketLiveResult.error,
      ...rows.flatMap((row) => (row.state === "ok" ? [] : [`${row.label}:${row.state}`])),
    ]),
    badgeText: `${healthyCount}/${rows.length}`,
    data: {
      rows,
      healthyCount,
      degradedCount,
      errorCount,
      checkedAt,
    },
  };
}

type FetchJsonResult = {
  ok: boolean;
  status: number;
  body: unknown;
  error: string | null;
};

function buildServiceRow(args: {
  label: string;
  source: string;
  state: LoadState;
  summary: string;
  detail: string;
  updatedAt: string | null;
  badgeText?: string | null;
}): FinancialServiceHealthRow {
  return {
    label: args.label,
    state: args.state,
    summary: args.summary,
    detail: args.detail,
    source: args.source,
    updatedAt: args.updatedAt,
    badgeText: args.badgeText ?? null,
  };
}

function buildConfiguredServiceRow(args: {
  label: string;
  source: string;
  status: string | null;
  okValues: string[];
  healthyLabel: string;
  detail: string;
  updatedAt?: string | null;
}): FinancialServiceHealthRow {
  const status = args.status?.toLowerCase() ?? null;
  const updatedAt = args.updatedAt ?? new Date().toISOString();
  if (status == null) {
    return buildServiceRow({
      label: args.label,
      source: args.source,
      state: "error",
      summary: "unavailable",
      detail: "The service did not return a health status.",
      updatedAt,
    });
  }

  if (args.okValues.includes(status)) {
    return buildServiceRow({
      label: args.label,
      source: args.source,
      state: "ok",
      summary: args.healthyLabel,
      detail: args.detail,
      updatedAt,
      badgeText: args.healthyLabel,
    });
  }

  const state: LoadState = status === "disabled" ? "degraded" : status === "configured" ? "ok" : "error";

  return buildServiceRow({
    label: args.label,
    source: args.source,
    state,
    summary: status,
    detail: args.detail,
    updatedAt,
  });
}

function buildSchwabRestRow(
  providerMetrics: Record<string, unknown> | null,
  providers: Record<string, unknown> | null,
  opsData: Record<string, unknown> | null,
  opsResult: FetchJsonResult,
): FinancialServiceHealthRow {
  const updatedAt = stringValue(providerMetrics?.lastSuccessfulSchwabRestAt) ?? stringValue(opsData?.generated_at) ?? new Date().toISOString();
  const cooldownUntil = stringValue(providerMetrics?.schwabCooldownUntil);
  const tokenStatus = stringValue(providerMetrics?.schwabTokenStatus) ?? stringValue(providers?.schwabTokenStatus);
  const configured = stringValue(providers?.schwab) ?? "disabled";
  const state: LoadState =
    configured !== "configured"
      ? "error"
      : cooldownUntil
        ? "degraded"
        : tokenStatus === "ready"
          ? "ok"
          : "degraded";

  return buildServiceRow({
    label: "Schwab REST",
    source: "/market-data/ops",
    state,
    summary: cooldownUntil ? "cooldown active" : tokenStatus === "ready" ? "healthy" : tokenStatus ?? "unknown",
    detail:
      cooldownUntil
        ? `Cooldown is active until ${formatOperatorTimestamp(cooldownUntil)}.`
        : stringValue(providerMetrics?.lastSuccessfulSchwabRestAt)
          ? `Last successful REST quote at ${formatOperatorTimestamp(updatedAt)}.`
          : opsResult.error ?? "Schwab REST health was not reported.",
    updatedAt,
    badgeText: cooldownUntil ? "cooldown" : tokenStatus === "ready" ? "rest" : undefined,
  });
}

function buildSchwabStreamerRow(
  streamerMeta: Record<string, unknown> | null,
  providers: Record<string, unknown> | null,
  opsResult: FetchJsonResult,
): FinancialServiceHealthRow {
  const connected = booleanValue(streamerMeta?.connected);
  const stale = booleanValue(streamerMeta?.stale) ?? false;
  const operatorState = stringValue(streamerMeta?.operatorState) ?? "unknown";
  const configured = stringValue(providers?.schwabStreamer) ?? "disabled";
  const updatedAt =
    stringValue(streamerMeta?.lastMessageAt) ??
    stringValue(streamerMeta?.lastHeartbeatAt) ??
    stringValue(streamerMeta?.lastDisconnectAt) ??
    stringValue(streamerMeta?.lastLoginAt) ??
    new Date().toISOString();
  const activeSubscriptions = asRecord(streamerMeta?.activeSubscriptions);
  const lastDisconnectReason = stringValue(streamerMeta?.lastDisconnectReason);
  const lastDisconnectAt = stringValue(streamerMeta?.lastDisconnectAt);
  const lastHeartbeatAt = stringValue(streamerMeta?.lastHeartbeatAt);
  const state: LoadState =
    configured !== "enabled"
      ? "error"
      : !connected || stale || operatorState !== "healthy"
        ? "degraded"
        : "ok";

  return buildServiceRow({
    label: "Schwab streamer",
    source: "/market-data/ops",
    state,
    summary: connected ? (stale ? "stale" : "connected") : "disconnected",
    detail:
      connected
        ? stale
          ? `Streamer is connected, but the last Schwab update is stale.`
          : `${numberValue(activeSubscriptions?.LEVELONE_EQUITIES) ?? 0} equity subs · ${numberValue(activeSubscriptions?.ACCT_ACTIVITY) ?? 0} acct activity.`
        : compactStrings([
            lastDisconnectReason ? `Disconnected: ${lastDisconnectReason}` : null,
            lastDisconnectAt ? `Last disconnect ${formatOperatorTimestamp(lastDisconnectAt)}.` : null,
            lastHeartbeatAt ? `Last heartbeat ${formatOperatorTimestamp(lastHeartbeatAt)}.` : null,
            opsResult.error ?? "Schwab streamer health was not reported.",
          ]).join(" "),
    updatedAt,
    badgeText: connected && !stale && operatorState === "healthy" ? "stream" : stale ? "stale" : undefined,
  });
}

function buildPolymarketRestRow(
  polymarketHealthResult: FetchJsonResult,
  polymarketHealth: Record<string, unknown> | null,
): FinancialServiceHealthRow {
  const status = stringValue(polymarketHealth?.status) ?? (polymarketHealthResult.ok ? "healthy" : "unhealthy");
  const state: LoadState = status === "healthy" || status === "ok" ? "ok" : status === "degraded" ? "degraded" : "error";
  const updatedAt = stringValue(polymarketHealth?.generatedAt) ?? new Date().toISOString();

  return buildServiceRow({
    label: "Polymarket REST",
    source: "/polymarket/health",
    state,
    summary: status,
    detail:
      state === "ok"
        ? `API ${stringValue(polymarketHealth?.apiBaseUrl) ?? "Polymarket API"} is reachable.`
        : polymarketHealthResult.error ?? "Polymarket REST health was not reported.",
    updatedAt,
    badgeText: "rest",
  });
}

function buildPolymarketStreamerRow(
  polymarketLiveResult: FetchJsonResult,
  polymarketLive: Record<string, unknown> | null,
  streamer: Record<string, unknown> | null,
): FinancialServiceHealthRow {
  const connected = booleanValue(streamer?.marketsConnected);
  const privateConnected = booleanValue(streamer?.privateConnected);
  const operatorState = stringValue(streamer?.operatorState) ?? "unknown";
  const lastMarketMessageAt = stringValue(streamer?.lastMarketMessageAt);
  const state: LoadState =
    connected && privateConnected
      ? operatorState === "healthy"
        ? "ok"
        : "degraded"
      : connected || privateConnected
        ? "degraded"
        : "error";
  const updatedAt = stringValue(polymarketLive?.generatedAt) ?? stringValue(streamer?.lastMarketMessageAt) ?? new Date().toISOString();

  return buildServiceRow({
    label: "Polymarket streamer",
    source: "/polymarket/live",
    state,
    summary:
      connected && privateConnected
        ? "connected"
        : connected || privateConnected
          ? "partial"
          : "disconnected",
    detail:
      connected || privateConnected
        ? `${numberValue(streamer?.trackedMarketCount) ?? 0} tracked markets · ${lastMarketMessageAt ? `last market msg ${formatOperatorTimestamp(lastMarketMessageAt)}` : "no market timestamp"}.`
        : polymarketLiveResult.error ?? "Polymarket streamer health was not reported.",
    updatedAt,
    badgeText: operatorState === "healthy" ? "stream" : undefined,
  });
}

async function resolveExternalServiceBaseUrl(): Promise<string> {
  const envValue = process.env.MISSION_CONTROL_EXTERNAL_SERVICE_URL?.trim();
  if (envValue) {
    return envValue.replace(/\/+$/u, "");
  }

  const workspaceRoot = findWorkspaceRoot();
  const envPath = path.join(workspaceRoot, ".env");
  try {
    const envFile = await fs.readFile(envPath, "utf8");
    const match = envFile.match(/^\s*PORT\s*=\s*(.+)\s*$/m);
    const port = (match?.[1]?.trim() ?? DEFAULT_EXTERNAL_SERVICE_PORT).replace(/^['"]|['"]$/gu, "") || DEFAULT_EXTERNAL_SERVICE_PORT;
    return `http://127.0.0.1:${port}`;
  } catch {
    return `http://127.0.0.1:${DEFAULT_EXTERNAL_SERVICE_PORT}`;
  }
}

async function fetchJson(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<FetchJsonResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await response.text();
    const body = text.length > 0 ? safeJsonParse(text) : null;
    return {
      ok: response.ok,
      status: response.status,
      body,
      error: response.ok ? null : summarizeFetchError(response.status, body),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: null,
      error: error instanceof Error ? error.message : "Request failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function summarizeFetchError(status: number, body: unknown): string {
  const record = asRecord(body);
  const error = stringValue(record?.error) ?? stringValue(record?.message);
  return error ? `HTTP ${status}: ${error}` : `HTTP ${status}`;
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

async function loadPredictionOverview(
  repoPath: string,
  runJsonCommand: (scriptPath: string, args?: string[]) => Promise<unknown>,
): Promise<ArtifactState<PredictionOverview>> {
  const reportPath = path.join(repoPath, ".cache", "prediction_accuracy", "reports", "prediction-accuracy-latest.json");
  let report = await readJsonFile<Record<string, unknown>>(reportPath);

  if (await shouldRefreshPredictionAccuracySummary(repoPath, reportPath)) {
    const refreshed = await refreshPredictionAccuracySummary(repoPath, runJsonCommand);
    if (refreshed) {
      report = { path: reportPath, data: refreshed };
    }
  }

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
  const updatedAt = stringValue(data.generated_at) ?? null;
  const isStale = !updatedAt || isTimestampOlderThanSeconds(updatedAt, STALE_SUMMARY_MAX_AGE_SECONDS);

  return {
    state: isStale ? "degraded" : "ok",
    label: "Prediction loop",
    message: isStale
      ? updatedAt
        ? `Prediction accuracy report is stale. Last refreshed ${formatOperatorTimestamp(updatedAt)} (${formatRelativeAge(updatedAt)}).`
        : "Prediction accuracy report is stale or missing a generated timestamp."
      : `${numberValue(data.snapshot_count) ?? 0} snapshots, ${numberValue(data.record_count) ?? 0} settled records tracked.`,
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
    updatedAt,
    warnings: compactStrings([isStale && updatedAt ? `stale:${formatRelativeAge(updatedAt)}` : isStale ? "stale:missing-timestamp" : null]),
    badgeText: isStale ? "stale" : undefined,
  };
}

async function loadOperatorVerdictOverview(repoPath: string): Promise<ArtifactState<OperatorVerdictOverview>> {
  const reportsRoot = path.join(repoPath, ".cache", "prediction_accuracy", "reports");
  const predictionPath = path.join(reportsRoot, "prediction-accuracy-latest.json");
  const decisionReviewPath = path.join(reportsRoot, "decision-review-latest.json");
  const benchmarkPath = path.join(reportsRoot, "benchmark-comparison-latest.json");

  const [prediction, decisionReview, benchmark] = await Promise.all([
    readJsonFile<Record<string, unknown>>(predictionPath),
    readJsonFile<Record<string, unknown>>(decisionReviewPath),
    readJsonFile<Record<string, unknown>>(benchmarkPath),
  ]);

  if (!prediction?.data) {
    return {
      state: prediction?.error === "missing" ? "missing" : "error",
      label: "Operator verdict unavailable",
      message: prediction?.message ?? "Prediction accuracy report not found.",
      data: null,
      source: predictionPath,
      warnings: [],
    };
  }

  if (!decisionReview?.data) {
    return {
      state: decisionReview?.error === "missing" ? "missing" : "error",
      label: "Operator verdict unavailable",
      message: decisionReview?.message ?? "Decision review report not found.",
      data: null,
      source: decisionReviewPath,
      warnings: [],
    };
  }

  const predictionData = prediction.data;
  const decisionReviewData = decisionReview.data;
  const benchmarkData = benchmark.data;
  const horizonStatus = asRecord(predictionData.horizon_status);
  const oneDay = asRecord(horizonStatus?.["1d"]);
  const fiveDay = asRecord(horizonStatus?.["5d"]);
  const byAction = asArray(predictionData.by_action);
  const byConfidenceBucket = asArray(predictionData.by_confidence_bucket);
  const opportunityByAction = asArray(asRecord(decisionReviewData.opportunity_cost)?.by_action);
  const vetoEffectiveness = asArray(decisionReviewData.veto_effectiveness)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));

  const buyOneDay = extractPredictionHorizonMetrics(byAction, { action: "BUY" }, "1d");
  const watchOneDay = extractPredictionHorizonMetrics(byAction, { action: "WATCH" }, "1d");
  const noBuyOneDay = extractPredictionHorizonMetrics(byAction, { action: "NO_BUY" }, "1d");
  const highConfidenceBuy = extractPredictionHorizonMetrics(byConfidenceBucket, { strategy: "dip_buyer", action: "BUY", confidenceBucket: "high" }, "1d");
  const noBuyOpportunity = opportunityByAction
    .map((entry) => asRecord(entry))
    .find((entry) => stringValue(entry?.action) === "NO_BUY");
  const topBlocker = vetoEffectiveness
    .slice()
    .sort((left, right) => (numberValue(right.count) ?? 0) - (numberValue(left.count) ?? 0))[0] ?? null;
  const benchmarkBaseline = asRecord(asRecord(benchmarkData)?.baselines)?.all_predictions;
  const benchmarkMaturedCount = numberValue(asRecord(benchmarkBaseline)?.matured_count);

  const oneDayMatured = numberValue(oneDay?.matured) ?? 0;
  const fiveDayMatured = numberValue(fiveDay?.matured) ?? 0;
  const buyAvgReturnPct = numberValue(buyOneDay?.avg_return_pct);
  const watchAvgReturnPct = numberValue(watchOneDay?.avg_return_pct);
  const highConfidenceBuyAvgReturnPct = numberValue(highConfidenceBuy?.avg_return_pct);
  const reasons = compactStrings([
    buyAvgReturnPct != null && buyAvgReturnPct <= 0 ? `BUY is still losing on average (${formatSignedPercent(buyAvgReturnPct)} over ${numberValue(buyOneDay?.samples) ?? 0} 1d samples).` : null,
    watchAvgReturnPct != null && watchAvgReturnPct <= 0 ? `WATCH is still losing on average (${formatSignedPercent(watchAvgReturnPct)} over ${numberValue(watchOneDay?.samples) ?? 0} 1d samples).` : null,
    highConfidenceBuyAvgReturnPct != null && highConfidenceBuyAvgReturnPct <= 0 ? `High-confidence Dip Buyer BUY is still negative (${formatSignedPercent(highConfidenceBuyAvgReturnPct)} over ${numberValue(highConfidenceBuy?.samples) ?? 0} 1d samples).` : null,
    fiveDayMatured < 25 ? `Only ${fiveDayMatured} 5d samples have matured, so the edge is not proven beyond next day noise.` : null,
    benchmarkMaturedCount != null && benchmarkMaturedCount < 25 ? `Benchmark ladder only has ${benchmarkMaturedCount} matured comparison sample${benchmarkMaturedCount === 1 ? "" : "s"}.` : null,
  ]);
  const isBlocked = reasons.length > 0;

  return {
    state: isBlocked ? "degraded" : "ok",
    label: isBlocked ? "Research only" : "Candidate edge",
    message: isBlocked
      ? `BUY and WATCH are not proven yet. ${reasons.join(" ")}`
      : "BUY and WATCH have enough matured support to merit small-size review.",
    data: {
      verdictLabel: isBlocked ? "Do not size up" : "Small-size candidate",
      cautionLabel: isBlocked ? "Research-only signal" : "Edge looks live",
      oneDayMatured,
      fiveDayMatured,
      buySamples: numberValue(buyOneDay?.samples) ?? 0,
      buyAvgReturnPct,
      buyHitRate: numberValue(buyOneDay?.hit_rate),
      watchSamples: numberValue(watchOneDay?.samples) ?? 0,
      watchAvgReturnPct,
      watchHitRate: numberValue(watchOneDay?.hit_rate),
      noBuySamples: numberValue(noBuyOneDay?.samples) ?? 0,
      noBuyAvoidanceRate: numberValue(noBuyOneDay?.decision_accuracy),
      highConfidenceBuySamples: numberValue(highConfidenceBuy?.samples) ?? 0,
      highConfidenceBuyAvgReturnPct,
      highConfidenceBuyHitRate: numberValue(highConfidenceBuy?.hit_rate),
      overblockRate: numberValue(noBuyOpportunity?.overblock_rate),
      topBlocker: stringValue(topBlocker?.veto),
      actionItems: buildOperatorActionItems({ isBlocked, fiveDayMatured, topBlocker: stringValue(topBlocker?.veto) }),
    },
    source: [predictionPath, decisionReviewPath, benchmarkPath].join(" · "),
    updatedAt: stringValue(predictionData.generated_at) ?? stringValue(decisionReviewData.generated_at) ?? null,
    warnings: reasons,
    badgeText: isBlocked ? "blocked" : "candidate",
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
      maturedCount: numberValue(asRecord(asRecord(data.baselines)?.all_predictions)?.matured_count),
      bestComparisonLabel: firstWithMatured
        ? `${stringValue(firstWithMatured.strategy)} vs baseline`
        : null,
    },
    source: benchmarkPath,
    updatedAt: stringValue(data.generated_at),
    warnings: [],
  };
}

async function loadLifecycleOverview(
  repoPath: string,
  tradingRunSignal: TradingRunSignal | null,
): Promise<ArtifactState<LifecycleOverview>> {
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
  const updatedAt = stringValue(data.generated_at) ?? null;
  const isOlderThanTradingRun = isArtifactOlderThanTradingRun(updatedAt, tradingRunSignal);
  const isStale = !updatedAt || isOlderThanTradingRun || isTimestampOlderThanSeconds(updatedAt, STALE_SUMMARY_MAX_AGE_SECONDS);

  return {
    state: isStale ? "degraded" : "ok",
    label: "Trade lifecycle",
    message: isStale
      ? compactStrings([
          "Trade lifecycle summary is stale.",
          updatedAt
            ? isOlderThanTradingRun && tradingRunSignal
              ? `Latest trading run ${tradingRunSignal.runLabel} is newer than this lifecycle summary.`
              : `Last refreshed ${formatOperatorTimestamp(updatedAt)} (${formatRelativeAge(updatedAt)}).`
            : "Lifecycle summary is missing a generated timestamp.",
        ]).join(" ")
      : `${numberValue(summary?.open_count) ?? 0} open, ${numberValue(summary?.closed_total_count) ?? 0} closed.`,
    data: {
      openCount: numberValue(summary?.open_count) ?? 0,
      closedCount: numberValue(summary?.closed_total_count) ?? 0,
      totalCapital: numberValue(portfolioSnapshot?.total_capital),
      availableCapital: numberValue(portfolioSnapshot?.available_capital),
      grossExposurePct: numberValue(portfolioSnapshot?.gross_exposure_pct) == null ? null : (numberValue(portfolioSnapshot?.gross_exposure_pct) ?? 0) * 100,
    },
    source: cyclePath,
    updatedAt,
    warnings: compactStrings([
      isStale && updatedAt ? `stale:${formatRelativeAge(updatedAt)}` : isStale ? "stale:missing-timestamp" : null,
      isOlderThanTradingRun && tradingRunSignal ? `latest-trading-run:${tradingRunSignal.runLabel}` : null,
    ]),
    badgeText: isStale ? "stale" : undefined,
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

async function shouldRefreshPredictionAccuracySummary(repoPath: string, reportPath: string): Promise<boolean> {
  const reportFreshnessMs = await predictionAccuracyReportFreshnessMs(reportPath);
  const latestSettledFreshnessMs = await latestPredictionAccuracyArtifactFreshnessMs(path.join(repoPath, ".cache", "prediction_accuracy", "settled"));
  if (latestSettledFreshnessMs > reportFreshnessMs) return true;
  const latestSnapshotFreshnessMs = await latestPredictionAccuracyArtifactFreshnessMs(path.join(repoPath, ".cache", "prediction_accuracy", "snapshots"));
  return latestSnapshotFreshnessMs > reportFreshnessMs;
}

async function refreshPredictionAccuracySummary(
  repoPath: string,
  runJsonCommand: (scriptPath: string, args?: string[]) => Promise<unknown>,
): Promise<Record<string, unknown> | null> {
  const scriptPath = path.join(repoPath, "backtester", "prediction_accuracy_report.py");

  try {
    const raw = asRecord(await runJsonCommand(scriptPath, ["--json", "--max-snapshots-per-run", "1"]));
    return asRecord(raw?.prediction_accuracy);
  } catch {
    return null;
  }
}

async function fileMtimeMs(filePath: string): Promise<number> {
  try {
    const stat = await fs.stat(filePath);
    return stat.mtimeMs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return 0;
    return 0;
  }
}

async function predictionAccuracyReportFreshnessMs(reportPath: string): Promise<number> {
  const report = await readJsonFile<Record<string, unknown>>(reportPath);
  const generatedAt = stringValue(report.data?.generated_at);
  const generatedAtMs = generatedAt ? Date.parse(generatedAt) : NaN;
  if (Number.isFinite(generatedAtMs)) return generatedAtMs;
  return fileMtimeMs(reportPath);
}

function predictionAccuracyArtifactTimestampMs(fileName: string): number | null {
  const match = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(\d{6})-/.exec(fileName);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, micros] = match;
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Math.floor(Number(micros) / 1000),
  );
}

async function latestPredictionAccuracyArtifactFreshnessMs(dirPath: string): Promise<number> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const latestName = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort()
      .at(-1);
    if (!latestName) return 0;
    const latestPath = path.join(dirPath, latestName);
    const latestArtifactTimestampMs = predictionAccuracyArtifactTimestampMs(latestName);
    if (latestArtifactTimestampMs !== null) return latestArtifactTimestampMs;
    return fileMtimeMs(latestPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return 0;
    return 0;
  }
}

async function readJsonFile<T>(filePath: string): Promise<{ path: string; data: T | null; message?: string; error?: "missing" | "invalid" | "read" }> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const data = JSON.parse(raw) as T;
    if (looksLikeMockArtifact(data)) {
      return { path: filePath, data: null, error: "invalid", message: "JSON artifact appears corrupt or test-generated." };
    }
    return { path: filePath, data };
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

function extractPredictionHorizonMetrics(
  entries: unknown[],
  filters: { strategy?: string; action?: string; confidenceBucket?: string },
  horizonKey: string,
): Record<string, unknown> | null {
  const match = entries
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .find((entry) => {
      if (filters.strategy && stringValue(entry.strategy) !== filters.strategy) return false;
      if (filters.action && stringValue(entry.action) !== filters.action) return false;
      if (filters.confidenceBucket && stringValue(entry.confidence_bucket) !== filters.confidenceBucket) return false;
      return true;
    });

  return asRecord(match?.[horizonKey]);
}

function formatSignedPercent(value: number): string {
  const rounded = Math.abs(value).toFixed(2);
  return `${value >= 0 ? "+" : "-"}${rounded}%`;
}

function buildOperatorActionItems(
  context: { isBlocked: boolean; fiveDayMatured: number; topBlocker: string | null },
): string[] {
  if (!context.isBlocked) {
    return [
      "Keep size small until the 20d horizon starts maturing.",
      "Monitor whether live BUY quotes stay fresh before acting intraday.",
    ];
  }

  return compactStrings([
    "Treat BUY and WATCH as research-only until the 5d horizon has real sample depth.",
    context.fiveDayMatured < 25
      ? `Wait for at least 25 matured 5d samples before trusting short-term alpha. Currently ${context.fiveDayMatured}.`
      : null,
    "Use NO_BUY as a defensive input only; it is not evidence of profitable long entries.",
    context.topBlocker ? `Audit veto lane ${context.topBlocker} before tightening decision gates further.` : null,
    "Block discretionary execution whenever the live BUY lane is stale or degraded.",
  ]);
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

function looksLikeMockArtifact(value: unknown): boolean {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" && /MagicMock|<MagicMock|\[object MagicMock\]/u.test(serialized);
  } catch {
    return false;
  }
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
