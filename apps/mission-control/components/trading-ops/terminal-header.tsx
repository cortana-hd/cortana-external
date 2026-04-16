import { Badge } from "@/components/ui/badge";
import type { LoadState, TradingOpsDashboardData } from "@/lib/trading-ops-contract";
import { formatPercentDecimal as formatPercent, formatRelativeAge } from "@/lib/format-utils";
import { stateTextClass } from "./shared";

export function TerminalHeader({ data }: { data: TradingOpsDashboardData }) {
  return (
    <section className="rounded-lg border border-border/70 bg-card/80 font-mono">
      {/* Desktop: single row */}
      <div className="hidden items-center justify-between px-4 py-2.5 md:flex">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold uppercase tracking-wider">Cortana Trading Ops</h1>
          <Badge variant="outline" className="text-[10px]">live</Badge>
        </div>
        <div className="flex items-center divide-x divide-border/50">
          <HeaderMetric label="Regime" value={data.market.data?.regime.toUpperCase() ?? "N/A"} state={data.market.state} />
          <HeaderMetric label="Sizing" value={formatPercent(data.market.data?.positionSizingPct ?? null)} state={data.market.state} />
          <HeaderMetric label="Snapshots" value={String(data.prediction.data?.snapshotCount ?? 0)} state={data.prediction.state} />
          <HeaderMetric label="1d Matured" value={String(data.prediction.data?.oneDayMatured ?? 0)} state={data.prediction.state} />
          <HeaderMetric label="Decision" value={data.tradingRun.data?.decision ?? "N/A"} state={data.tradingRun.state} />
        </div>
        <span className="text-[10px] text-muted-foreground">{formatRelativeAge(data.generatedAt)}</span>
      </div>

      {/* Mobile: stacked */}
      <div className="space-y-2 px-3 py-2.5 md:hidden">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h1 className="text-xs font-bold uppercase tracking-wider">Cortana Trading Ops</h1>
            <Badge variant="outline" className="text-[10px]">live</Badge>
          </div>
          <span className="text-[10px] text-muted-foreground">{formatRelativeAge(data.generatedAt)}</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <HeaderMetricMobile label="Regime" value={data.market.data?.regime.toUpperCase() ?? "N/A"} state={data.market.state} />
          <HeaderMetricMobile label="Sizing" value={formatPercent(data.market.data?.positionSizingPct ?? null)} state={data.market.state} />
          <HeaderMetricMobile label="Snapshots" value={String(data.prediction.data?.snapshotCount ?? 0)} state={data.prediction.state} />
          <HeaderMetricMobile label="1d Matured" value={String(data.prediction.data?.oneDayMatured ?? 0)} state={data.prediction.state} />
        </div>
      </div>
    </section>
  );
}

function HeaderMetric({ label, value, state }: { label: string; value: string; state: LoadState }) {
  return (
    <div className="flex flex-col gap-0.5 px-3 py-0.5">
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className={`text-sm font-semibold leading-tight ${stateTextClass(state)}`}>{value}</span>
    </div>
  );
}

function HeaderMetricMobile({ label, value, state }: { label: string; value: string; state: LoadState }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border/50 px-2 py-1">
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className={`text-xs font-semibold ${stateTextClass(state)}`}>{value}</span>
    </div>
  );
}
