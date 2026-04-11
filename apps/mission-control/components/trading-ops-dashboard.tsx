"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Gauge, Landmark, Radar, ShieldCheck, Workflow } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type {
  ArtifactState,
  FinancialServiceHealthRow,
  PolymarketAccountOverview,
  PolymarketResultRow,
  PolymarketResultsOverview,
  TradingOpsPolymarketLiveData,
  PolymarketSignalOverview,
  PolymarketWatchlistOverview,
  TradingOpsDashboardData,
  TradingOpsLiveData,
  TradingOpsPolymarketData,
} from "@/lib/trading-ops-contract";
import {
  getPolymarketLinkedAssetClass,
  getPolymarketLiveEventLink,
  getPolymarketLiveMarketProbability,
  getPolymarketSeverity,
} from "@/lib/trading-ops-polymarket-links";
import { formatCurrency as formatMoney, formatOperatorTimestamp, formatPercentDecimal as formatPercent } from "@/lib/format-utils";
import { Metric, StageChip, StrategyWatchlistSection, ArtifactPanel } from "./trading-ops/shared";
import { TerminalHeader } from "./trading-ops/terminal-header";
import { TerminalCell } from "./trading-ops/terminal-cell";
import { AlertBanner } from "./trading-ops/alert-banner";
import { OperatorChecklist } from "./trading-ops/operator-checklist";
import { CompactTapeStrip, LiveTapeGrid, LiveWatchlistGroup, useAnimatedValue, useFlashClass } from "./trading-ops/animated-quote";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const LIVE_POLL_MS = 15_000;
const LIVE_STREAM_RETRY_MS = 2_000;
const POLYMARKET_POLL_MS = 30_000;
const POLYMARKET_LIVE_POLL_MS = 15_000;
const POLYMARKET_LIVE_STREAM_RETRY_MS = 2_000;
const COMPACT_TAPE_ORDER = ["SPY", "QQQ", "IWM", "DOW", "NASDAQ"];

type PolymarketLinkedSymbolCardRow = {
  symbol: string;
  assetClass: string;
  theme: string;
  sourceTitle: string;
  eventTitle: string | null;
  probability: number | null;
  severity: string;
  regimeEffect: string | null;
  marketState: string | null;
  spread: number | null;
  updatedAt: string | null;
  state: TradingOpsPolymarketLiveData["markets"][number]["state"];
  warning: string | null;
};

/* ── main component ── */

type TradingOpsDashboardProps = {
  data: TradingOpsDashboardData;
};

