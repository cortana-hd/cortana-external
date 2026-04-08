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

export type LiveQuoteRow = {
  symbol: string;
  label: string;
  sourceSymbol: string;
  price: number | null;
  changePercent: number | null;
  source: string | null;
  timestamp: string | null;
  state: LoadState;
  warning: string | null;
};

export type LiveStreamerSummary = {
  connected: boolean;
  operatorState: string;
  lastLoginAt: string | null;
  activeEquitySubscriptions: number;
  activeAcctActivitySubscriptions: number;
  cooldownSummary: string | null;
  warnings: string[];
};

export type TradingOpsLiveData = {
  generatedAt: string;
  streamer: LiveStreamerSummary;
  tape: {
    rows: LiveQuoteRow[];
    freshnessMessage: string;
  };
  watchlists: {
    dipBuyer: {
      buy: LiveQuoteRow[];
      watch: LiveQuoteRow[];
    };
    canslim: {
      buy: LiveQuoteRow[];
      watch: LiveQuoteRow[];
    };
  };
  meta: {
    runId: string | null;
    runLabel: string | null;
    decision: string | null;
    focusTicker: string | null;
    isAfterHours: boolean;
  };
  warnings: string[];
};
