import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getUsageAnalytics } from "@/lib/usage-analytics";
import { formatInt, formatCost } from "@/lib/format-utils";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function resolveMinutes(raw: string | string[] | undefined): string {
  if (Array.isArray(raw)) return raw[0] ?? "1440";
  return raw ?? "1440";
}

export default async function UsagePage({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const minutes = resolveMinutes(params.minutes);
  const usage = await getUsageAnalytics(minutes);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Usage Analytics</h1>
        <p className="text-sm text-muted-foreground">
          Model and agent spend using OpenClaw session telemetry (window: last {usage.windowMinutes} minutes).
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Estimated cost</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{formatCost(usage.totals.estimatedCost)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Sessions</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{formatInt(usage.totals.sessions)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Input tokens</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{formatInt(usage.totals.inputTokens)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Output tokens</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{formatInt(usage.totals.outputTokens)}</CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">By model</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {usage.byModel.length === 0 ? (
              <p className="text-sm text-muted-foreground">No usage found for this window.</p>
            ) : (
              usage.byModel.map((row) => (
                <div key={row.model} className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium">{row.model}</p>
                    <p className="text-sm font-semibold">{formatCost(row.estimatedCost)}</p>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatInt(row.sessions)} sessions · {formatInt(row.totalTokens)} tokens
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">By agent</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {usage.byAgent.length === 0 ? (
              <p className="text-sm text-muted-foreground">No usage found for this window.</p>
            ) : (
              usage.byAgent.map((row) => (
                <div key={row.agentId} className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium">{row.agentId}</p>
                    <p className="text-sm font-semibold">{formatCost(row.estimatedCost)}</p>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatInt(row.sessions)} sessions · {formatInt(row.totalTokens)} tokens
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
