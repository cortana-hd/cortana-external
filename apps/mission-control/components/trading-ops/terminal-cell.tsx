import { Badge } from "@/components/ui/badge";
import type { LoadState } from "@/lib/trading-ops";
import { summarizeStateVariant } from "@/lib/trading-ops";
import { panelBorderClass } from "./shared";

export function TerminalCell({
  title,
  value,
  detail,
  state,
  icon,
}: {
  title: string;
  value: string;
  detail: string;
  state: LoadState;
  icon: React.ReactNode;
}) {
  return (
    <div className={`rounded-lg border border-border/70 bg-card/60 p-3 ${panelBorderClass(state)}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="terminal-metric-label">{title}</span>
        <div className="flex items-center gap-1.5">
          <Badge variant={summarizeStateVariant(state)} className="text-[10px]">{state}</Badge>
          <div className="text-muted-foreground">{icon}</div>
        </div>
      </div>
      <p className="mt-1.5 truncate font-mono text-sm font-semibold leading-tight">{value}</p>
      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{detail}</p>
    </div>
  );
}
