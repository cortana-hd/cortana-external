import { Info } from "lucide-react";

export function GovernanceGuide({
  label,
  summary,
  flow,
}: {
  label: string;
  summary: string;
  flow?: string[];
}) {
  return (
    <details className="group rounded-md border border-border/40 bg-muted/10 px-3 py-2">
      <summary className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5 shrink-0" />
        <span>
          <span className="font-medium capitalize">{label}</span> — {summary}
        </span>
      </summary>
      {flow && flow.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5 pb-0.5">
          {flow.map((step, index) => (
            <span
              key={`${index}-${step}`}
              className="inline-flex items-center rounded border border-border/50 bg-background/70 px-2 py-0.5 text-[11px] text-muted-foreground"
            >
              {index + 1}. {step}
            </span>
          ))}
        </div>
      ) : null}
    </details>
  );
}
