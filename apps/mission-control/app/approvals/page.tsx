import { AutoRefresh } from "@/components/auto-refresh";
import { ApprovalCard } from "@/components/approval-card";
import { ApprovalFilters } from "@/components/approval-filters";
import { GovernanceGuide } from "@/components/governance-guide";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApprovalFilters as Filters, getApprovalById, getApprovals } from "@/lib/approvals";

export const dynamic = "force-dynamic";

const parseNum = (value?: string) => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const filters: Filters = {
    status: (params.status as Filters["status"]) ?? "all",
    risk_level: (params.risk_level as Filters["risk_level"]) ?? undefined,
    rangeHours: parseNum(params.rangeHours) ?? 24 * 90,
    limit: parseNum(params.limit) ?? 120,
  };
  const highlightedId = params.id ?? params.highlight ?? null;

  let approvals: Awaited<ReturnType<typeof getApprovals>> | null = null;
  let highlightedApproval: Awaited<ReturnType<typeof getApprovalById>> | null = null;
  let fetchError: string | null = null;
  try {
    [approvals, highlightedApproval] = await Promise.all([
      getApprovals(filters),
      highlightedId ? getApprovalById(highlightedId) : Promise.resolve(null),
    ]);
  } catch (err) {
    console.error("Failed to load approvals", err);
    fetchError = "Could not load approvals. The database may be unreachable.";
  }

  if (!approvals) {
    return (
      <Card className="border-destructive/40 bg-destructive/5">
        <CardHeader>
          <CardTitle className="text-lg">Approvals unavailable</CardTitle>
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

  const visibleApprovals =
    highlightedApproval && !approvals.some((approval) => approval.id === highlightedApproval.id)
      ? [highlightedApproval, ...approvals]
      : approvals;
  const hasCustomFilters = Boolean(params.status || params.risk_level || params.rangeHours || params.limit);

  const counts = {
    pending: approvals.filter((item) => item.status === "pending").length,
    approved: approvals.filter((item) => ["approved", "approved_edited"].includes(item.status)).length,
    rejected: approvals.filter((item) => item.status === "rejected").length,
    expired: approvals.filter((item) => item.status === "expired").length,
    awaitingResume: approvals.filter((item) => ["approved", "approved_edited"].includes(item.status) && !item.resumedAt).length,
    executed: approvals.filter((item) => Boolean(item.executedAt)).length,
  };

  return (
    <div className="space-y-6">
      <AutoRefresh />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">Governance</p>
          <h1 className="text-3xl font-semibold tracking-tight">Approvals Inbox</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review high-risk actions, record decisions, and preserve a complete audit trail.
          </p>
        </div>
        <Badge variant="secondary">{approvals.length} requests</Badge>
      </div>

      <ApprovalFilters
        params={search}
        selectedStatus={filters.status ?? "all"}
        selectedRiskLevel={filters.risk_level ?? "all"}
        selectedRangeHours={String(filters.rangeHours ?? 24 * 90)}
      />

      <GovernanceGuide
        label="approvals"
        summary="approve risky actions"
        flow={[
          "request is created",
          "human approves or rejects it",
          "if approved, resume can be requested",
          "execution can be recorded",
          "all of that is visible in the audit history",
        ]}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Status breakdown</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Badge variant="outline">Pending: {counts.pending}</Badge>
          <Badge variant="success">Approved: {counts.approved}</Badge>
          <Badge variant="info">Awaiting resume: {counts.awaitingResume}</Badge>
          <Badge variant="secondary">Executed: {counts.executed}</Badge>
          <Badge variant="destructive">Rejected: {counts.rejected}</Badge>
          <Badge variant="warning">Expired: {counts.expired}</Badge>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {visibleApprovals.length === 0 ? (
          <Card>
            <CardContent className="py-8">
              <p className="text-sm text-muted-foreground">
                {hasCustomFilters
                  ? "No approval requests match the current filters. Expand the range or clear the risk filter."
                  : "No approval requests have been recorded yet. This inbox fills when an automation or service requests human approval."}
              </p>
            </CardContent>
          </Card>
        ) : (
          visibleApprovals.map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              highlighted={approval.id === highlightedId}
              initiallyExpanded={approval.id === highlightedId}
            />
          ))
        )}
      </div>
    </div>
  );
}
