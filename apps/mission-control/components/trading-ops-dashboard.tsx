"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Gauge, Radar, ShieldCheck, Workflow } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ArtifactState, LiveQuoteRow, LoadState, TradingOpsDashboardData, TradingOpsLiveData } from "@/lib/trading-ops-contract";
import { formatCurrency as formatMoney, formatOperatorTimestamp, formatPercentDecimal as formatPercent } from "@/lib/format-utils";
import { Metric, StageChip, StrategyWatchlistSection, ArtifactPanel } from "./trading-ops/shared";
import { TerminalHeader } from "./trading-ops/terminal-header";
import { TerminalCell } from "./trading-ops/terminal-cell";
import { AlertBanner } from "./trading-ops/alert-banner";
import { OperatorChecklist } from "./trading-ops/operator-checklist";
import { Badge } from "@/components/ui/badge";

const LIVE_POLL_MS = 15_000;
const LIVE_STREAM_RETRY_MS = 2_000;
const COMPACT_TAPE_ORDER = ["SPY", "QQQ", "IWM", "DOW", "NASDAQ"];

/* ── main component ── */

type TradingOpsDashboardProps = {
  data: TradingOpsDashboardData;
};

export function TradingOpsDashboard({ data }: TradingOpsDashboardProps) {
  const hasIncidents = (data.runtime.data?.incidents.length ?? 0) > 0;
  const hasErrors = [data.market, data.runtime, data.workflow, data.canary, data.tradingRun].some((a) => a.state === "error");
  const hasTradingRunFallback = data.tradingRun.badgeText === "fallback";
  const [liveData, setLiveData] = useState<TradingOpsLiveData | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [lastSuccessfulAt, setLastSuccessfulAt] = useState<string | null>(null);

  const applyLiveData = useCallback((payload: TradingOpsLiveData) => {
    setLiveData(payload);
    setLiveError(null);
    setLastSuccessfulAt(payload.generatedAt);
  }, []);

  const fetchLiveData = useCallback(async () => {
    try {
      const response = await fetch("/api/trading-ops/live", {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`Live route failed (${response.status})`);
      }

      const payload = (await response.json()) as TradingOpsLiveData;
      applyLiveData(payload);
    } catch (error) {
      setLiveError(error instanceof Error ? error.message : "Live route failed");
    }
  }, [applyLiveData]);

  useEffect(() => {
    let stopped = false;
    let source: EventSource | null = null;
    let fallbackInterval: number | null = null;
    let reconnectTimeout: number | null = null;

    const disconnect = () => {
      source?.close();
      source = null;
    };

    const stopFallback = () => {
      if (fallbackInterval !== null) {
        window.clearInterval(fallbackInterval);
        fallbackInterval = null;
      }
    };

    const startFallback = () => {
      if (fallbackInterval !== null || document.hidden) return;
      fallbackInterval = window.setInterval(() => {
        void fetchLiveData();
      }, LIVE_POLL_MS);
    };

    const scheduleReconnect = () => {
      if (stopped || reconnectTimeout !== null || document.hidden) return;
      reconnectTimeout = window.setTimeout(() => {
        reconnectTimeout = null;
        connect();
      }, LIVE_STREAM_RETRY_MS);
    };

    const connect = () => {
      if (stopped || source || document.hidden || typeof EventSource === "undefined") return;

      try {
        source = new EventSource("/api/trading-ops/live/stream");
        source.addEventListener("snapshot", (event) => {
          try {
            const payload = JSON.parse((event as MessageEvent).data) as TradingOpsLiveData;
            applyLiveData(payload);
            stopFallback();
          } catch {
            setLiveError("Live stream payload could not be parsed.");
          }
        });
        source.addEventListener("warning", (event) => {
          try {
            const payload = JSON.parse((event as MessageEvent).data) as { message?: string };
            setLiveError(payload.message ?? "Live stream warning");
          } catch {
            setLiveError("Live stream warning");
          }
        });
        source.onerror = () => {
          disconnect();
          setLiveError((current) => current ?? "Live stream reconnecting. Falling back to snapshots.");
          void fetchLiveData();
          startFallback();
          scheduleReconnect();
        };
      } catch {
        startFallback();
      }
    };

    void fetchLiveData();
    connect();

    const handleVisibility = () => {
      if (!document.hidden) {
        stopFallback();
        void fetchLiveData();
        connect();
        return;
      }

      disconnect();
      stopFallback();
      if (reconnectTimeout !== null) {
        window.clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      stopped = true;
      disconnect();
      stopFallback();
      if (reconnectTimeout !== null) {
        window.clearTimeout(reconnectTimeout);
      }
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [applyLiveData, fetchLiveData]);

  const liveArtifact = buildLiveArtifact(liveData, liveError, lastSuccessfulAt);

  return (
    <div className="space-y-3">
      {/* ── Zone A: Terminal Header Bar ── */}
      <TerminalHeader data={data} />

      {/* ── Zone B: Alert Banner (conditional) ── */}
      {(hasIncidents || hasErrors || hasTradingRunFallback) && <AlertBanner data={data} />}

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
          detail={
            data.runtime.data?.cooldownSummary ??
            (data.runtime.data ? `${data.runtime.data.incidents.length} active incidents` : "No runtime snapshot")
          }
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
          <TabsTrigger value="live">Live</TabsTrigger>
          <TabsTrigger value="watchlists">Watchlists</TabsTrigger>
          <TabsTrigger value="health">System Health</TabsTrigger>
          <TabsTrigger value="deep-dive">Deep Dive</TabsTrigger>
        </TabsList>

        {/* ── Overview ── */}
        <TabsContent value="overview" className="space-y-3">
          <ArtifactPanel title="Live now" artifact={liveArtifact}>
            {liveData ? (
              <div className="space-y-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={badgeVariantForStreamer(liveData.streamer)} className="text-[10px]">
                    {liveData.streamer.connected ? "Streamer connected" : "REST fallback"}
                  </Badge>
                  <p className="text-xs text-muted-foreground">{liveData.tape.freshnessMessage}</p>
                </div>
                <CompactTapeStrip rows={liveData.tape.rows.filter((row) => COMPACT_TAPE_ORDER.includes(row.symbol))} />
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  <Metric
                    label="Latest run"
                    value={liveData.meta.runLabel ?? liveData.meta.runId ?? "No latest run"}
                  />
                  <Metric label="Decision" value={liveData.meta.decision ?? "No decision yet"} />
                  <Metric
                    label="Last refresh"
                    value={lastSuccessfulAt ? formatOperatorTimestamp(lastSuccessfulAt) : "Waiting for first poll"}
                  />
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Waiting for the first live quote poll.
              </p>
            )}
          </ArtifactPanel>

          <section className="grid grid-cols-1 gap-3 xl:grid-cols-3">
            {/* Column 1: Market Brief */}
            <ArtifactPanel title="Market brief" artifact={data.market}>
              {data.market.data ? (
                <div className="space-y-2 text-sm">
                  <p className="font-medium">{data.market.data.reason}</p>
                  <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Metric label="Regime" value={data.market.data.regime.toUpperCase()} />
                    <Metric label="Sizing" value={formatPercent(data.market.data.positionSizingPct)} />
                    <Metric
                      label={data.market.data.isStale ? "Reference run" : "Focus"}
                      value={
                        data.market.data.isStale
                          ? data.market.data.referenceRunLabel ?? "Latest trading run"
                          : data.market.data.focusSymbols.join(", ") || "None yet"
                      }
                    />
                    <Metric label="Next action" value={data.market.data.nextAction ?? "Wait for fresher data"} />
                  </dl>
                  {data.market.data.isStale ? (
                    <p className="text-xs text-muted-foreground">
                      Cached leader baskets are hidden here because the latest trading run is now the primary source of truth.
                    </p>
                  ) : null}
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
                    <Metric label="Completed" value={data.tradingRun.data.runLabel} />
                    <Metric label="Status" value={data.tradingRun.data.status} />
                    <Metric label="Decision" value={data.tradingRun.data.decision} />
                    <Metric
                      label="Delivered"
                      value={
                        data.tradingRun.data.notifiedAt
                          ? formatOperatorTimestamp(data.tradingRun.data.notifiedAt)
                          : data.tradingRun.data.deliveryStatus === "failed"
                            ? "Failed"
                            : "Pending notification"
                      }
                    />
                    <Metric
                      label="Counts"
                      value={`BUY ${data.tradingRun.data.buyCount} · WATCH ${data.tradingRun.data.watchCount} · NO_BUY ${data.tradingRun.data.noBuyCount}`}
                    />
                  </dl>
                  <p className="text-xs text-muted-foreground">
                    {data.tradingRun.data.sourceType === "db" ? "DB-backed current-state record" : data.tradingRun.data.sourceType === "file_fallback" ? "File artifact fallback" : "Direct artifact read"}
                    {" · "}
                    Internal id {data.tradingRun.data.runId}
                    {data.tradingRun.data.focusTicker
                      ? ` · Focus ${data.tradingRun.data.focusTicker} · ${data.tradingRun.data.focusAction ?? "n/a"}`
                      : ""}
                  </p>
                  {data.tradingRun.data.lastError ? (
                    <p className="rounded-md border border-border/50 bg-muted/30 px-2 py-1.5 text-xs">
                      {data.tradingRun.data.lastError}
                    </p>
                  ) : null}
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
                      <Metric label="Completed" value={data.workflow.data.runLabel} />
                      <Metric
                        label={data.workflow.data.isStale ? "Status" : "Stage counts"}
                        value={
                          data.workflow.data.isStale
                            ? `Historical context${data.workflow.data.referenceRunLabel ? ` · superseded by ${data.workflow.data.referenceRunLabel}` : ""}`
                            : Object.entries(data.workflow.data.stageCounts).map(([s, c]) => `${s}:${c}`).join(" · ")
                        }
                      />
                    </dl>
                    {data.workflow.data.isStale ? (
                      <details className="rounded-md border border-border/50 bg-muted/20 p-2">
                        <summary className="cursor-pointer text-xs font-medium">Older workflow details</summary>
                        <p className="mt-2 text-xs text-muted-foreground">
                          Internal id {data.workflow.data.runId}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Stage counts: {Object.entries(data.workflow.data.stageCounts).map(([s, c]) => `${s}:${c}`).join(" · ")}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {data.workflow.data.stageRows.slice(0, 8).map((stage) => (
                            <StageChip key={`${stage.name}-${stage.startedAt}`} name={stage.name} status={stage.status} />
                          ))}
                        </div>
                      </details>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {data.workflow.data.stageRows.slice(0, 8).map((stage) => (
                          <StageChip key={`${stage.name}-${stage.startedAt}`} name={stage.name} status={stage.status} />
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </ArtifactPanel>

              <ArtifactPanel title="Runtime health" artifact={data.runtime}>
                {data.runtime.data ? (
                  <div className="space-y-2 text-sm">
                    <Metric label="Operator action" value={data.runtime.data.operatorAction} />
                    <Metric label="Pre-open gate" value={data.runtime.data.preOpenGateStatus ?? "Not reported"} />
                    {data.runtime.data.preOpenGateDetail ? (
                      <p className="text-xs text-muted-foreground">{data.runtime.data.preOpenGateDetail}</p>
                    ) : null}
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

        {/* ── Live ── */}
        <TabsContent value="live" className="space-y-3">
          <ArtifactPanel title="Live tape" artifact={liveArtifact}>
            {liveData ? (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">{liveData.tape.freshnessMessage}</p>
                <LiveTapeGrid rows={liveData.tape.rows} />
              </div>
            ) : null}
          </ArtifactPanel>

          <section className="grid grid-cols-1 gap-3 xl:grid-cols-3">
            <ArtifactPanel title="Streamer status" artifact={liveArtifact}>
              {liveData ? (
                <div className="space-y-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={badgeVariantForStreamer(liveData.streamer)} className="text-[10px]">
                      {liveData.streamer.connected ? "Connected" : "Disconnected"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {liveData.streamer.operatorState.replaceAll("_", " ")}
                    </span>
                  </div>
                  <dl className="grid grid-cols-2 gap-2">
                    <Metric label="Last login" value={formatOperatorTimestamp(liveData.streamer.lastLoginAt)} />
                    <Metric label="Equity subs" value={String(liveData.streamer.activeEquitySubscriptions)} />
                    <Metric label="Acct activity" value={String(liveData.streamer.activeAcctActivitySubscriptions)} />
                    <Metric
                      label="Last refresh"
                      value={lastSuccessfulAt ? formatOperatorTimestamp(lastSuccessfulAt) : "—"}
                    />
                  </dl>
                  {liveData.streamer.cooldownSummary ? (
                    <p className="rounded-md border border-border/50 bg-muted/30 px-2 py-1.5 text-xs">
                      {liveData.streamer.cooldownSummary}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </ArtifactPanel>

            <ArtifactPanel title="Dip Buyer live watchlist" artifact={liveArtifact}>
              {liveData ? (
                <div className="space-y-3">
                  <LiveWatchlistGroup label="BUY" rows={liveData.watchlists.dipBuyer.buy} empty="No live Dip Buyer buy names." />
                  <LiveWatchlistGroup label="WATCH" rows={liveData.watchlists.dipBuyer.watch} empty="No live Dip Buyer watch names." />
                </div>
              ) : null}
            </ArtifactPanel>

            <ArtifactPanel title="CANSLIM live watchlist" artifact={liveArtifact}>
              {liveData ? (
                <div className="space-y-3">
                  <LiveWatchlistGroup label="BUY" rows={liveData.watchlists.canslim.buy} empty="No live CANSLIM buy names." />
                  <LiveWatchlistGroup label="WATCH" rows={liveData.watchlists.canslim.watch} empty="No live CANSLIM watch names." />
                </div>
              ) : null}
            </ArtifactPanel>
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
            <ArtifactPanel title="Pre-open readiness check" artifact={data.canary}>
              {data.canary.data ? (
                <div className="space-y-2 text-sm">
                  <dl className="grid grid-cols-2 gap-2">
                    <Metric label="Ready for open" value={String(data.canary.data.readyForOpen ?? false)} />
                    <Metric label="Warnings" value={String(data.canary.data.warningCount)} />
                    <Metric label="Checked" value={data.canary.data.checkedAt ? formatOperatorTimestamp(data.canary.data.checkedAt) : "—"} />
                    <Metric label="Freshness" value={data.canary.data.freshness} />
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
                  <Metric label="Pre-open gate" value={data.runtime.data.preOpenGateStatus ?? "Not reported"} />
                  {data.runtime.data.cooldownSummary ? (
                    <Metric label="Cooldown summary" value={data.runtime.data.cooldownSummary} />
                  ) : null}
                  {data.runtime.data.preOpenGateFreshness ? (
                    <Metric label="Readiness freshness" value={data.runtime.data.preOpenGateFreshness} />
                  ) : null}
                  {data.runtime.data.preOpenGateDetail ? (
                    <p className="text-xs text-muted-foreground">{data.runtime.data.preOpenGateDetail}</p>
                  ) : null}
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

function buildLiveArtifact(
  liveData: TradingOpsLiveData | null,
  liveError: string | null,
  lastSuccessfulAt: string | null,
): ArtifactState<TradingOpsLiveData> {
  if (!liveData) {
    return {
      state: liveError ? "error" : "missing",
      label: liveError ? "Live unavailable" : "Loading live data",
      message: liveError ?? "Streaming live tape and streamer health.",
      data: null,
      updatedAt: lastSuccessfulAt,
      source: "/api/trading-ops/live/stream",
      warnings: liveError ? [liveError] : [],
    };
  }

  const hasProblems =
    liveData.streamer.operatorState !== "healthy" ||
    liveData.tape.rows.some((row) => row.state !== "ok");

  return {
    state: hasProblems ? "degraded" : "ok",
    label: liveData.streamer.connected ? "Live stream" : "Fallback live data",
    message: liveError
      ? `${liveData.tape.freshnessMessage} Last request error: ${liveError}`
      : liveData.tape.freshnessMessage,
    data: liveData,
    updatedAt: lastSuccessfulAt ?? liveData.generatedAt,
    source: "/api/trading-ops/live/stream",
    warnings: liveError ? [liveError, ...liveData.warnings] : liveData.warnings,
  };
}

function badgeVariantForStreamer(streamer: TradingOpsLiveData["streamer"]) {
  if (streamer.connected && streamer.operatorState === "healthy") return "success" as const;
  if (streamer.connected) return "warning" as const;
  return "info" as const;
}

function CompactTapeStrip({ rows }: { rows: LiveQuoteRow[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
      {rows.map((row) => (
        <div
          key={`${row.symbol}-${row.sourceSymbol}`}
          className="min-w-0 rounded-md border border-border/50 bg-muted/20 px-3 py-3"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-xs font-semibold">{row.label}</span>
            <QuoteStateBadge row={row} compact />
          </div>
          <p className="mt-2 font-mono text-sm font-medium">{formatQuotePrice(row.price)}</p>
          <p className={`text-xs ${quoteChangeTextClass(row.changePercent, row.state)}`}>
            {formatQuoteChange(row.changePercent)}
          </p>
        </div>
      ))}
    </div>
  );
}

function LiveTapeGrid({ rows }: { rows: LiveQuoteRow[] }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((row) => (
        <div key={`${row.symbol}-${row.sourceSymbol}`} className="rounded-md border border-border/50 bg-muted/20 p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="font-mono text-sm font-semibold">{row.label}</p>
              <p className="text-[11px] text-muted-foreground">via {row.sourceSymbol}</p>
            </div>
            <QuoteStateBadge row={row} />
          </div>
          <p className="mt-3 font-mono text-lg font-medium">{formatQuotePrice(row.price)}</p>
          <p className={`mt-1 text-sm ${quoteChangeTextClass(row.changePercent, row.state)}`}>
            {formatQuoteChange(row.changePercent)}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {row.timestamp ? formatOperatorTimestamp(row.timestamp) : "Timestamp unavailable"}
          </p>
        </div>
      ))}
    </div>
  );
}

function LiveWatchlistGroup({
  label,
  rows,
  empty,
}: {
  label: string;
  rows: LiveQuoteRow[];
  empty: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-xs font-semibold">{label}</p>
        <p className="text-[11px] text-muted-foreground">{rows.length} names</p>
      </div>
      {rows.length > 0 ? (
        <div className="space-y-1.5">
          {rows.map((row) => (
            <div
              key={`${label}-${row.symbol}-${row.sourceSymbol}`}
              className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-md border border-border/50 bg-muted/20 px-2 py-2"
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-sm font-medium">{row.symbol}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {row.source === "schwab_streamer"
                    ? "Streamer"
                    : row.source
                      ? `Source ${row.source}`
                      : "Quote unavailable"}
                </p>
              </div>
              <p className="font-mono text-sm">{formatQuotePrice(row.price)}</p>
              <p className={`font-mono text-xs ${quoteChangeTextClass(row.changePercent, row.state)}`}>
                {formatQuoteChange(row.changePercent)}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}

function QuoteStateBadge({ row, compact = false }: { row: LiveQuoteRow; compact?: boolean }) {
  return (
    <Badge variant={badgeVariantForQuoteState(row.state)} className={compact ? "px-1.5 py-0 text-[9px]" : "text-[10px]"}>
      {quoteBadgeLabel(row)}
    </Badge>
  );
}

function badgeVariantForQuoteState(state: LoadState) {
  if (state === "ok") return "success" as const;
  if (state === "degraded") return "warning" as const;
  if (state === "error") return "destructive" as const;
  return "outline" as const;
}

function quoteBadgeLabel(row: LiveQuoteRow): string {
  if (row.state === "ok" && row.source === "schwab_streamer") return "live";
  if (row.state === "ok") return "rest";
  if (row.state === "degraded") return "degraded";
  if (row.state === "error") return "error";
  return "missing";
}

function formatQuotePrice(value: number | null): string {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value >= 100 ? 2 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatQuoteChange(value: number | null): string {
  if (value == null || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function quoteChangeTextClass(changePercent: number | null, state: LoadState): string {
  if (state === "error" || state === "missing") return "text-muted-foreground";
  if (changePercent == null || Number.isNaN(changePercent)) return "text-muted-foreground";
  if (changePercent > 0) return "text-emerald-600 dark:text-emerald-400";
  if (changePercent < 0) return "text-red-600 dark:text-red-400";
  return "text-muted-foreground";
}
