import { AlertTriangle, Gauge, Radar, ShieldCheck, Workflow } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TradingOpsDashboardData } from "@/lib/trading-ops";
import { formatMoney, formatPercent } from "@/lib/trading-ops";
import { Metric, StageChip, StrategyWatchlistSection, ArtifactPanel } from "./trading-ops/shared";
import { TerminalHeader } from "./trading-ops/terminal-header";
import { TerminalCell } from "./trading-ops/terminal-cell";
import { AlertBanner } from "./trading-ops/alert-banner";
import { OperatorChecklist } from "./trading-ops/operator-checklist";
import { Badge } from "@/components/ui/badge";

/* ── main component ── */

type TradingOpsDashboardProps = {
  data: TradingOpsDashboardData;
};

export function TradingOpsDashboard({ data }: TradingOpsDashboardProps) {
  const hasIncidents = (data.runtime.data?.incidents.length ?? 0) > 0;
  const hasErrors = [data.market, data.runtime, data.workflow, data.canary].some((a) => a.state === "error");

  return (
    <div className="space-y-3">
      {/* ── Zone A: Terminal Header Bar ── */}
      <TerminalHeader data={data} />

      {/* ── Zone B: Alert Banner (conditional) ── */}
      {(hasIncidents || hasErrors) && <AlertBanner data={data} />}

      {/* ── Zone C: Four Summary Cells ── */}
      <section className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <TerminalCell
          title="Market posture"
          value={data.market.data ? `${data.market.data.regime.toUpperCase()} · ${data.market.data.posture}` : data.market.label}
          detail={data.market.data ? `Sizing ${formatPercent(data.market.data.positionSizingPct)}` : "No market data"}
          state={data.market.state}
          icon={<Gauge className="h-3.5 w-3.5" />}
        />
        <TerminalCell
          title="Runtime health"
          value={data.runtime.data?.operatorState ?? data.runtime.label}
          detail={data.runtime.data ? `${data.runtime.data.incidents.length} active incidents` : "No runtime snapshot"}
          state={data.runtime.state}
          icon={<ShieldCheck className="h-3.5 w-3.5" />}
        />
        <TerminalCell
          title="Prediction loop"
          value={data.prediction.data ? `${data.prediction.data.snapshotCount} snapshots` : data.prediction.label}
          detail={data.prediction.data ? `1d matured ${data.prediction.data.oneDayMatured}` : "No accuracy artifact"}
          state={data.prediction.state}
          icon={<Radar className="h-3.5 w-3.5" />}
        />
        <TerminalCell
          title="Trade lifecycle"
          value={data.lifecycle.data ? `${data.lifecycle.data.openCount} open / ${data.lifecycle.data.closedCount} closed` : data.lifecycle.label}
          detail={data.lifecycle.data ? `Exposure ${formatPercent(data.lifecycle.data.grossExposurePct)}` : "No lifecycle artifact"}
          state={data.lifecycle.state}
          icon={<Workflow className="h-3.5 w-3.5" />}
        />
      </section>

      {/* ── Zone D: Collapsible Operator Checklist ── */}
      <OperatorChecklist />

      {/* ── Zone E: Tabs ── */}
      <Tabs defaultValue="overview" className="space-y-3">
        <TabsList className="w-full justify-start overflow-x-auto font-mono text-xs uppercase tracking-wide">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="watchlists">Watchlists</TabsTrigger>
          <TabsTrigger value="health">System Health</TabsTrigger>
          <TabsTrigger value="deep-dive">Deep Dive</TabsTrigger>
        </TabsList>

        {/* ── Overview ── */}
        <TabsContent value="overview" className="space-y-3">
          <section className="grid grid-cols-1 gap-3 xl:grid-cols-3">
            {/* Column 1: Market Brief */}
            <ArtifactPanel title="Market brief" artifact={data.market}>
              {data.market.data ? (
                <div className="space-y-2 text-sm">
                  <p className="font-medium">{data.market.data.reason}</p>
                  <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Metric label="Regime" value={data.market.data.regime.toUpperCase()} />
                    <Metric label="Sizing" value={formatPercent(data.market.data.positionSizingPct)} />
                    <Metric label="Focus" value={data.market.data.focusSymbols.join(", ") || "None yet"} />
                    <Metric label="Next action" value={data.market.data.nextAction ?? "Wait for fresher data"} />
                  </dl>
                  <div className="rounded-md border border-border/50 bg-muted/30 p-2">
                    <p className="terminal-metric-label">Latest strategy summary</p>
                    <p className="mt-1 font-mono text-xs">{data.market.data.alertSummary || "No recent alert summary."}</p>
                  </div>
                </div>
              ) : null}
            </ArtifactPanel>

            {/* Column 2: Latest Trading Run */}
            <ArtifactPanel title="Latest trading run" artifact={data.tradingRun}>
              {data.tradingRun.data ? (
                <div className="space-y-2 text-sm">
                  <dl className="grid grid-cols-2 gap-2">
                    <Metric label="Run id" value={data.tradingRun.data.runId} />
                    <Metric label="Decision" value={data.tradingRun.data.decision} />
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
                  <p className="rounded-md border border-border/50 bg-muted/30 px-2 py-1.5 text-xs">
                    Open the <span className="font-medium">Watchlists</span> tab to see the full latest run names.
                    Dip Buyer currently has <span className="font-medium">{data.tradingRun.data.dipBuyerWatch.length}</span> watch names.
                  </p>
                  {data.tradingRun.data.messagePreview ? (
                    <details className="rounded-md border border-border/50 bg-muted/30 p-2">
                      <summary className="cursor-pointer text-xs font-medium">Telegram preview</summary>
                      <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-muted-foreground">
                        {data.tradingRun.data.messagePreview}
                      </pre>
                    </details>
                  ) : null}
                </div>
              ) : null}
            </ArtifactPanel>

            {/* Column 3: Workflow + Runtime stacked */}
            <div className="space-y-3">
              <ArtifactPanel title="Latest workflow" artifact={data.workflow}>
                {data.workflow.data ? (
                  <div className="space-y-2 text-sm">
                    <dl className="grid grid-cols-2 gap-2">
                      <Metric label="Run id" value={data.workflow.data.runId} />
                      <Metric
                        label="Stage counts"
                        value={Object.entries(data.workflow.data.stageCounts).map(([s, c]) => `${s}:${c}`).join(" · ")}
                      />
                    </dl>
                    <div className="flex flex-wrap gap-1.5">
                      {data.workflow.data.stageRows.slice(0, 8).map((stage) => (
                        <StageChip key={`${stage.name}-${stage.startedAt}`} name={stage.name} status={stage.status} />
                      ))}
                    </div>
                  </div>
                ) : null}
              </ArtifactPanel>

              <ArtifactPanel title="Runtime health" artifact={data.runtime}>
                {data.runtime.data ? (
                  <div className="space-y-2 text-sm">
                    <Metric label="Operator action" value={data.runtime.data.operatorAction} />
                    <Metric label="Pre-open gate" value={data.runtime.data.preOpenGateStatus ?? "n/a"} />
                    {data.runtime.data.incidents.length > 0 ? (
                      <div className="space-y-1.5">
                        {data.runtime.data.incidents.map((incident) => (
                          <div key={`${incident.incidentType}-${incident.severity}`} className="terminal-alert-warning flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                            <span>{incident.incidentType} · {incident.severity}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">No active runtime incidents.</p>
                    )}
                  </div>
                ) : null}
              </ArtifactPanel>
            </div>
          </section>
        </TabsContent>

        {/* ── Watchlists ── */}
        <TabsContent value="watchlists" className="space-y-3">
          <ArtifactPanel title="Latest trading run watchlists" artifact={data.tradingRun}>
            {data.tradingRun.data ? (
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
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
          </ArtifactPanel>
        </TabsContent>

        {/* ── System Health ── */}
        <TabsContent value="health" className="space-y-3">
          <section className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <ArtifactPanel title="Pre-open canary" artifact={data.canary}>
              {data.canary.data ? (
                <div className="space-y-2 text-sm">
                  <dl className="grid grid-cols-2 gap-2">
                    <Metric label="Ready for open" value={String(data.canary.data.readyForOpen ?? false)} />
                    <Metric label="Warnings" value={String(data.canary.data.warningCount)} />
                  </dl>
                  <div className="space-y-1">
                    {data.canary.data.checks.map((check) => (
                      <div key={check.name} className="flex items-center justify-between rounded-md border border-border/50 px-2 py-1.5 text-xs">
                        <span className="font-mono">{check.name}</span>
                        <Badge variant={check.result === "ok" ? "success" : "warning"} className="text-[10px]">{check.result}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </ArtifactPanel>

            <ArtifactPanel title="Runtime health" artifact={data.runtime}>
              {data.runtime.data ? (
                <div className="space-y-2 text-sm">
                  <Metric label="Operator action" value={data.runtime.data.operatorAction} />
                  <Metric label="Pre-open gate" value={data.runtime.data.preOpenGateStatus ?? "n/a"} />
                  {data.runtime.data.incidents.length > 0 ? (
                    <div className="space-y-1.5">
                      {data.runtime.data.incidents.map((incident) => (
                        <div key={`health-${incident.incidentType}-${incident.severity}`} className="terminal-alert-warning flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          <span>{incident.incidentType} · {incident.severity} — {incident.operatorAction}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No active runtime incidents.</p>
                  )}
                </div>
              ) : null}
            </ArtifactPanel>
          </section>
        </TabsContent>

        {/* ── Deep Dive ── */}
        <TabsContent value="deep-dive" className="space-y-3">
          <section className="grid grid-cols-1 gap-3 xl:grid-cols-3">
            <ArtifactPanel title="Prediction accuracy" artifact={data.prediction}>
              {data.prediction.data ? (
                <div className="space-y-2 text-sm">
                  <Metric label="1d matured" value={String(data.prediction.data.oneDayMatured)} />
                  <Metric label="1d pending" value={String(data.prediction.data.oneDayPending)} />
                  <Metric label="Best visible slice" value={data.prediction.data.bestStrategyLabel ?? "Not enough settled data"} />
                  <Metric label="Trade grades" value={data.prediction.data.decisionGradeHeadline ?? "No grade rollup yet"} />
                </div>
              ) : null}
            </ArtifactPanel>

            <ArtifactPanel title="Benchmark ladder" artifact={data.benchmark}>
              {data.benchmark.data ? (
                <div className="space-y-2 text-sm">
                  <Metric label="Horizon" value={data.benchmark.data.horizonKey ?? "n/a"} />
                  <Metric label="Matured samples" value={String(data.benchmark.data.maturedCount ?? 0)} />
                  <Metric label="Best visible comparison" value={data.benchmark.data.bestComparisonLabel ?? "Still waiting on mature comparisons"} />
                </div>
              ) : null}
            </ArtifactPanel>

            <ArtifactPanel title="Paper lifecycle" artifact={data.lifecycle}>
              {data.lifecycle.data ? (
                <div className="space-y-2 text-sm">
                  <Metric label="Total capital" value={formatMoney(data.lifecycle.data.totalCapital)} />
                  <Metric label="Available capital" value={formatMoney(data.lifecycle.data.availableCapital)} />
                  <Metric label="Gross exposure" value={formatPercent(data.lifecycle.data.grossExposurePct)} />
                </div>
              ) : null}
            </ArtifactPanel>
          </section>

          <section className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <ArtifactPanel title="Ops highway" artifact={data.opsHighway}>
              {data.opsHighway.data ? (
                <div className="space-y-2 text-sm">
                  <Metric label="Critical assets" value={String(data.opsHighway.data.criticalAssetCount)} />
                  <Metric label="Do not commit paths" value={String(data.opsHighway.data.doNotCommitCount)} />
                  <Metric label="Recovery step 1" value={data.opsHighway.data.firstRecoveryStep ?? "No recovery sequence recorded"} />
                </div>
              ) : null}
            </ArtifactPanel>
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
