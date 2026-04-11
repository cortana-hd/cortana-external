"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { LiveQuoteRow, LoadState } from "@/lib/trading-ops-contract";
import { formatOperatorTimestamp, formatRelativeAge } from "@/lib/format-utils";
import { Badge } from "@/components/ui/badge";

/* ── animation hooks ── */

/** Smoothly interpolates toward `target` over `duration` ms (ease-out cubic). */
export function useAnimatedValue(target: number | null, duration = 350): number | null {
  const [display, setDisplay] = useState(target);
  const rafRef = useRef(0);
  const currentRef = useRef(target);

  useEffect(() => {
    if (target == null || Number.isNaN(target)) {
      currentRef.current = target;
      setDisplay(target);
      return;
    }

    const from = currentRef.current;
    if (from == null || Number.isNaN(from) || from === target) {
      currentRef.current = target;
      setDisplay(target);
      return;
    }

    cancelAnimationFrame(rafRef.current);
    const start = performance.now();

    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - (1 - t) ** 3;
      const v = from + (target - from) * eased;
      currentRef.current = v;
      setDisplay(v);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return display;
}

/** Returns a transient Tailwind class (green/red wash) that fades via CSS transition. */
export function useFlashClass(value: number | null): string {
  const prevRef = useRef(value);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const timerRef = useRef(0);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = value;
    if (prev == null || value == null || prev === value) return;

    setFlash(value > prev ? "up" : "down");
    clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setFlash(null), 700);
    return () => clearTimeout(timerRef.current);
  }, [value]);

  if (flash === "up") return "bg-emerald-500/10";
  if (flash === "down") return "bg-red-500/10";
  return "";
}

/* ── formatting helpers ── */