export function TradingOpsDashboard({ data }: TradingOpsDashboardProps) {
  const hasIncidents = (data.runtime.data?.incidents.length ?? 0) > 0;
  const hasErrors = [data.market, data.runtime, data.workflow, data.canary, data.financialServices, data.tradingRun].some((a) => a.state === "error");
  const hasTradingRunFallback = data.tradingRun.badgeText === "fallback";
  const [liveData, setLiveData] = useState<TradingOpsLiveData | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [lastSuccessfulAt, setLastSuccessfulAt] = useState<string | null>(null);
  const [polymarketData, setPolymarketData] = useState<TradingOpsPolymarketData | null>(null);
  const [polymarketError, setPolymarketError] = useState<string | null>(null);
  const [polymarketLiveData, setPolymarketLiveData] = useState<TradingOpsPolymarketLiveData | null>(null);
  const [polymarketLiveError, setPolymarketLiveError] = useState<string | null>(null);
  const [lastPolymarketLiveAt, setLastPolymarketLiveAt] = useState<string | null>(null);
  const [polymarketPinPendingSlugs, setPolymarketPinPendingSlugs] = useState<string[]>([]);

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

  const applyPolymarketData = useCallback((payload: TradingOpsPolymarketData) => {
    setPolymarketData(payload);
    setPolymarketError(null);
  }, []);

  const applyPolymarketLiveData = useCallback((payload: TradingOpsPolymarketLiveData) => {
    setPolymarketLiveData(payload);
    setPolymarketLiveError(null);
    setLastPolymarketLiveAt(payload.generatedAt);
  }, []);

  const fetchPolymarketData = useCallback(async () => {
    try {
      const response = await fetch("/api/trading-ops/polymarket", {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`Polymarket route failed (${response.status})`);
      }

      const payload = (await response.json()) as unknown;
      if (!isPolymarketPayload(payload)) {
        throw new Error("Polymarket route returned an invalid payload");
      }
      applyPolymarketData(payload);
    } catch (error) {
      setPolymarketError(error instanceof Error ? error.message : "Polymarket route failed");
    }
  }, [applyPolymarketData]);

  const fetchPolymarketLiveData = useCallback(async () => {
    try {
      const response = await fetch("/api/trading-ops/polymarket/live", {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`Polymarket live route failed (${response.status})`);
      }

      const payload = (await response.json()) as unknown;
      if (!isPolymarketLivePayload(payload)) {
        throw new Error("Polymarket live route returned an invalid payload");
      }
      applyPolymarketLiveData(payload);
    } catch (error) {
      setPolymarketLiveError(error instanceof Error ? error.message : "Polymarket live route failed");
    }
  }, [applyPolymarketLiveData]);

  const mutatePolymarketPin = useCallback(async (
    market: TradingOpsPolymarketLiveData["markets"][number],
    action: "pin" | "remove",
  ) => {
    try {
      setPolymarketPinPendingSlugs((current) => (
        current.includes(market.slug) ? current : [...current, market.slug]
      ));
      const response = await fetch(
        action === "pin"
          ? "/api/trading-ops/polymarket/pins"
          : `/api/trading-ops/polymarket/pins/${encodeURIComponent(market.slug)}`,
        {
          method: action === "pin" ? "POST" : "DELETE",
          headers: action === "pin" ? { "content-type": "application/json" } : undefined,
          body:
            action === "pin"
              ? JSON.stringify({
                  marketSlug: market.slug,
                  bucket: market.bucket,
                  title: market.title || "Untitled market",
                  eventTitle: market.eventTitle,
                  league: market.league,
                })
              : undefined,
        },
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? `Polymarket ${action} failed (${response.status})`);
      }

      await fetchPolymarketLiveData();
    } catch (error) {
      setPolymarketLiveError(error instanceof Error ? error.message : `Polymarket ${action} failed`);
    } finally {
      setPolymarketPinPendingSlugs((current) => current.filter((slug) => slug !== market.slug));
    }
  }, [fetchPolymarketLiveData]);

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

  useEffect(() => {
    let intervalId: number | null = null;

    const run = () => {
      if (document.hidden) return;
      void fetchPolymarketData();
    };

    run();
    intervalId = window.setInterval(run, POLYMARKET_POLL_MS);
    const handleVisibility = () => {
      if (!document.hidden) {
        run();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchPolymarketData]);

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
        void fetchPolymarketLiveData();
      }, POLYMARKET_LIVE_POLL_MS);
    };

    const scheduleReconnect = () => {
      if (stopped || reconnectTimeout !== null || document.hidden) return;
      reconnectTimeout = window.setTimeout(() => {
        reconnectTimeout = null;
        connect();
      }, POLYMARKET_LIVE_STREAM_RETRY_MS);
    };

    const connect = () => {
      if (stopped || source || document.hidden || typeof EventSource === "undefined") return;

      try {
        source = new EventSource("/api/trading-ops/polymarket/live/stream");
        source.addEventListener("snapshot", (event) => {
          try {
            const payload = JSON.parse((event as MessageEvent).data) as TradingOpsPolymarketLiveData;
            applyPolymarketLiveData(payload);
            stopFallback();
          } catch {
            setPolymarketLiveError("Polymarket live stream payload could not be parsed.");
          }
        });
        source.addEventListener("warning", (event) => {
          try {
            const payload = JSON.parse((event as MessageEvent).data) as { message?: string };
            setPolymarketLiveError(payload.message ?? "Polymarket live stream warning");
          } catch {
            setPolymarketLiveError("Polymarket live stream warning");
          }
        });
        source.onerror = () => {
          disconnect();
          setPolymarketLiveError((current) => current ?? "Polymarket live stream reconnecting. Falling back to snapshots.");
          void fetchPolymarketLiveData();
          startFallback();
          scheduleReconnect();
        };
      } catch {
        startFallback();
      }
    };

    void fetchPolymarketLiveData();
    connect();

    const handleVisibility = () => {
      if (!document.hidden) {
        stopFallback();
        void fetchPolymarketLiveData();
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
  }, [applyPolymarketLiveData, fetchPolymarketLiveData]);

  const liveArtifact = buildLiveArtifact(liveData, liveError, lastSuccessfulAt);
  const polymarketStatusArtifact = buildPolymarketStatusArtifact(polymarketData, polymarketError);
  const polymarketLiveArtifact = buildPolymarketLiveArtifact(
    polymarketLiveData,
    polymarketLiveError,
    lastPolymarketLiveAt,
  );
  const polymarketAccountArtifact =
    polymarketData?.account ?? buildPendingArtifact<PolymarketAccountOverview>("Loading account", polymarketError);
  const polymarketSignalArtifact =
    polymarketData?.signal ?? buildPendingArtifact<PolymarketSignalOverview>("Loading overlay", polymarketError);
  const polymarketWatchlistArtifact =
    polymarketData?.watchlist ?? buildPendingArtifact<PolymarketWatchlistOverview>("Loading watchlist", polymarketError);
  const polymarketResultsArtifact =
    polymarketData?.results ?? buildPendingArtifact<PolymarketResultsOverview>("Loading results", polymarketError);
  const tradingRunSymbols = collectTradingRunSymbols(data);
  const polymarketOverlap = (polymarketData?.watchlist.data?.symbols ?? [])
    .map((entry) => entry.symbol)
    .filter((symbol) => tradingRunSymbols.has(symbol));
  const polymarketLinkedSymbolRows = buildPolymarketLinkedSymbolRows(polymarketLiveData);
  const polymarketPinnedRows = (polymarketLiveData?.markets ?? []).filter((market) => market.pinned);
  const polymarketPinnedEventRows = polymarketPinnedRows.filter((market) => market.bucket === "events");
  const polymarketPinnedSportsRows = polymarketPinnedRows.filter((market) => market.bucket === "sports");
  const polymarketEventRows = (polymarketLiveData?.markets ?? []).filter((market) => market.bucket === "events" && !market.pinned);
  const polymarketSportsRows = (polymarketLiveData?.markets ?? []).filter((market) => market.bucket === "sports" && !market.pinned);
  const polymarketEventBoardEmptyState = describePolymarketBoardEmptyState({
    bucket: "events",
    visibleCount: polymarketEventRows.length,
    pinnedCount: polymarketPinnedEventRows.length,
    candidateCount: polymarketLiveData?.roster?.candidateEventsCount ?? 0,
    warnings: polymarketLiveArtifact.warnings,
  });
  const polymarketSportsBoardEmptyState = describePolymarketBoardEmptyState({
    bucket: "sports",
    visibleCount: polymarketSportsRows.length,
    pinnedCount: polymarketPinnedSportsRows.length,
    candidateCount: polymarketLiveData?.roster?.candidateSportsCount ?? 0,
    warnings: polymarketLiveArtifact.warnings,
  });
  const polymarketEventRosterState = usePolymarketRosterState(
    polymarketEventRows,
    polymarketLiveData?.streamer.lastMarketMessageAt ?? polymarketLiveData?.generatedAt ?? null,
  );
  const polymarketSportsRosterState = usePolymarketRosterState(
    polymarketSportsRows,
    polymarketLiveData?.streamer.lastMarketMessageAt ?? polymarketLiveData?.generatedAt ?? null,
  );
  const polymarketResultsRows = polymarketData?.results.data?.rows ?? [];
  const polymarketResultsBySlug = new Map(polymarketResultsRows.map((row) => [row.marketSlug, row]));
  const polymarketSettledRows = polymarketResultsRows.filter((row) => row.status === "settled");
  const polymarketStreamCardArtifact = polymarketLiveData
    ? {
        ...polymarketLiveArtifact,
        message: polymarketLiveData.streamer.marketsConnected && polymarketLiveData.streamer.privateConnected
          ? "Market and private streams are live."
          : "One or more Polymarket streams are reconnecting.",
      }
    : polymarketLiveArtifact;
  const polymarketPinnedCardArtifact = polymarketLiveData
    ? {
        ...polymarketLiveArtifact,
        message: polymarketPinnedRows.length > 0
          ? `${polymarketPinnedRows.length} pinned market${polymarketPinnedRows.length === 1 ? "" : "s"} staying on the live board.`
          : "Pin a market to keep it on screen with live pricing and economics.",
        badgeText: String(polymarketPinnedRows.length),
      }
    : polymarketLiveArtifact;
  const polymarketEventsCardArtifact = polymarketLiveData
    ? {
        ...polymarketLiveArtifact,
        message: polymarketEventRows.length > 0
          ? `${polymarketEventRows.length} live event contracts are rotating in the board now.`
          : polymarketEventBoardEmptyState.message,
        badgeText: String(polymarketEventRows.length),
      }
    : polymarketLiveArtifact;
  const polymarketSportsCardArtifact = polymarketLiveData
    ? {
        ...polymarketLiveArtifact,
        message: polymarketSportsRows.length > 0
          ? `${polymarketSportsRows.length} live sports contracts are rotating in the board now.`
          : polymarketSportsBoardEmptyState.message,
        badgeText: String(polymarketSportsRows.length),
      }
    : polymarketLiveArtifact;

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
          <TabsTrigger value="polymarket">Polymarket</TabsTrigger>
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

          <ArtifactPanel title="Polymarket status" artifact={polymarketStatusArtifact}>
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <Metric
                  label="Account"
                  value={
                    polymarketData?.account.data
                      ? `${polymarketData.account.data.positionCount} positions · ${polymarketData.account.data.openOrdersCount} orders`
                      : "Waiting for account read"
                  }
                />
                <Metric
                  label="Overlay"
                  value={polymarketData?.signal.data?.overlaySummary ?? polymarketData?.signal.data?.alignment ?? "Loading"}
                />
                <Metric
                  label="Linked symbols"
                  value={String(polymarketData?.watchlist.data?.totalCount ?? 0)}
                />
                <Metric
                  label="Trading Ops overlap"
                  value={polymarketOverlap.length > 0 ? polymarketOverlap.slice(0, 4).join(", ") : "None yet"}
                />
                <Metric
                  label="Stream"
                  value={
                    polymarketLiveData
                      ? polymarketLiveData.streamer.marketsConnected && polymarketLiveData.streamer.privateConnected
                        ? `${polymarketLiveData.markets.length} live markets`
                        : formatLabel(polymarketLiveData.streamer.operatorState)
                      : "Waiting for stream"
                  }
                />
              </div>
              {polymarketData?.signal.data?.compactLines[0] ? (
                <p className="rounded-md border border-border/50 bg-muted/30 px-2 py-1.5 text-xs">
                  {polymarketData.signal.data.compactLines[0]}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Waiting for the Polymarket overlay snapshot.
                </p>
              )}
            </div>
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

        {/* ── Polymarket ── */}
        <TabsContent value="polymarket" className="space-y-3">
          <section className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <ArtifactPanel title="Live stream" artifact={polymarketStreamCardArtifact}>
              {polymarketLiveData ? (
                <div className="space-y-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={badgeVariantForPolymarketStreamer(polymarketLiveData)} className="text-[10px]">
                      {polymarketLiveData.streamer.marketsConnected ? "Markets live" : "Markets reconnecting"}
                    </Badge>
                    <Badge variant={polymarketLiveData.streamer.privateConnected ? "success" : "outline"} className="text-[10px]">
                      {polymarketLiveData.streamer.privateConnected ? "Private live" : "Private waiting"}
                    </Badge>
                    <p className="text-xs text-muted-foreground">
                      Last refresh {lastPolymarketLiveAt ? formatOperatorTimestamp(lastPolymarketLiveAt) : "waiting"}.
                    </p>
                  </div>
                  <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    <Metric label="Tracked markets" value={String(polymarketLiveData.streamer.trackedMarketCount)} />
                    <Metric label="Open orders" value={String(polymarketLiveData.account.openOrdersCount ?? 0)} />
                    <Metric label="Positions" value={String(polymarketLiveData.account.positionCount ?? 0)} />
                    <Metric label="Buying power" value={formatMoney(polymarketLiveData.account.buyingPower)} />
                    <Metric label="Last market msg" value={formatOperatorTimestamp(polymarketLiveData.streamer.lastMarketMessageAt)} />
                    <Metric label="Last private msg" value={formatOperatorTimestamp(polymarketLiveData.streamer.lastPrivateMessageAt)} />
                  </dl>
                  {polymarketLinkedSymbolRows.length > 0 ? (
                    <div className="space-y-1.5">
                      <div>
                        <p className="terminal-metric-label">Polymarket-linked symbols</p>
                        <p className="text-xs text-muted-foreground">
                          Live symbol context derived from Polymarket event markets. These are symbol links and probabilities, not stock quotes.
                        </p>
                      </div>
                      <PolymarketLinkedSymbolGrid rows={polymarketLinkedSymbolRows} />
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No linked stock or ETF signals are active on the current Polymarket event roster.
                    </p>
                  )}
                </div>
              ) : null}
            </ArtifactPanel>

            <ArtifactPanel title="Pinned" artifact={polymarketPinnedCardArtifact}>
              {polymarketLiveData ? (
                <div className="space-y-3 text-sm">
                  <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <Metric label="Pinned count" value={String(polymarketPinnedRows.length)} />
                    <Metric label="Open live" value={String(polymarketData?.results.data?.openPositionCount ?? 0)} />
                    <Metric label="Settled" value={String(polymarketData?.results.data?.settledCount ?? 0)} />
                  </dl>
                  {polymarketPinnedRows.length > 0 ? (
                    <div className="space-y-1.5">
                      {polymarketPinnedRows.map((market) => renderPolymarketMarketCard(market, {
                        pending: polymarketPinPendingSlugs.includes(market.slug),
                        result: polymarketResultsBySlug.get(market.slug) ?? null,
                        onToggle: () => void mutatePolymarketPin(market, "remove"),
                      }))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Pin a market from the event or sports boards to keep it here with live pricing and economics.
                    </p>
                  )}
                </div>
              ) : null}
            </ArtifactPanel>
          </section>

          <section className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <ArtifactPanel title="Top events" artifact={polymarketEventsCardArtifact}>
              {polymarketLiveData ? (
                <div className="space-y-3 text-sm">
                  {polymarketEventBoardEmptyState.kind !== "exhausted" ? (
                    <RosterChangeSummary state={polymarketEventRosterState} />
                  ) : null}
                  <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <RosterMetric label="Contracts" value={String(polymarketEventRows.length)} />
                    <RosterMetric
                      label="Leader"
                      value={polymarketEventRows[0]?.title ?? (polymarketEventBoardEmptyState.kind === "exhausted" ? "Pinned all available" : "Waiting")}
                      highlight={polymarketEventRosterState.leaderChanged}
                    />
                    <RosterMetric label="Updated" value={formatOperatorTimestamp(polymarketLiveData.streamer.lastMarketMessageAt)} />
                  </dl>
                  {polymarketEventRows.length > 0 ? (
                    <div className="space-y-1.5">
                      {polymarketEventRows.map((market) => renderPolymarketMarketCard(market, {
                        pending: polymarketPinPendingSlugs.includes(market.slug),
                        result: polymarketResultsBySlug.get(market.slug) ?? null,
                        rosterNew: polymarketEventRosterState.newSlugs.has(market.slug),
                        onToggle: () => void mutatePolymarketPin(market, "pin"),
                      }))}
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">{polymarketEventBoardEmptyState.message}</p>
                      <p className="text-xs text-muted-foreground">{polymarketEventBoardEmptyState.detail}</p>
                    </div>
                  )}
                </div>
              ) : null}
            </ArtifactPanel>

            <ArtifactPanel title="Top sports" artifact={polymarketSportsCardArtifact}>
              {polymarketLiveData ? (
                <div className="space-y-3 text-sm">
                  {polymarketSportsBoardEmptyState.kind !== "exhausted" ? (
                    <RosterChangeSummary state={polymarketSportsRosterState} />
                  ) : null}
                  <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <RosterMetric label="Contracts" value={String(polymarketSportsRows.length)} />
                    <RosterMetric
                      label="Leader"
                      value={polymarketSportsRows[0]?.title ?? (polymarketSportsBoardEmptyState.kind === "exhausted" ? "Pinned all available" : "Waiting")}
                      highlight={polymarketSportsRosterState.leaderChanged}
                    />
                    <RosterMetric label="Updated" value={formatOperatorTimestamp(polymarketLiveData.streamer.lastMarketMessageAt)} />
                  </dl>
                  {polymarketSportsRows.length > 0 ? (
                    <div className="space-y-1.5">
                      {polymarketSportsRows.map((market) => renderPolymarketMarketCard(market, {
                        pending: polymarketPinPendingSlugs.includes(market.slug),
                        result: polymarketResultsBySlug.get(market.slug) ?? null,
                        rosterNew: polymarketSportsRosterState.newSlugs.has(market.slug),
                        onToggle: () => void mutatePolymarketPin(market, "pin"),
                      }))}
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">{polymarketSportsBoardEmptyState.message}</p>
                      <p className="text-xs text-muted-foreground">{polymarketSportsBoardEmptyState.detail}</p>
                    </div>
                  )}
                </div>
              ) : null}
            </ArtifactPanel>
          </section>

          <section className="grid grid-cols-1 gap-3 xl:grid-cols-4">
            <ArtifactPanel title="Account" artifact={polymarketAccountArtifact}>
              {polymarketData?.account.data ? (
                <div className="space-y-2 text-sm">
                  <dl className="grid grid-cols-2 gap-2">
                    <Metric label="Status" value={formatLabel(polymarketData.account.data.status)} />
                    <Metric
                      label="Key"
                      value={polymarketData.account.data.keyIdSuffix ? `...${polymarketData.account.data.keyIdSuffix}` : "Not exposed"}
                    />
                    <Metric label="Balances" value={String(polymarketData.account.data.balanceCount)} />
                    <Metric label="Positions" value={String(polymarketData.account.data.positionCount)} />
                    <Metric label="Open orders" value={String(polymarketData.account.data.openOrdersCount)} />
                  </dl>
                  {polymarketData.account.data.balances.length > 0 ? (
                    <div className="space-y-1.5">
                      {polymarketData.account.data.balances.map((balance) => (
                        <div key={balance.currency} className="flex items-center justify-between rounded-md border border-border/50 px-2 py-1.5 text-xs">
                          <span className="font-mono">{balance.currency}</span>
                          <span>
                            {formatMoney(balance.currentBalance)} current
                            {" · "}
                            {formatMoney(balance.buyingPower)} buying power
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No funded balances or settled buying power yet.</p>
                  )}
                </div>
              ) : null}
            </ArtifactPanel>

            <ArtifactPanel title="Signal overlay" artifact={polymarketSignalArtifact}>
              {polymarketData?.signal.data ? (
                <div className="space-y-3 text-sm">
                  <div className="rounded-md border border-border/50 bg-muted/30 p-2">
                    <p className="terminal-metric-label">Overlay summary</p>
                    <p className="mt-1 font-medium">
                      {polymarketData.signal.data.overlaySummary ?? "No overlay summary yet"}
                    </p>
                    {polymarketData.signal.data.overlayDetail ? (
                      <p className="mt-1 text-xs text-muted-foreground">{polymarketData.signal.data.overlayDetail}</p>
                    ) : null}
                  </div>
                  <dl className="grid grid-cols-2 gap-2">
                    <Metric label="Alignment" value={formatLabel(polymarketData.signal.data.alignment)} />
                    <Metric label="Conviction" value={formatLabel(polymarketData.signal.data.conviction)} />
                    <Metric label="Aggression" value={formatLabel(polymarketData.signal.data.aggressionDial)} />
                    <Metric label="Divergence" value={polymarketData.signal.data.divergenceSummary ?? "None flagged"} />
                  </dl>
                  {polymarketData.signal.data.topMarkets.length > 0 ? (
                    <div className="space-y-2">
                      {polymarketData.signal.data.topMarkets.map((market) => (
                        <div key={`${market.theme}-${market.title}`} className="rounded-md border border-border/50 bg-muted/20 p-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="font-medium">{market.title}</p>
                            <div className="flex flex-wrap gap-1.5">
                              <Badge variant={badgeVariantForMarketSeverity(market.severity)} className="text-[10px]">
                                {market.severity}
                              </Badge>
                              <Badge variant="outline" className="text-[10px]">
                                {formatProbability(market.probability)}
                              </Badge>
                              <Badge variant="outline" className="text-[10px]">
                                {formatProbabilityDelta(market.change24h)}
                              </Badge>
                            </div>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatLabel(market.theme)}
                            {" · "}
                            persistence {formatLabel(market.persistence)}
                            {market.regimeEffect ? ` · regime ${formatLabel(market.regimeEffect)}` : ""}
                          </p>
                          {market.watchTickers.length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {market.watchTickers.slice(0, 6).map((ticker) => (
                                <Badge key={`${market.title}-${ticker}`} variant="outline" className="font-mono text-[10px]">
                                  {ticker}
                                </Badge>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </ArtifactPanel>

            <ArtifactPanel title="Linked watchlist" artifact={polymarketWatchlistArtifact}>
              {polymarketData?.watchlist.data ? (
                <div className="space-y-3 text-sm">
                  <dl className="grid grid-cols-2 gap-2">
                    <Metric label="Stocks" value={String(polymarketData.watchlist.data.buckets.stocks.length)} />
                    <Metric label="Funds" value={String(polymarketData.watchlist.data.buckets.funds.length)} />
                    <Metric label="Crypto proxies" value={String(polymarketData.watchlist.data.buckets.cryptoProxies.length)} />
                    <Metric label="Trading Ops overlap" value={polymarketOverlap.length > 0 ? String(polymarketOverlap.length) : "0"} />
                  </dl>
                  {polymarketOverlap.length > 0 ? (
                    <div className="rounded-md border border-border/50 bg-muted/30 p-2">
                      <p className="terminal-metric-label">Current run overlap</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {polymarketOverlap.slice(0, 8).map((symbol) => (
                          <Badge key={symbol} variant="info" className="font-mono text-[10px]">
                            {symbol}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="space-y-1.5">
                    {polymarketData.watchlist.data.symbols.slice(0, 10).map((symbol) => (
                      <div key={symbol.symbol} className="flex items-start justify-between gap-3 rounded-md border border-border/50 px-2 py-1.5 text-xs">
                        <div>
                          <p className="font-mono font-medium">{symbol.symbol}</p>
                          <p className="text-muted-foreground">
                            {formatLabel(symbol.assetClass)}
                            {symbol.themes.length > 0 ? ` · ${symbol.themes.map(formatLabel).join(", ")}` : ""}
                          </p>
                        </div>
                        <div className="text-right">
                          <p>{formatProbability(symbol.probability)}</p>
                          <p className="text-muted-foreground">{symbol.sourceTitles.slice(0, 2).join(" · ") || "No source title"}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </ArtifactPanel>

            <ArtifactPanel title="Results" artifact={polymarketResultsArtifact}>
              {polymarketData?.results.data ? (
                <div className="space-y-3 text-sm">
                  <dl className="grid grid-cols-2 gap-2">
                    <Metric label="Settled" value={String(polymarketData.results.data.settledCount)} />
                    <Metric label="With P&L" value={String(polymarketData.results.data.tradedCount)} />
                    <Metric label="Open live" value={String(polymarketData.results.data.openPositionCount)} />
                  </dl>
                  {polymarketSettledRows.length > 0 ? (
                    <div className="space-y-1.5">
                      {polymarketSettledRows.map((row) => (
                        <div key={`result-${row.marketSlug}`} className="rounded-md border border-border/50 px-2 py-2 text-xs">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="font-medium">{row.title}</p>
                              <p className="text-muted-foreground">
                                {[row.eventTitle, row.league ? formatLabel(row.league) : null].filter(Boolean).join(" · ") || "Pinned result"}
                              </p>
                            </div>
                            <Badge variant={row.traded ? "success" : "outline"} className="text-[10px]">
                              {row.traded ? "P&L tracked" : "Result only"}
                            </Badge>
                          </div>
                          <p className="mt-2">{row.resultLabel}</p>
                          <p className="mt-1 text-muted-foreground">
                            Settled {formatOperatorTimestamp(row.settledAt)}
                            {row.outcome ? ` · Outcome ${row.outcome}` : ""}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Pinned markets will move here after they settle. Open pinned positions now show live economics directly in the pinned cards.
                    </p>
                  )}
                </div>
              ) : null}
            </ArtifactPanel>
          </section>
        </TabsContent>

        {/* ── System Health ── */}
        <TabsContent value="health" className="space-y-3">
          <ArtifactPanel title="Financial services health" artifact={data.financialServices}>
            {data.financialServices.data ? (
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <Metric label="Healthy" value={String(data.financialServices.data.healthyCount)} />
                  <Metric label="Degraded" value={String(data.financialServices.data.degradedCount)} />
                  <Metric label="Needs attention" value={String(data.financialServices.data.errorCount)} />
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {data.financialServices.data.rows.map((row) => (
                    <FinancialServiceCard key={row.label} row={row} />
                  ))}
                </div>
              </div>
            ) : null}
          </ArtifactPanel>

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

function FinancialServiceCard({ row }: { row: FinancialServiceHealthRow }) {
  return (
    <div className="rounded-md border border-border/50 bg-muted/20 p-3 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{row.label}</p>
          <p className="text-muted-foreground">{row.summary}</p>
        </div>
        <Badge variant={badgeVariantForServiceHealth(row.state)} className="text-[10px]">
          {row.badgeText ?? row.state}
        </Badge>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Metric label="Detail" value={row.detail} />
        <Metric label="Updated" value={row.updatedAt ? formatOperatorTimestamp(row.updatedAt) : "—"} />
      </div>
      <p className="mt-2 truncate text-[10px] text-muted-foreground">Source: {row.source}</p>
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

function badgeVariantForServiceHealth(state: FinancialServiceHealthRow["state"]) {
  if (state === "ok") return "success" as const;
  if (state === "degraded") return "warning" as const;
  if (state === "error") return "destructive" as const;
  return "outline" as const;
}

function buildPolymarketStatusArtifact(
  data: TradingOpsPolymarketData | null,
  error: string | null,
): ArtifactState<TradingOpsPolymarketData> {
  if (!data) {
    return buildPendingArtifact<TradingOpsPolymarketData>("Loading Polymarket status", error);
  }

  const artifacts = [data.account, data.signal, data.watchlist];
  const state = summarizeArtifactStates(artifacts.map((artifact) => artifact.state));
  const updatedAt = newestTimestamp(artifacts.map((artifact) => artifact.updatedAt ?? null));
  const warnings = artifacts.flatMap((artifact) => artifact.warnings);

  return {
    state,
    label: "Polymarket status",
    message: [data.account.message, data.signal.data?.overlaySummary].filter(Boolean).join(" ") || "Polymarket status is loaded.",
    data,
    updatedAt,
    source: "/api/trading-ops/polymarket",
    warnings: error ? [error, ...warnings] : warnings,
    badgeText: data.signal.data?.alignment ?? data.account.badgeText,
  };
}

function buildPolymarketLiveArtifact(
  data: TradingOpsPolymarketLiveData | null,
  error: string | null,
  lastSuccessfulAt: string | null,
): ArtifactState<TradingOpsPolymarketLiveData> {
  if (!data) {
    return {
      state: error ? "error" : "missing",
      label: error ? "Polymarket live unavailable" : "Loading Polymarket live",
      message: error ?? "Streaming Polymarket market and account updates.",
      data: null,
      updatedAt: lastSuccessfulAt,
      source: "/api/trading-ops/polymarket/live/stream",
      warnings: error ? [error] : [],
    };
  }

  const hasProblems =
    data.streamer.operatorState !== "healthy" ||
    data.markets.some((market) => market.state !== "ok");

  return {
    state: hasProblems ? "degraded" : "ok",
    label: data.streamer.marketsConnected ? "Polymarket live stream" : "Polymarket fallback snapshots",
    message: error
      ? `Live Polymarket stream is running with warnings. Last request error: ${error}`
      : "Live Polymarket market and account updates are flowing.",
    data,
    updatedAt: lastSuccessfulAt ?? data.generatedAt,
    source: "/api/trading-ops/polymarket/live/stream",
    warnings: error ? [error, ...data.warnings] : data.warnings,
  };
}

function buildPendingArtifact<T>(label: string, error: string | null): ArtifactState<T> {
  return {
    state: error ? "error" : "missing",
    label,
    message: error ?? `${label}.`,
    data: null,
    updatedAt: null,
    source: "/api/trading-ops/polymarket",
    warnings: error ? [error] : [],
  };
}

function summarizeArtifactStates(states: Array<TradingOpsPolymarketData["account"]["state"]>): TradingOpsPolymarketData["account"]["state"] {
  if (states.includes("error")) return "error";
  if (states.includes("degraded")) return "degraded";
  if (states.includes("ok")) return "ok";
  return "missing";
}

function newestTimestamp(values: Array<string | null | undefined>): string | null {
  const timestamps = values
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map((value) => ({ value, time: Date.parse(value) }))
    .filter((entry) => !Number.isNaN(entry.time))
    .sort((left, right) => right.time - left.time);

  return timestamps[0]?.value ?? null;
}

function collectTradingRunSymbols(data: TradingOpsDashboardData): Set<string> {
  const tradingRun = data.tradingRun.data;
  if (!tradingRun) return new Set<string>();

  return new Set(
    [
      ...tradingRun.dipBuyerBuy,
      ...tradingRun.dipBuyerWatch,
      ...tradingRun.dipBuyerNoBuy,
      ...tradingRun.canslimBuy,
      ...tradingRun.canslimWatch,
      ...tradingRun.canslimNoBuy,
    ].map((symbol) => symbol.toUpperCase()),
  );
}

function buildPolymarketLinkedSymbolRows(
  data: TradingOpsPolymarketLiveData | null,
): PolymarketLinkedSymbolCardRow[] {
  if (!data) return [];

  const rows: PolymarketLinkedSymbolCardRow[] = [];
  const seen = new Set<string>();

  for (const market of data.markets) {
    if (market.bucket !== "events") continue;
    const link = getPolymarketLiveEventLink(market.title, market.eventTitle);
    if (!link) continue;

    const probability = getPolymarketLiveMarketProbability(market);
    const severity = getPolymarketSeverity(probability);
    const updatedAt = newestTimestamp([market.updatedAt, market.tradeTime]);

    for (const symbol of link.watchTickers) {
      if (seen.has(symbol)) continue;
      seen.add(symbol);
      rows.push({
        symbol,
        assetClass: getPolymarketLinkedAssetClass(symbol),
        theme: link.theme,
        sourceTitle: market.title,
        eventTitle: market.eventTitle,
        probability,
        severity,
        regimeEffect: link.regimeEffect,
        marketState: market.marketState,
        spread: market.spread,
        updatedAt,
        state: market.state,
        warning: market.warning,
      });
    }
  }

  return rows;
}

function formatLabel(value: string | null | undefined): string {
  if (!value) return "n/a";
  return value.replaceAll("_", " ");
}

function formatProbability(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "n/a";
  return `${Math.round(value * 100)}%`;
}

function formatProbabilityDelta(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "24h n/a";
  const points = Math.round(value * 100);
  const sign = points > 0 ? "+" : "";
  return `${sign}${points} pts/24h`;
}

function badgeVariantForMarketSeverity(severity: string) {
  if (severity === "major") return "warning" as const;
  if (severity === "notable") return "info" as const;
  return "outline" as const;
}

function badgeVariantForPolymarketStreamer(data: TradingOpsPolymarketLiveData) {
  if (data.streamer.marketsConnected && data.streamer.privateConnected) return "success" as const;
  if (data.streamer.marketsConnected || data.streamer.privateConnected) return "warning" as const;
  return "outline" as const;
}

function formatMarketPrice(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "n/a";
  return `$${value.toFixed(value >= 1 ? 3 : 4)}`;
}

function formatMarketQuantity(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "n/a";
  return value >= 1000 ? value.toLocaleString() : String(Number(value.toFixed(2)));
}

function renderPolymarketMarketCard(
  market: TradingOpsPolymarketLiveData["markets"][number],
  options: { pending: boolean; result: PolymarketResultRow | null; rosterNew?: boolean; onToggle: () => void },
) {
  return <PolymarketMarketCard key={market.slug} market={market} options={options} />;
}

function PolymarketLinkedSymbolGrid({ rows }: { rows: PolymarketLinkedSymbolCardRow[] }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((row) => (
        <PolymarketLinkedSymbolCard key={`${row.symbol}-${row.sourceTitle}`} row={row} />
      ))}
    </div>
  );
}

function PolymarketLinkedSymbolCard({ row }: { row: PolymarketLinkedSymbolCardRow }) {
  return (
    <div className="rounded-md border border-border/50 bg-muted/20 p-3 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-sm font-semibold">{row.symbol}</p>
          <p className="text-muted-foreground">
            {formatLabel(row.assetClass)}
            {row.theme ? ` · ${formatLabel(row.theme)}` : ""}
            {row.regimeEffect ? ` · regime ${formatLabel(row.regimeEffect)}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Badge variant={badgeVariantForMarketSeverity(row.severity)} className="text-[10px]">
            {row.severity}
          </Badge>
          {row.marketState ? (
            <Badge variant="outline" className="text-[10px]">
              {formatLabel(row.marketState)}
            </Badge>
          ) : null}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Metric label="Signal" value={formatProbability(row.probability)} />
        <Metric label="Spread" value={formatMarketPrice(row.spread)} />
        <Metric label="Source market" value={row.sourceTitle} />
        <Metric label="Updated" value={formatOperatorTimestamp(row.updatedAt)} />
      </div>
      <p className="mt-3 text-muted-foreground">
        Linked to {row.sourceTitle}
        {row.eventTitle && row.eventTitle !== row.sourceTitle ? ` · ${row.eventTitle}` : ""}
      </p>
      {row.warning ? (
        <p className="mt-1 text-muted-foreground">
          {row.warning}
        </p>
      ) : null}
    </div>
  );
}

function PolymarketMarketCard({
  market,
  options,
}: {
  market: TradingOpsPolymarketLiveData["markets"][number];
  options: { pending: boolean; result: PolymarketResultRow | null; rosterNew?: boolean; onToggle: () => void };
}) {
  const subtitle =
    market.bucket === "sports"
      ? [
          market.eventTitle && market.eventTitle !== market.title ? market.eventTitle : null,
          market.league ? formatLabel(market.league) : null,
        ].filter(Boolean).join(" · ") || "Sports market"
      : market.eventTitle ?? "Polymarket event";
  const currentValue = derivePinnedCurrentValue(market, options.result);
  const unrealizedPnl =
    currentValue != null && options.result?.costBasis != null
      ? Number((currentValue - options.result.costBasis).toFixed(4))
      : options.result?.unrealizedPnl ?? null;
  const hasLiveEconomics = (options.result?.netPosition ?? 0) > 0;
  const flash = usePolymarketFlashClass({
    bid: market.bestBid,
    ask: market.bestAsk,
    last: market.lastTrade,
    spread: market.spread,
  });
  const animatedBid = useAnimatedValue(market.bestBid, 700);
  const animatedAsk = useAnimatedValue(market.bestAsk, 700);
  const animatedLast = useAnimatedValue(market.lastTrade, 700);
  const animatedSpread = useAnimatedValue(market.spread, 700);
  const animatedCurrentValue = useAnimatedValue(currentValue, 700);
  const animatedUnrealizedPnl = useAnimatedValue(unrealizedPnl, 700);
  const animatedCostBasis = useAnimatedValue(options.result?.costBasis ?? null, 700);
  const animatedPosition = useAnimatedValue(options.result?.netPosition ?? null, 700);
  const freshestTimestamp = newestTimestamp([market.updatedAt, market.tradeTime]);

  return (
    <div
      className={cn(
        "rounded-md border border-border/50 bg-muted/20 px-3 py-3 text-xs transition-[background-color,border-color,box-shadow,transform] duration-1000",
        options.rosterNew && "border-amber-300/60 bg-amber-50/50 shadow-[0_0_0_1px_rgba(245,158,11,0.22)] motion-safe:animate-[pulse_1.1s_ease-out_1]",
        flash,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{market.title}</p>
          <p className="text-muted-foreground">{subtitle}</p>
          <p className="font-mono text-muted-foreground">{market.slug}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {options.rosterNew ? (
            <Badge variant="outline" className="border-amber-300/70 bg-amber-100/80 text-[10px] text-amber-900 dark:border-amber-500/50 dark:bg-amber-500/15 dark:text-amber-200">
              NEW
            </Badge>
          ) : null}
          <Badge variant={market.state === "ok" ? "success" : market.state === "degraded" ? "warning" : "outline"} className="text-[10px]">
            {market.state === "ok" ? "live" : market.state}
          </Badge>
          {market.marketState ? (
            <Badge variant="outline" className="text-[10px]">
              {formatLabel(market.marketState)}
            </Badge>
          ) : null}
          <Button
            type="button"
            size="xs"
            variant={market.pinned ? "destructive" : "outline"}
            disabled={options.pending}
            onClick={options.onToggle}
          >
            {options.pending ? "Saving..." : market.pinned ? "Remove" : "Pin"}
          </Button>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <AnimatedMetric label="Bid" value={formatMarketPrice(animatedBid)} flashValue={market.bestBid} />
        <AnimatedMetric label="Ask" value={formatMarketPrice(animatedAsk)} flashValue={market.bestAsk} />
        <AnimatedMetric label="Last" value={formatMarketPrice(animatedLast)} flashValue={market.lastTrade} />
        <AnimatedMetric label="Spread" value={formatMarketPrice(animatedSpread)} flashValue={market.spread} />
      </div>
      {hasLiveEconomics ? (
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <AnimatedMetric label="Position" value={formatMarketQuantity(animatedPosition)} flashValue={options.result?.netPosition ?? null} />
          <AnimatedMetric label="Basis" value={formatDetailedMoney(animatedCostBasis)} flashValue={options.result?.costBasis ?? null} />
          <AnimatedMetric label="Value" value={formatDetailedMoney(animatedCurrentValue)} flashValue={currentValue} />
          <AnimatedMetric
            label="Unrealized"
            value={formatSignedDetailedMoney(animatedUnrealizedPnl)}
            flashValue={unrealizedPnl}
            valueClassName={signedValueTextClass(animatedUnrealizedPnl)}
          />
        </div>
      ) : null}
      <p className="mt-3 text-muted-foreground">
        Trade {formatMarketPrice(market.tradePrice)} · Qty {formatMarketQuantity(market.tradeQuantity)} · {formatOperatorTimestamp(freshestTimestamp)}
      </p>
    </div>
  );
}

function AnimatedMetric({
  label,
  value,
  flashValue,
  valueClassName,
}: {
  label: string;
  value: string;
  flashValue?: number | null;
  valueClassName?: string;
}) {
  const flash = useFlashClass(flashValue ?? null);
  return (
    <div
      className={cn(
        "rounded-md border border-border/50 bg-background/70 px-2 py-1.5 backdrop-blur-sm transition-[background-color,border-color] duration-700",
        flash && "border-border/70",
        flash,
      )}
    >
      <p className="terminal-metric-label">{label}</p>
      <p className={cn("mt-0.5 font-mono text-sm font-medium leading-tight tabular-nums", valueClassName)}>{value}</p>
    </div>
  );
}

function RosterMetric({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-border/50 bg-muted/20 px-2 py-1.5 transition-[background-color,border-color,box-shadow] duration-700",
        highlight && "border-amber-300/60 bg-amber-50/60 shadow-[0_0_0_1px_rgba(245,158,11,0.18)]",
      )}
    >
      <p className="terminal-metric-label">{label}</p>
      <p className="mt-0.5 font-mono text-sm font-medium leading-tight">{value}</p>
    </div>
  );
}

function RosterChangeSummary({
  state,
}: {
  state: ReturnType<typeof usePolymarketRosterState>;
}) {
  if (!state.badgeLabel && !state.updatedAt) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {state.badgeLabel ? (
        <Badge
          variant="outline"
          className="border-amber-300/70 bg-amber-100/80 text-[10px] text-amber-900 dark:border-amber-500/50 dark:bg-amber-500/15 dark:text-amber-200"
        >
          {state.badgeLabel}
        </Badge>
      ) : null}
      {state.updatedAt ? (
        <p className="text-amber-800/90 dark:text-amber-200/90">
          Roster updated {formatOperatorTimestamp(state.updatedAt)}.
        </p>
      ) : null}
    </div>
  );
}

function formatSignedMoney(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "n/a";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${formatMoney(Math.abs(value))}`;
}

function formatDetailedMoney(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "n/a";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatSignedDetailedMoney(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "n/a";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${formatDetailedMoney(Math.abs(value))}`;
}

function signedValueTextClass(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "text-foreground";
  if (value > 0) return "text-emerald-600 dark:text-emerald-400";
  if (value < 0) return "text-red-600 dark:text-red-400";
  return "text-muted-foreground";
}

function derivePinnedCurrentValue(
  market: TradingOpsPolymarketLiveData["markets"][number],
  result: PolymarketResultRow | null,
): number | null {
  if (!result) {
    return null;
  }

  if (result.currentValue != null) {
    return result.currentValue;
  }

  if (result.netPosition == null) {
    return null;
  }

  const mark =
    market.lastTrade ??
    (market.bestBid != null && market.bestAsk != null ? (market.bestBid + market.bestAsk) / 2 : null) ??
    market.bestBid ??
    market.bestAsk;

  return mark == null ? null : Number((mark * result.netPosition).toFixed(4));
}

function usePolymarketFlashClass(values: {
  bid: number | null;
  ask: number | null;
  last: number | null;
  spread: number | null;
}): string {
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const prevRef = useRef(values);
  const timerRef = useRef(0);

  useEffect(() => {
    const previous = prevRef.current;
    prevRef.current = values;
    if (!previous) return;

    const currentMark = preferredFlashMark(values);
    const previousMark = preferredFlashMark(previous);
    if (currentMark == null || previousMark == null || currentMark === previousMark) {
      if (
        previous.bid !== values.bid ||
        previous.ask !== values.ask ||
        previous.last !== values.last ||
        previous.spread !== values.spread
      ) {
        setFlash("up");
        window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => setFlash(null), 1100);
      }
      return;
    }

    setFlash(currentMark > previousMark ? "up" : "down");
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setFlash(null), 1100);
  }, [values]);

  if (flash === "up") return "bg-emerald-500/14 border-emerald-500/40 shadow-[0_0_0_1px_rgba(16,185,129,0.22)]";
  if (flash === "down") return "bg-red-500/12 border-red-500/35 shadow-[0_0_0_1px_rgba(239,68,68,0.18)]";
  return "";
}

function preferredFlashMark(values: {
  bid: number | null;
  ask: number | null;
  last: number | null;
  spread: number | null;
}): number | null {
  if (values.last != null) return values.last;
  if (values.bid != null && values.ask != null) return (values.bid + values.ask) / 2;
  return values.bid ?? values.ask ?? values.spread;
}

function usePolymarketRosterState(
  rows: TradingOpsPolymarketLiveData["markets"],
  updatedAt: string | null,
) {
  const [newSlugs, setNewSlugs] = useState<string[]>([]);
  const [badgeLabel, setBadgeLabel] = useState<string | null>(null);
  const [highlightedUpdatedAt, setHighlightedUpdatedAt] = useState<string | null>(null);
  const [leaderChanged, setLeaderChanged] = useState(false);
  const previousSlugsRef = useRef<string[] | null>(null);
  const previousLeaderRef = useRef<string | null>(null);
  const newTimerRef = useRef(0);
  const badgeTimerRef = useRef(0);

  useEffect(() => {
    return () => {
      window.clearTimeout(newTimerRef.current);
      window.clearTimeout(badgeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const currentSlugs = rows.map((row) => row.slug);
    const currentLeader = rows[0]?.slug ?? null;
    const previousSlugs = previousSlugsRef.current;
    const previousLeader = previousLeaderRef.current;

    previousSlugsRef.current = currentSlugs;
    previousLeaderRef.current = currentLeader;

    if (!previousSlugs) return;

    const previousSet = new Set(previousSlugs);
    const currentSet = new Set(currentSlugs);
    const entering = currentSlugs.filter((slug) => !previousSet.has(slug));
    const leaving = previousSlugs.filter((slug) => !currentSet.has(slug));
    const membershipChanged = entering.length > 0 || leaving.length > 0;
    const hasLeaderChange = Boolean(previousLeader && currentLeader && previousLeader !== currentLeader);

    if (!membershipChanged && !hasLeaderChange) {
      return;
    }

    if (entering.length > 0) {
      setNewSlugs((current) => Array.from(new Set([...current, ...entering])));
      window.clearTimeout(newTimerRef.current);
      newTimerRef.current = window.setTimeout(() => setNewSlugs([]), 10_000);
    }

    setLeaderChanged(hasLeaderChange);
    setHighlightedUpdatedAt(updatedAt);
    setBadgeLabel(entering.length > 0 ? `${entering.length} new` : "updated");
    window.clearTimeout(badgeTimerRef.current);
    badgeTimerRef.current = window.setTimeout(() => {
      setBadgeLabel(null);
      setHighlightedUpdatedAt(null);
      setLeaderChanged(false);
    }, 8_000);
  }, [rows, updatedAt]);

  return {
    newSlugs: new Set(newSlugs),
    badgeLabel,
    updatedAt: highlightedUpdatedAt,
    leaderChanged,
  };
}

function describePolymarketBoardEmptyState(options: {
  bucket: "events" | "sports";
  visibleCount: number;
  pinnedCount: number;
  candidateCount: number;
  warnings: string[];
}): { kind: "active" | "exhausted" | "warning" | "waiting"; message: string; detail: string } {
  if (options.visibleCount > 0) {
    return { kind: "active", message: "", detail: "" };
  }

  const bucketLabel = options.bucket === "events" ? "event" : "sports";
  if (options.candidateCount > 0 && options.pinnedCount >= options.candidateCount) {
    return {
      kind: "exhausted",
      message: `All current ${bucketLabel} candidates are pinned.`,
      detail: `Remove a pinned ${bucketLabel} market to resume the rotating board.`,
    };
  }

  if (options.warnings.length > 0) {
    return {
      kind: "warning",
      message: `Live ${bucketLabel} roster is temporarily unavailable.`,
      detail: options.warnings[0] ?? `Waiting for the next ${bucketLabel} board refresh.`,
    };
  }

  return {
    kind: "waiting",
    message: `Waiting for live ${bucketLabel} contracts.`,
    detail: `Waiting for the first live ${bucketLabel} rotation.`,
  };
}

function isPolymarketPayload(value: unknown): value is TradingOpsPolymarketData {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return Boolean(record.account && record.signal && record.watchlist && record.results);
}

function isPolymarketLivePayload(value: unknown): value is TradingOpsPolymarketLiveData {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return Boolean(record.streamer && record.account && Array.isArray(record.markets));
}
