import { AlertTriangle } from "lucide-react";
import type { TradingOpsDashboardData } from "@/lib/trading-ops";

export function AlertBanner({ data }: { data: TradingOpsDashboardData }) {
  const incidents = data.runtime.data?.incidents ?? [];
  const errorArtifacts = [data.market, data.runtime, data.workflow, data.canary].filter((a) => a.state === "error");
  const isCritical = errorArtifacts.length > 0;
  const message =
    isCritical
      ? `${errorArtifacts.length} artifact(s) in error state — check immediately`
      : incidents.length > 0
        ? `${incidents[0].incidentType}: ${incidents[0].operatorAction}`
        : "";

  return (
    <div className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium ${isCritical ? "terminal-alert-critical" : "terminal-alert-warning"}`}>
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{message}</span>
    </div>
  );
}