function formatQuotePrice(value: number | null): string {
  if (value == null || Number.isNaN(value)) return "\u2014";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatQuoteChange(value: number | null): string {
  if (value == null || Number.isNaN(value)) return "\u2014";
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

/* ── badge helpers ── */

function badgeVariantForQuoteState(state: LoadState) {
  if (state === "ok") return "success" as const;
  if (state === "degraded") return "warning" as const;
  if (state === "error") return "destructive" as const;
  return "outline" as const;
}

function quoteBadgeLabel(row: LiveQuoteRow): string {
  if (isQuietAfterHoursGapRow(row)) return "waiting";
  if (isStaleSchwabRow(row)) return "stale";
  if (row.state === "ok" && row.source === "schwab_streamer") return "live";
  if (row.state === "ok") return "rest";
  if (row.state === "degraded") return "degraded";
  if (row.state === "error") return "error";
  return "missing";
}

function isQuietAfterHoursGapRow(row: LiveQuoteRow): boolean {
  return row.state === "degraded" && row.warning === "No recent after-hours Schwab quote yet.";
}

function isStaleSchwabRow(row: LiveQuoteRow): boolean {
  return (
    row.state === "degraded" &&
    (row.source === "schwab_streamer" || row.source === "schwab_streamer_shared") &&
    (row.stalenessSeconds ?? 0) > 0 &&
    Boolean(row.timestamp)
  );
}

function quoteTimestampLabel(row: LiveQuoteRow): string {
  if (isStaleSchwabRow(row) && row.timestamp) {
    return `Last Schwab update ${formatRelativeAge(row.timestamp)}`;
  }
  return row.timestamp ? formatOperatorTimestamp(row.timestamp) : "Timestamp unavailable";
}

function quoteSourceLabel(row: LiveQuoteRow): string {
  if (isQuietAfterHoursGapRow(row)) {
    return "Schwab after-hours";
  }
  if (isStaleSchwabRow(row) && row.timestamp) {
    return `Schwab stale · ${formatRelativeAge(row.timestamp)}`;
  }
  if (row.source === "schwab_streamer") {
    return "Streamer";
  }
  if (row.source === "schwab_streamer_shared") {
    return "Shared Schwab state";
  }
  if (row.source) {
    return `Source ${row.source}`;
  }
  return "Quote unavailable";
}

function QuoteStateBadge({ row, compact = false }: { row: LiveQuoteRow; compact?: boolean }) {
  return (
    <Badge variant={badgeVariantForQuoteState(row.state)} className={compact ? "px-1.5 py-0 text-[9px]" : "text-[10px]"}>
      {quoteBadgeLabel(row)}
    </Badge>
  );
}

/* ── animated card components ── */

function CompactTapeCard({ row }: { row: LiveQuoteRow }) {
  const animatedPrice = useAnimatedValue(row.price);
  const animatedChange = useAnimatedValue(row.changePercent);
  const flash = useFlashClass(row.price);

  return (
    <div
      className={cn(
        "min-w-0 rounded-md border border-border/50 bg-muted/20 px-3 py-3 transition-colors duration-700",
        flash,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-semibold">{row.label}</span>
        <QuoteStateBadge row={row} compact />
      </div>
      <p className="mt-2 font-mono text-sm font-medium tabular-nums">
        {formatQuotePrice(animatedPrice)}
      </p>
      <p className={cn("text-xs tabular-nums", quoteChangeTextClass(row.changePercent, row.state))}>
        {formatQuoteChange(animatedChange)}
      </p>
      {isStaleSchwabRow(row) ? (
        <p className="mt-1 text-[10px] text-muted-foreground">{quoteTimestampLabel(row)}</p>
      ) : null}
    </div>
  );
}

export function CompactTapeStrip({ rows }: { rows: LiveQuoteRow[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
      {rows.map((row) => (
        <CompactTapeCard key={`${row.symbol}-${row.sourceSymbol}`} row={row} />
      ))}
    </div>
  );
}

function LiveTapeCardInner({ row }: { row: LiveQuoteRow }) {
  const animatedPrice = useAnimatedValue(row.price);
  const animatedChange = useAnimatedValue(row.changePercent);
  const flash = useFlashClass(row.price);

  return (
    <div
      className={cn(
        "rounded-md border border-border/50 bg-muted/20 p-3 transition-colors duration-700",
        flash,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="font-mono text-sm font-semibold">{row.label}</p>
          <p className="text-[11px] text-muted-foreground">via {row.sourceSymbol}</p>
        </div>
        <QuoteStateBadge row={row} />
      </div>
      <p className="mt-3 font-mono text-lg font-medium tabular-nums">
        {formatQuotePrice(animatedPrice)}
      </p>
      <p className={cn("mt-1 text-sm tabular-nums", quoteChangeTextClass(row.changePercent, row.state))}>
        {formatQuoteChange(animatedChange)}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {quoteTimestampLabel(row)}
      </p>
      {row.state !== "ok" && row.warning ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {row.warning}
        </p>
      ) : null}
    </div>
  );
}

export function LiveTapeGrid({ rows }: { rows: LiveQuoteRow[] }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((row) => (
        <LiveTapeCardInner key={`${row.symbol}-${row.sourceSymbol}`} row={row} />
      ))}
    </div>
  );
}

function LiveWatchlistRowCard({ row, groupLabel }: { row: LiveQuoteRow; groupLabel: string }) {
  const animatedPrice = useAnimatedValue(row.price);
  const animatedChange = useAnimatedValue(row.changePercent);
  const flash = useFlashClass(row.price);

  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-md border border-border/50 bg-muted/20 px-2 py-2 transition-colors duration-700",
        flash,
      )}
    >
      <div className="min-w-0">
        <p className="truncate font-mono text-sm font-medium">{row.symbol}</p>
        <p className="truncate text-[11px] text-muted-foreground">{quoteSourceLabel(row)}</p>
      </div>
      <p className="font-mono text-sm tabular-nums">{formatQuotePrice(animatedPrice)}</p>
      <p className={cn("font-mono text-xs tabular-nums", quoteChangeTextClass(row.changePercent, row.state))}>
        {formatQuoteChange(animatedChange)}
      </p>
      {row.state !== "ok" && row.warning ? (
        <p className="col-span-3 -mt-1 text-[11px] text-muted-foreground">
          {row.warning}
        </p>
      ) : null}
    </div>
  );
}

export function LiveWatchlistGroup({
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
            <LiveWatchlistRowCard
              key={`${label}-${row.symbol}-${row.sourceSymbol}`}
              row={row}
              groupLabel={label}
            />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}
