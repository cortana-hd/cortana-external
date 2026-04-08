import { ClipboardList } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ArtifactState, LoadState } from "@/lib/trading-ops-contract";
import { formatRelativeAge } from "@/lib/format-utils";

/* ── helpers ── */

export function stateTextClass(state: LoadState) {
  return `state-text-${state}` as const;
}

export function panelBorderClass(state: LoadState) {
  return `panel-${state}` as const;
}

function summarizeStateVariant(state: LoadState): "success" | "warning" | "destructive" | "outline" {
  if (state === "ok") return "success";
  if (state === "degraded") return "warning";
  if (state === "error") return "destructive";
  return "outline";
}

/* ── small reusable components ── */

export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/50 bg-muted/20 px-2 py-1.5">
      <p className="terminal-metric-label">{label}</p>
      <p className="mt-0.5 font-mono text-sm font-medium leading-tight">{value}</p>
    </div>
  );
}

export function StageChip({ name, status }: { name: string; status: string }) {
  const dotColor =
    status === "ok"
      ? "bg-emerald-500 dark:bg-emerald-400"
      : status === "error"
        ? "bg-red-500 dark:bg-red-400"
        : "bg-muted-foreground";

  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border/50 bg-muted/30 px-2 py-1 font-mono text-xs">
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${dotColor}`} />
      {name}
    </span>
  );
}

export function TickerChip({ ticker, kind }: { ticker: string; kind: "buy" | "watch" | "no_buy" }) {
  const cls = kind === "buy" ? "ticker-buy" : kind === "watch" ? "ticker-watch" : "ticker-no-buy";
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 font-mono text-xs font-medium ${cls}`}>
      {ticker}
    </span>
  );
}

export function WatchlineChips({ title, tickers, kind }: { title: string; tickers: string[]; kind: "buy" | "watch" | "no_buy" }) {
  return (
    <div>
      <p className="terminal-metric-label mb-1">{title}</p>
      {tickers.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {tickers.map((t) => (
            <TickerChip key={t} ticker={t} kind={kind} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">None right now</p>
      )}
    </div>
  );
}

export function StrategyWatchlistSection({
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
    <div className="space-y-2 rounded-lg border border-border/50 bg-card/40 p-3">
      <div>
        <p className="font-mono text-sm font-semibold">{strategy}</p>
        <p className="text-xs text-muted-foreground">
          BUY {buy.length} · WATCH {watch.length} · NO_BUY {noBuy.length}
        </p>
      </div>
      <WatchlineChips title={`${strategy} buy`} tickers={buy} kind="buy" />
      <WatchlineChips title={`${strategy} watch`} tickers={watch} kind="watch" />
      <WatchlineChips title={`${strategy} no-buy`} tickers={noBuy} kind="no_buy" />
    </div>
  );
}

export function ReadStep({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <ClipboardList className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

export function ArtifactPanel({
  title,
  artifact,
  children,
}: {
  title: string;
  artifact: ArtifactState<unknown>;
  children?: React.ReactNode;
}) {
  return (
    <Card className={`gap-3 py-3 ${panelBorderClass(artifact.state)}`}>
      <CardHeader className="gap-1.5 px-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm">{title}</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant={summarizeStateVariant(artifact.state)} className="text-[10px]">{artifact.badgeText ?? artifact.state}</Badge>
            <span className="text-[10px] text-muted-foreground">
              {artifact.updatedAt ? formatRelativeAge(artifact.updatedAt) : "—"}
            </span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{artifact.message}</p>
      </CardHeader>
      <CardContent className="space-y-2 px-4">
        {children ?? <p className="text-xs text-muted-foreground">No data available.</p>}
        {artifact.warnings.length > 0 ? (
          <details className="rounded-md border border-border/50 bg-muted/20 p-2">
            <summary className="cursor-pointer text-xs font-medium">Warnings ({artifact.warnings.length})</summary>
            <ul className="mt-2 space-y-1 text-[11px] text-muted-foreground">
              {artifact.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </details>
        ) : null}
        {artifact.source ? (
          <p className="truncate text-[10px] text-muted-foreground">Source: {artifact.source}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
