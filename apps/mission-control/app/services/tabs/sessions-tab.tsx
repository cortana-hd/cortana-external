import {
  DollarSign,
  LineChart,
  Timer,
  Users,
} from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { TabLayout, SectionCard, ListRow, EmptyState, StatCard, RefreshButton, formatInt, formatMoney } from "./shared";
import type { SessionData, CouncilSessionSummary, UsageData } from "./shared";

export function SessionsTab({
  sessions,
  councilSessions,
  usage,
  loading,
  error,
  onRefresh,
}: {
  sessions: SessionData[];
  councilSessions: CouncilSessionSummary[];
  usage: UsageData | null;
  loading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
}) {
  const totalTokens = sessions.reduce((s, x) => s + (x.totalTokens ?? 0), 0);

  return (
    <TabLayout
      title="Sessions"
      subtitle="Cost, token usage, and active session analytics"
      loading={loading}
      error={error}
      actions={onRefresh && <RefreshButton onClick={onRefresh} loading={loading} />}
      stats={usage ? (
        <>
          <StatCard icon={<DollarSign className="h-4 w-4" />} label="Cost (24h)" value={formatMoney(usage.totals.estimatedCost)} sub={`${formatInt(usage.totals.sessions)} sessions`} />
          <StatCard icon={<LineChart className="h-4 w-4" />} label="Input Tokens" value={formatInt(usage.totals.inputTokens)} sub="24h window" />
          <StatCard icon={<LineChart className="h-4 w-4" />} label="Output Tokens" value={formatInt(usage.totals.outputTokens)} sub="24h window" />
          <StatCard icon={<Timer className="h-4 w-4" />} label="Active Sessions" value={String(sessions.length)} sub={`${formatInt(totalTokens)} tokens`} />
        </>
      ) : undefined}
    >
      {usage && (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <SectionCard title="By Model">
            {usage.byModel.length === 0 ? (
              <EmptyState message="No usage data." />
            ) : (
              <div className="space-y-2">
                {usage.byModel.map((row) => (
                  <ListRow key={row.model}>
                    <div>
                      <p className="text-sm font-medium">{row.model}</p>
                      <p className="text-[11px] text-muted-foreground">{formatInt(row.sessions)} sessions · {formatInt(row.totalTokens)} tokens</p>
                    </div>
                    <span className="font-mono text-sm font-semibold">{formatMoney(row.estimatedCost)}</span>
                  </ListRow>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title="By Agent">
            {usage.byAgent.length === 0 ? (
              <EmptyState message="No usage data." />
            ) : (
              <div className="space-y-2">
                {usage.byAgent.map((row) => (
                  <ListRow key={row.agentId}>
                    <div>
                      <p className="text-sm font-medium">{row.agentId}</p>
                      <p className="text-[11px] text-muted-foreground">{formatInt(row.sessions)} sessions · {formatInt(row.totalTokens)} tokens</p>
                    </div>
                    <span className="font-mono text-sm font-semibold">{formatMoney(row.estimatedCost)}</span>
                  </ListRow>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      )}

      <SectionCard title="Active Sessions" count={sessions.length}>
        {sessions.length === 0 ? (
          <EmptyState message="No active sessions." />
        ) : (
          <div className="space-y-2">
            {sessions.map((s, i) => (
              <ListRow key={s.key ?? s.sessionId ?? `s-${i}`}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{s.agentId ?? "unknown"}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">{s.model ?? "unknown"}</p>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <p className="font-mono font-semibold">{formatMoney(s.estimatedCost)}</p>
                  <p>{formatInt(s.totalTokens ?? 0)} tokens</p>
                </div>
              </ListRow>
            ))}
          </div>
        )}
      </SectionCard>

      {councilSessions.length > 0 && (
        <SectionCard
          icon={<Users className="h-4 w-4" />}
          title="Council Sessions"
          count={councilSessions.length}
        >
          <div className="space-y-2">
            {councilSessions.map((session) => (
              <ListRow key={session.id}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{session.topic}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {session.mode} · {new Date(session.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {session.confidence != null && (
                    <span className="font-mono text-xs text-muted-foreground">{(session.confidence * 100).toFixed(0)}%</span>
                  )}
                  <StatusBadge value={session.status} variant="task" />
                </div>
              </ListRow>
            ))}
          </div>
        </SectionCard>
      )}
    </TabLayout>
  );
}
