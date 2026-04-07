import { ReadStep } from "./shared";

export function OperatorChecklist() {
  return (
    <details className="rounded-md border border-border/50 bg-muted/20 px-3 py-2">
      <summary className="cursor-pointer font-mono text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Operator checklist (4 steps)
      </summary>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <ReadStep title="1. Market posture" body="If regime is correction and sizing is 0%, do not force buys." />
        <ReadStep title="2. Runtime health" body="Provider cooldown or auth trouble means expect slower signals." />
        <ReadStep title="3. Latest workflow" body="Check whether CANSLIM and Dip Buyer finished without failures." />
        <ReadStep title="4. Prediction & lifecycle" body="Judge system improvement over time, not to override posture." />
      </div>
    </details>
  );
}
