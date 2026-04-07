import { ScrollText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { LogEntry } from "./shared";

export function LogsTab({ logs, loading }: { logs: LogEntry[]; loading: boolean }) {
  const severityVariant = (s: string) => {
    const n = s.toLowerCase();
    if (["critical", "error", "failed"].some((k) => n.includes(k))) return "destructive" as const;
    if (n.includes("warn")) return "warning" as const;
    if (["success", "ok", "done"].some((k) => n.includes(k))) return "success" as const;
    return "info" as const;
  };

  const timeFmt = new Intl.DateTimeFormat("en-US", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ScrollText className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold uppercase tracking-wide">System Logs</h2>
          <Badge variant="outline" className="text-[10px]">{logs.length} entries</Badge>
        </div>
        <span className="text-[11px] text-muted-foreground">Last 24h · max 100</span>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="rounded-lg border border-border/50 bg-card/40 p-3">
              <div className="h-3 w-48 animate-pulse rounded bg-muted/60" />
              <div className="mt-2 h-4 w-full animate-pulse rounded bg-muted/60" />
            </div>
          ))}
        </div>
      ) : logs.length === 0 ? (
        <p className="py-8 text-sm text-muted-foreground">No log entries in the last 24 hours.</p>
      ) : (
        <div className="space-y-1.5">
          {logs.map((entry) => (
            <div key={entry.id} className="rounded-lg border border-border/50 bg-card/40 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] text-muted-foreground">
                  {timeFmt.format(new Date(entry.timestamp))}
                </span>
                <Badge variant={severityVariant(entry.severity)} className="text-[10px]">
                  {entry.severity}
                </Badge>
                <span className="font-mono text-[10px] text-muted-foreground">{entry.source}</span>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {entry.eventType.replaceAll("_", " ")}
                </span>
              </div>
              <p className="mt-1 break-words text-sm text-foreground/90">{entry.message || entry.eventType}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
