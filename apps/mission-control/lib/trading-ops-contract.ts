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
  trustState: string | null;
  freshnessLabel: string | null;
  topStrategyFamily: string | null;
  shadowAgreementLabel: string | null;
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

export type LiveQuoteRow = {
  symbol: string;
  label: string;
  sourceSymbol: string;
  price: number | null;
  changePercent: number | null;
  source: string | null;
  timestamp: string | null;
  stalenessSeconds?: number | null;
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

export type PolymarketAccountOverview = {
  status: string;
  keyIdSuffix: string | null;
  balanceCount: number;
  positionCount: number;
  openOrdersCount: number;
  balances: Array<{
    currency: string;
    currentBalance: number | null;
    buyingPower: number | null;
  }>;
};

export type PolymarketSignalMarket = {
  slug: string;
  title: string;
  theme: string;
  probability: number | null;
  change24h: number | null;
  severity: string;
  persistence: string;
  regimeEffect: string | null;
  watchTickers: string[];
  qualityTier: string | null;
};

export type PolymarketSignalOverview = {
  generatedAt: string | null;
  compactLines: string[];
  alignment: string | null;
  overlaySummary: string | null;
  overlayDetail: string | null;
  conviction: string | null;
  aggressionDial: string | null;
  divergenceSummary: string | null;
  topMarkets: PolymarketSignalMarket[];
};

export type PolymarketWatchlistSymbol = {
  symbol: string;
  assetClass: string;
  themes: string[];
  sourceTitles: string[];
  severity: string;
  persistence: string;
  probability: number | null;
  score: number | null;
};

export type PolymarketWatchlistOverview = {
  updatedAt: string | null;
  totalCount: number;
  buckets: {
    stocks: string[];
    funds: string[];
    crypto: string[];
    cryptoProxies: string[];
  };
  symbols: PolymarketWatchlistSymbol[];
};

export type PolymarketResultRow = {
  marketSlug: string;
  bucket: "events" | "sports";
  title: string;
  eventTitle: string | null;
  league: string | null;
  pinnedAt: string | null;
  status: "open" | "closed" | "settled";
  traded: boolean;
  realizedPnl: number | null;
  netPosition: number | null;
  costBasis: number | null;
  currentValue: number | null;
  unrealizedPnl: number | null;
  settledAt: string | null;
  settlementPrice: number | null;
  outcome: string | null;
  lastActivityAt: string | null;
  resultLabel: string;
};

export type PolymarketResultsOverview = {
  updatedAt: string | null;
  settledCount: number;
  tradedCount: number;
  openPositionCount: number;
  rows: PolymarketResultRow[];
};

export type TradingOpsPolymarketData = {
  generatedAt: string;
  account: ArtifactState<PolymarketAccountOverview>;
  signal: ArtifactState<PolymarketSignalOverview>;
  watchlist: ArtifactState<PolymarketWatchlistOverview>;
  results: ArtifactState<PolymarketResultsOverview>;
};

export type PolymarketLiveStreamerSummary = {
  marketsConnected: boolean;
  privateConnected: boolean;
  operatorState: string;
  trackedMarketCount: number;
  trackedMarketSlugs: string[];
  lastMarketMessageAt: string | null;
  lastPrivateMessageAt: string | null;
  lastError: string | null;
};

export type PolymarketLiveAccountOverview = {
  balance: number | null;
  buyingPower: number | null;
  openOrdersCount: number | null;
  positionCount: number | null;
  lastBalanceUpdateAt: string | null;
  lastOrdersUpdateAt: string | null;
  lastPositionsUpdateAt: string | null;
};

export type PolymarketLiveMarketRow = {
  slug: string;
  title: string;
  bucket: "events" | "sports";
  pinned: boolean;
  pinnedAt: string | null;
  eventTitle: string | null;
  league: string | null;
  bestBid: number | null;
  bestAsk: number | null;
  lastTrade: number | null;
  spread: number | null;
  marketState: string | null;
  sharesTraded: number | null;
  openInterest: number | null;
  tradePrice: number | null;
  tradeQuantity: number | null;
  tradeTime: string | null;
  updatedAt: string | null;
  state: LoadState;
  warning: string | null;
};

export type TradingOpsPolymarketLiveData = {
  generatedAt: string;
  streamer: PolymarketLiveStreamerSummary;
  account: PolymarketLiveAccountOverview;
  roster?: {
    candidateEventsCount: number;
    candidateSportsCount: number;
  };
  markets: PolymarketLiveMarketRow[];
  warnings: string[];
};
