import { AutoRefresh } from "@/components/auto-refresh";
import { DecisionFiltersBar } from "@/components/decision-filters";
import { DecisionTimeline } from "@/components/decision-timeline";
import { GovernanceGuide } from "@/components/governance-guide";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DecisionFilters, getDecisionTraces } from "@/lib/decision-traces";

export const dynamic = "force-dynamic";

const parseNum = (value?: string) => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export default async function DecisionsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const filters: DecisionFilters = {
    rangeHours: parseNum(params.rangeHours) ?? 24 * 90,
    actionType: params.actionType,
    triggerType: params.triggerType,
    outcome: (params.outcome as DecisionFilters["outcome"]) ?? "all",
    confidenceMin: parseNum(params.confidenceMin),
    confidenceMax: parseNum(params.confidenceMax),
    limit: parseNum(params.limit) ?? 120,
  };

  let data: Awaited<ReturnType<typeof getDecisionTraces>> | null = null;
  let fetchError: string | null = null;
  try {
    data = await getDecisionTraces(filters);
  } catch (err) {
    console.error("Failed to load decision traces", err);
    fetchError = "Could not load decision traces. The database may be unreachable.";
  }

  if (!data) {
    return (
      <Card className="border-destructive/40 bg-destructive/5">
        <CardHeader>
          <CardTitle className="text-lg">Decision Traces unavailable</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>{fetchError}</p>
        </CardContent>
      </Card>
    );
  }

  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) search.set(key, value);
  });

  const confidenceSeries = data.traces
    .filter((trace) => typeof trace.confidence === "number")
    .slice(0, 20)
    .map((trace) => Math.round((trace.confidence ?? 0) * 100));
  const sourceLabel = data.source === "cortana" ? "cortana" : "mission-control fallback";
  const emptyTimelineMessage =
    data.source === "app"
      ? "No decision traces were found in the Mission Control fallback database. Configure CORTANA_DATABASE_URL or verify the trace producer is writing rows."
      : "No traces match current filters.";

  return (
    <div className="space-y-6">
      <AutoRefresh />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">Explainability</p>
          <h1 className="text-3xl font-semibold tracking-tight">Decision Trace Timeline</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Chronological record of autonomous actions, why they happened, and what input signals drove them.
          </p>
        </div>
        <Badge variant="secondary">{data.traces.length} traces · source: {sourceLabel}</Badge>
      </div>

      {data.warning && (
        <Card className="border-warning/40 bg-warning/10">
          <CardHeader>
            <CardTitle className="text-base">Fallback data source</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">{data.warning}</CardContent>
        </Card>
      )}

      <GovernanceGuide
        label="decisions"
        summary="understand why actions happened"
      />

      <DecisionFiltersBar params={search} filters={filters} facets={data.facets} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Confidence timeline</CardTitle>
        </CardHeader>
        <CardContent>
          {confidenceSeries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {data.source === "app"
                ? "No confidence points in the fallback data source."
                : "No confidence points in current slice."}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {confidenceSeries.map((point, idx) => (
                <Badge key={`${point}-${idx}`} variant="outline">{point}%</Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <DecisionTimeline traces={data.traces} emptyMessage={emptyTimelineMessage} />
    </div>
  );
}
