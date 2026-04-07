import {
  DollarSign,
  LineChart,
  Timer,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { StatCard, formatInt, formatMoney } from "./shared";
import type { SessionData, CouncilSessionSummary, UsageData } from "./shared";

export function SessionsTab({
  sessions,
  sessionsLoading,
  councilSessions,
  usage,
}: {
  sessions: SessionData[];
  sessionsLoading: boolean;
  councilSessions: CouncilSessionSummary[];
  usage: UsageData | null;
}) {
  const totalTokens = sessions.reduce((s, x) => s + (x.totalTokens ?? 0), 0);

  return (
    <div className="space-y-4">
      {/* Usage stats */}
      {usage && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard icon={<DollarSign className="h-4 w-4" />} label="Cost (24h)" value={formatMoney(usage.totals.estimatedCost)} sub={`${formatInt(usage.totals.sessions)} sessions`} />
            <StatCard icon={<LineChart className="h-4 w-4" />} label="Input Tokens" value={formatInt(usage.totals.inputTokens)} sub="24h window" />
            <StatCard icon={<LineChart className="h-4 w-4" />} label="Output Tokens" value={formatInt(usage.totals.outputTokens)} sub="24h window" />
            <StatCard icon={<Timer className="h-4 w-4" />} label="Active Sessions" value={String(sessions.length)} sub={sessionsLoading ? "loading..." : `${formatInt(totalTokens)} tokens`} />
          </div>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <Card className="gap-3 py-4">
              <CardHeader className="gap-1 px-5">
                <CardTitle className="text-sm font-semibold uppercase tracking-wide">By Model</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 px-5">
                {usage.byModel.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No usage data.</p>
                ) : usage.byModel.map((row) => (
                  <div key={row.model} className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/10 px-3 py-2">
                    <div>
                      <p className="text-sm font-medium">{row.model}</p>
                      <p className="text-[11px] text-muted-foreground">{formatInt(row.sessions)} sessions · {formatInt(row.totalTokens)} tokens</p>
                    </div>
                    <span className="font-mono text-sm font-semibold">{formatMoney(row.estimatedCost)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="gap-3 py-4">
              <CardHeader className="gap-1 px-5">
                <CardTitle className="text-sm font-semibold uppercase tracking-wide">By Agent</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 px-5">
                {usage.byAgent.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No usage data.</p>
                ) : usage.byAgent.map((row) => (
                  <div key={row.agentId} className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/10 px-3 py-2">
                    <div>
                      <p className="text-sm font-medium">{row.agentId}</p>
                      <p className="text-[11px] text-muted-foreground">{formatInt(row.sessions)} sessions · {formatInt(row.totalTokens)} tokens</p>
                    </div>
                    <span className="font-mono text-sm font-semibold">{formatMoney(row.estimatedCost)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {/* Active sessions */}
      <Card className="gap-3 py-4">
        <CardHeader className="gap-1 px-5">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide">Active Sessions</CardTitle>
            <Badge variant="outline" className="text-[10px]">{sessions.length}</Badge>
          </div>
        </CardHeader>
        <CardContent className="px-5">
          {sessionsLoading ? (
            <p className="py-4 text-sm text-muted-foreground">Loading sessions...</p>
          ) : sessions.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">No active sessions.</p>
          ) : (
            <div className="space-y-2">
              {sessions.map((s, i) => (
                <div key={s.key ?? s.sessionId ?? `s-${i}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/50 bg-muted/10 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{s.agentId ?? "unknown"}</p>
                    <p className="font-mono text-[11px] text-muted-foreground">{s.model ?? "unknown"}</p>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <p className="font-mono font-semibold">{formatMoney(s.estimatedCost)}</p>
                    <p>{formatInt(s.totalTokens ?? 0)} tokens</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Council sessions */}
      {councilSessions.length > 0 && (
        <Card className="gap-3 py-4">
          <CardHeader className="gap-1 px-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-semibold uppercase tracking-wide">Council Sessions</CardTitle>
              </div>
              <Badge variant="outline" className="text-[10px]">{councilSessions.length}</Badge>
            </div>
          </CardHeader>
          <CardContent className="px-5">
            <div className="space-y-2">
              {councilSessions.map((session) => (
                <div key={session.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-muted/10 px-3 py-2">
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
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
