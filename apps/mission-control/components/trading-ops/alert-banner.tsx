import { AlertTriangle } from "lucide-react";
import type { TradingOpsDashboardData } from "@/lib/trading-ops-contract";

export function AlertBanner({ data }: { data: TradingOpsDashboardData }) {
  const incidents = data.runtime.data?.incidents ?? [];
  const errorArtifacts = [data.market, data.runtime, data.workflow, data.canary, data.tradingRun].filter((a) => a.state === "error");
  const tradingRunFallback = data.tradingRun.badgeText === "fallback";
  const isCritical = errorArtifacts.length > 0;
  const message =
    isCritical
      ? `${errorArtifacts.length} artifact(s) in error state — check immediately`
      : incidents.length > 0
        ? `${incidents[0].incidentType}: ${incidents[0].operatorAction}`
        : tradingRunFallback
          ? `trading_run_state_fallback: ${data.tradingRun.message}`
        : "";

  return (
    <div className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium ${isCritical ? "terminal-alert-critical" : "terminal-alert-warning"}`}>
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{message}</span>
    </div>
  );
}
