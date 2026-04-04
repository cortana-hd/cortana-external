import { AlertTriangle, ClipboardList, Gauge, Radar, ShieldCheck, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ArtifactState, TradingOpsDashboardData } from "@/lib/trading-ops";
import {
  formatMoney,
  formatPercent,
  formatRelativeAge,
  summarizeStateVariant,
} from "@/lib/trading-ops";

type TradingOpsDashboardProps = {
  data: TradingOpsDashboardData;
};

export function TradingOpsDashboard({ data }: TradingOpsDashboardProps) {
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <Badge variant="outline">Trading Ops</Badge>
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Backtester operator console</h1>
          <p className="max-w-3xl text-sm text-muted-foreground sm:text-base">
            This page pulls the live operator surfaces plus the last workflow artifacts into one read-only view.
            If you are new, read the checklist first. After that, use the tabs to drill into the part you care about.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span>Generated {formatRelativeAge(data.generatedAt)}</span>
          <span>Backtester root: {data.repoPath}</span>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">What to read first</CardTitle>
            <CardDescription>Use this order if you are not sure what matters yet.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <ReadStep title="1. Market posture" body="Read this first. If regime is correction and sizing is 0%, do not force buys." />
            <ReadStep title="2. Runtime health" body="If you see provider cooldown or auth trouble, trust degraded warnings and expect slower signals." />
            <ReadStep title="3. Latest workflow" body="Check whether CANSLIM and Dip Buyer actually finished, and whether any stage failed." />
            <ReadStep title="4. Prediction and lifecycle" body="Use these to judge whether the system is getting better over time, not to override market posture." />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quick answer</CardTitle>
            <CardDescription>If you only want the headline, read this box and stop.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="rounded-lg border border-border/70 bg-card/40 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Right now</p>
              <p className="mt-2 text-lg font-semibold">
                {data.market.data ? `${data.market.data.regime.toUpperCase()} · ${data.market.data.posture}` : data.market.label}
              </p>
              <p className="mt-2 text-muted-foreground">{data.market.message}</p>
            </div>
            <dl className="grid grid-cols-2 gap-3">
              <Metric label="Focus names" value={data.market.data?.focusSymbols.join(", ") || "None yet"} />
              <Metric label="Runtime" value={data.runtime.data?.operatorState ?? data.runtime.label} />
              <Metric label="Workflow" value={data.workflow.data ? data.workflow.data.runId : data.workflow.label} />
              <Metric label="Latest trading run" value={data.tradingRun.data ? data.tradingRun.data.decision : data.tradingRun.label} />
              <Metric label="Open positions" value={String(data.lifecycle.data?.openCount ?? 0)} />
            </dl>
          </CardContent>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          title="Market posture"
          value={data.market.data ? `${data.market.data.regime.toUpperCase()} · ${data.market.data.posture}` : data.market.label}
          subtitle={data.market.message}
          state={data.market.state}
          icon={<Gauge className="h-4 w-4" />}
          detail={data.market.data ? `Sizing ${formatPercent(data.market.data.positionSizingPct)}` : "No market data"}
        />
        <SummaryCard
          title="Runtime health"
          value={data.runtime.data?.operatorState ?? data.runtime.label}
          subtitle={data.runtime.message}
          state={data.runtime.state}
          icon={<ShieldCheck className="h-4 w-4" />}
          detail={data.runtime.data ? `${data.runtime.data.incidents.length} active incidents` : "No runtime snapshot"}
        />
        <SummaryCard
          title="Prediction loop"
          value={data.prediction.data ? `${data.prediction.data.snapshotCount} snapshots` : data.prediction.label}
          subtitle={data.prediction.message}
          state={data.prediction.state}
          icon={<Radar className="h-4 w-4" />}
          detail={data.prediction.data ? `1d matured ${data.prediction.data.oneDayMatured}` : "No accuracy artifact"}
        />
        <SummaryCard
          title="Trade lifecycle"
          value={data.lifecycle.data ? `${data.lifecycle.data.openCount} open / ${data.lifecycle.data.closedCount} closed` : data.lifecycle.label}
          subtitle={data.lifecycle.message}
          state={data.lifecycle.state}
          icon={<Workflow className="h-4 w-4" />}
          detail={data.lifecycle.data ? `Exposure ${formatPercent(data.lifecycle.data.grossExposurePct)}` : "No lifecycle artifact"}
        />
      </section>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="watchlists">Watchlists</TabsTrigger>
          <TabsTrigger value="health">System Health</TabsTrigger>
          <TabsTrigger value="deep-dive">Deep Dive</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]">
            <ArtifactCard title="Market brief" artifact={data.market}>
              {data.market.data ? (
                <div className="space-y-3 text-sm">
                  <p className="font-medium">{data.market.data.reason}</p>
                  <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Metric label="Regime" value={data.market.data.regime.toUpperCase()} />
                    <Metric label="Sizing" value={formatPercent(data.market.data.positionSizingPct)} />
                    <Metric label="Focus" value={data.market.data.focusSymbols.join(", ") || "None yet"} />
                    <Metric label="Next action" value={data.market.data.nextAction ?? "Wait for fresher data"} />
                  </dl>
                  <div className="rounded-lg border border-border/70 bg-muted/40 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Latest strategy summary</p>
                    <p className="mt-1 font-mono text-sm">{data.market.data.alertSummary || "No recent alert summary."}</p>
                  </div>
                </div>
              ) : null}
            </ArtifactCard>

            <ArtifactCard title="Latest trading run" artifact={data.tradingRun}>
              {data.tradingRun.data ? (
                <div className="space-y-3 text-sm">
                  <dl className="grid grid-cols-2 gap-3">
                    <Metric label="Run id" value={data.tradingRun.data.runId} />
                    <Metric
                      label="Decision"
                      value={data.tradingRun.data.decision}
                    />
                  </dl>
                  <dl className="grid grid-cols-2 gap-3">
                    <Metric
                      label="Focus"
                      value={
                        data.tradingRun.data.focusTicker
                          ? `${data.tradingRun.data.focusTicker} · ${data.tradingRun.data.focusAction ?? "n/a"}`
                          : "No focus name"
                      }
                    />
                    <Metric
                      label="Counts"
                      value={`BUY ${data.tradingRun.data.buyCount} · WATCH ${data.tradingRun.data.watchCount} · NO_BUY ${data.tradingRun.data.noBuyCount}`}
                    />
                  </dl>
                  <p className="rounded-lg border border-border/70 bg-card/40 px-3 py-3 text-sm">
                    Open the <span className="font-medium">Watchlists</span> tab to see the full latest run names.
                    Dip Buyer currently has <span className="font-medium">{data.tradingRun.data.dipBuyerWatch.length}</span> watch names.
                  </p>
                  {data.tradingRun.data.messagePreview ? (
                    <details className="rounded-lg border border-border/70 bg-muted/30 p-3">
                      <summary className="cursor-pointer text-sm font-medium">Telegram preview</summary>
                      <pre className="mt-3 whitespace-pre-wrap text-xs text-muted-foreground">
                        {data.tradingRun.data.messagePreview}
                      </pre>
                    </details>
                  ) : null}
                </div>
              ) : null}
            </ArtifactCard>
          </section>

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <ArtifactCard title="Latest workflow" artifact={data.workflow}>
              {data.workflow.data ? (
                <div className="space-y-3 text-sm">
                  <dl className="grid grid-cols-2 gap-3">
                    <Metric label="Run id" value={data.workflow.data.runId} />
                    <Metric
                      label="Stage counts"
                      value={Object.entries(data.workflow.data.stageCounts).map(([status, count]) => `${status}:${count}`).join(" · ")}
                    />
                  </dl>
                  <div className="space-y-2">
                    {data.workflow.data.stageRows.slice(0, 6).map((stage) => (
                      <div key={`${stage.name}-${stage.startedAt}`} className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{stage.name}</p>
                          <p className="text-xs text-muted-foreground">{stage.endedAt || stage.startedAt}</p>
                        </div>
                        <Badge variant={stage.status === "ok" ? "success" : stage.status === "error" ? "destructive" : "outline"}>
                          {stage.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </ArtifactCard>

            <ArtifactCard title="Runtime health" artifact={data.runtime}>
              {data.runtime.data ? (
                <div className="space-y-3 text-sm">
                  <Metric label="Operator action" value={data.runtime.data.operatorAction} />
                  <Metric label="Pre-open gate" value={data.runtime.data.preOpenGateStatus ?? "n/a"} />
                  <div className="space-y-2">
                    {data.runtime.data.incidents.length > 0 ? (
                      data.runtime.data.incidents.map((incident) => (
                        <div key={`${incident.incidentType}-${incident.severity}`} className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-amber-950">
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <AlertTriangle className="h-4 w-4" />
                            {incident.incidentType} · {incident.severity}
                          </div>
                          <p className="mt-1 text-sm">{incident.operatorAction}</p>
                        </div>
                      ))
                    ) : (
                      <p className="text-muted-foreground">No active runtime incidents.</p>
                    )}
                  </div>
                </div>
              ) : null}
            </ArtifactCard>
          </section>
        </TabsContent>

        <TabsContent value="watchlists" className="space-y-4">
          <ArtifactCard title="Latest trading run watchlists" artifact={data.tradingRun}>
            {data.tradingRun.data ? (
              <div className="space-y-4 text-sm">
                <p className="text-muted-foreground">
                  This tab shows every name from the latest trading run so you can scan the full list without crowding the overview.
                </p>
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  <StrategyWatchlistSection
                    strategy="Dip Buyer"
                    buy={data.tradingRun.data.dipBuyerBuy}
                    watch={data.tradingRun.data.dipBuyerWatch}
                    noBuy={data.tradingRun.data.dipBuyerNoBuy}
                  />
                  <StrategyWatchlistSection
                    strategy="CANSLIM"
                    buy={data.tradingRun.data.canslimBuy}
                    watch={data.tradingRun.data.canslimWatch}
                    noBuy={data.tradingRun.data.canslimNoBuy}
                  />
                </div>
              </div>
            ) : null}
          </ArtifactCard>
        </TabsContent>

        <TabsContent value="health" className="space-y-4">
          <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <ArtifactCard title="Pre-open canary" artifact={data.canary}>
              {data.canary.data ? (
                <div className="space-y-3 text-sm">
                  <dl className="grid grid-cols-2 gap-3">
                    <Metric label="Ready for open" value={String(data.canary.data.readyForOpen ?? false)} />
                    <Metric label="Warnings" value={String(data.canary.data.warningCount)} />
                  </dl>
                  <div className="space-y-2">
                    {data.canary.data.checks.map((check) => (
                      <div key={check.name} className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2">
                        <span className="text-sm">{check.name}</span>
                        <Badge variant={check.result === "ok" ? "success" : "warning"}>{check.result}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </ArtifactCard>
          </section>
        </TabsContent>

        <TabsContent value="deep-dive" className="space-y-4">
          <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <ArtifactCard title="Prediction accuracy" artifact={data.prediction}>
              {data.prediction.data ? (
                <div className="space-y-3 text-sm">
                  <Metric label="1d matured" value={String(data.prediction.data.oneDayMatured)} />
                  <Metric label="1d pending" value={String(data.prediction.data.oneDayPending)} />
                  <Metric label="Best visible slice" value={data.prediction.data.bestStrategyLabel ?? "Not enough settled data"} />
                  <Metric label="Trade grades" value={data.prediction.data.decisionGradeHeadline ?? "No grade rollup yet"} />
                </div>
              ) : null}
            </ArtifactCard>

            <ArtifactCard title="Benchmark ladder" artifact={data.benchmark}>
              {data.benchmark.data ? (
                <div className="space-y-3 text-sm">
                  <Metric label="Horizon" value={data.benchmark.data.horizonKey ?? "n/a"} />
                  <Metric label="Matured samples" value={String(data.benchmark.data.maturedCount ?? 0)} />
                  <Metric label="Best visible comparison" value={data.benchmark.data.bestComparisonLabel ?? "Still waiting on mature comparisons"} />
                </div>
              ) : null}
            </ArtifactCard>

            <ArtifactCard title="Paper lifecycle" artifact={data.lifecycle}>
              {data.lifecycle.data ? (
                <div className="space-y-3 text-sm">
                  <Metric label="Total capital" value={formatMoney(data.lifecycle.data.totalCapital)} />
                  <Metric label="Available capital" value={formatMoney(data.lifecycle.data.availableCapital)} />
                  <Metric label="Gross exposure" value={formatPercent(data.lifecycle.data.grossExposurePct)} />
                </div>
              ) : null}
            </ArtifactCard>
          </section>

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_1fr]">
            <ArtifactCard title="Ops highway" artifact={data.opsHighway}>
              {data.opsHighway.data ? (
                <div className="space-y-3 text-sm">
                  <Metric label="Critical assets" value={String(data.opsHighway.data.criticalAssetCount)} />
                  <Metric label="Do not commit paths" value={String(data.opsHighway.data.doNotCommitCount)} />
                  <Metric label="Recovery step 1" value={data.opsHighway.data.firstRecoveryStep ?? "No recovery sequence recorded"} />
                </div>
              ) : null}
            </ArtifactCard>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Why this tab exists</CardTitle>
                <CardDescription>Use this only after the top checklist looks healthy.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <ReadStep title="Prediction accuracy" body="Tells you whether past calls aged well." />
                <ReadStep title="Benchmark ladder" body="Shows whether a strategy is beating a simple baseline." />
                <ReadStep title="Paper lifecycle" body="Shows the paper portfolio and risk state." />
                <ReadStep title="Ops highway" body="Shows recovery and runbook planning, not trading edge." />
              </CardContent>
            </Card>
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ArtifactCard({
  title,
  artifact,
  children,
}: {
  title: string;
  artifact: ArtifactState<unknown>;
  children?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base">{title}</CardTitle>
            <CardDescription>{artifact.message}</CardDescription>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge variant={summarizeStateVariant(artifact.state)}>{artifact.state}</Badge>
            <span className="text-xs text-muted-foreground">
              {artifact.updatedAt ? `Updated ${formatRelativeAge(artifact.updatedAt)}` : "No timestamp"}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {children ?? <p className="text-sm text-muted-foreground">No data available.</p>}
        {artifact.warnings.length > 0 ? (
          <details className="rounded-lg border border-border/70 bg-muted/30 p-3">
            <summary className="cursor-pointer text-sm font-medium">Warnings ({artifact.warnings.length})</summary>
            <ul className="mt-3 space-y-2 text-xs text-muted-foreground">
              {artifact.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </details>
        ) : null}
        {artifact.source ? (
          <p className="text-xs text-muted-foreground">Source: {artifact.source}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SummaryCard({
  title,
  value,
  subtitle,
  detail,
  state,
  icon,
}: {
  title: string;
  value: string;
  subtitle: string;
  detail: string;
  state: ArtifactState<unknown>["state"];
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex items-center justify-between gap-3">
          <CardDescription>{title}</CardDescription>
          <div className="rounded-full bg-primary/10 p-2 text-primary">{icon}</div>
        </div>
        <div className="space-y-2">
          <CardTitle className="text-xl tracking-tight">{value}</CardTitle>
          <Badge variant={summarizeStateVariant(state)}>{state}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm">{subtitle}</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-card/40 px-3 py-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium leading-5">{value}</p>
    </div>
  );
}

function Watchline({ title, tickers }: { title: string; tickers: string[] }) {
  return (
    <div className="rounded-lg border border-border/70 bg-card/40 px-3 py-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{title}</p>
      <p className="mt-1 text-sm font-medium leading-5">{tickers.length > 0 ? tickers.join(", ") : "None right now"}</p>
    </div>
  );
}

function StrategyWatchlistSection({
  strategy,
  buy,
  watch,
  noBuy,
}: {
  strategy: string;
  buy: string[];
  watch: string[];
  noBuy: string[];
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border/70 bg-card/40 p-4">
      <div>
        <p className="text-base font-semibold">{strategy}</p>
        <p className="text-xs text-muted-foreground">
          BUY {buy.length} · WATCH {watch.length} · NO_BUY {noBuy.length}
        </p>
      </div>
      <Watchline title={`${strategy} buy`} tickers={buy} />
      <Watchline title={`${strategy} watch`} tickers={watch} />
      <Watchline title={`${strategy} no-buy`} tickers={noBuy} />
    </div>
  );
}

function ReadStep({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-card/40 px-3 py-3">
      <div className="flex items-start gap-3">
        <ClipboardList className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="space-y-1">
          <p className="font-medium">{title}</p>
          <p className="text-muted-foreground">{body}</p>
        </div>
      </div>
    </div>
  );
}
