"use client";

import * as React from "react";
import Link from "next/link";
import {
  Bot,
  Clock,
  DollarSign,
  LineChart,
  PlugZap,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { StatCard, formatInt, formatMoney } from "./shared";
import type { SerializedAgent, CouncilSessionSummary, UsageData, Tab } from "./shared";

const SystemStatsClient = React.lazy(() => import("@/app/system-stats/system-stats-client"));

export function OverviewTab({ agents, councilSessions, usage, onSwitchTab }: { agents: SerializedAgent[]; councilSessions: CouncilSessionSummary[]; usage: UsageData | null; onSwitchTab: (tab: Tab) => void }) {
  const activeAgents = agents.filter((a) => a.status === "active").length;
  const runningCouncil = councilSessions.filter((s) => s.status === "running").length;

  return (
    <div className="space-y-4">
      {/* System health (live polling) */}
      <React.Suspense fallback={<div className="h-32 animate-pulse rounded-lg bg-muted/20" />}>
        <SystemStatsClient />
      </React.Suspense>

      {/* Quick stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={<Bot className="h-4 w-4" />} label="Agents" value={`${activeAgents}/${agents.length}`} sub="active" />
        <StatCard icon={<Clock className="h-4 w-4" />} label="Council" value={String(councilSessions.length)} sub={`${runningCouncil} running`} />
        <StatCard icon={<DollarSign className="h-4 w-4" />} label="Cost (24h)" value={usage ? formatMoney(usage.totals.estimatedCost) : "—"} sub={usage ? `${formatInt(usage.totals.sessions)} sessions` : ""} />
        <StatCard icon={<LineChart className="h-4 w-4" />} label="Tokens (24h)" value={usage ? formatInt(usage.totals.totalTokens) : "—"} sub={usage ? `in: ${formatInt(usage.totals.inputTokens)}` : ""} />
      </div>

      {/* Service health */}
      <Card className="gap-3 py-4">
        <CardHeader className="gap-1 px-5">
          <div className="flex items-center gap-2">
            <PlugZap className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-semibold uppercase tracking-wide">External Services</CardTitle>
          </div>
          <p className="text-xs text-muted-foreground">Connect and monitor third-party integrations. Use the Configuration tab to manage credentials.</p>
        </CardHeader>
        <CardContent className="px-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <ServiceCard name="Schwab" description="Market data & brokerage" onClick={() => onSwitchTab("config")} />
            <ServiceCard name="Whoop" description="Recovery & sleep tracking" onClick={() => onSwitchTab("config")} />
            <ServiceCard name="Tonal" description="Strength training data" onClick={() => onSwitchTab("config")} />
            <ServiceCard name="Alpaca" description="Paper/live trade execution" onClick={() => onSwitchTab("config")} />
            <ServiceCard name="CoinMarketCap" description="Crypto market data" onClick={() => onSwitchTab("config")} />
            <ServiceCard name="FRED" description="Federal Reserve economic data" onClick={() => onSwitchTab("config")} />
          </div>
        </CardContent>
      </Card>

      {/* Agent summary */}
      <Card className="gap-3 py-4">
        <CardHeader className="gap-1 px-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm font-semibold uppercase tracking-wide">Agent Roster</CardTitle>
            </div>
            <Badge variant="outline" className="text-[10px]">{agents.length} agents</Badge>
          </div>
        </CardHeader>
        <CardContent className="px-5">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {agents.slice(0, 6).map((agent) => (
              <Link
                key={agent.id}
                href={`/agents/${agent.id}`}
                className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/10 px-3 py-2 transition-colors hover:bg-muted/30"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{agent.name}</p>
                  <p className="text-[11px] text-muted-foreground">{agent.role}</p>
                </div>
                <StatusBadge value={agent.status} variant="agent" />
              </Link>
            ))}
          </div>
          {agents.length > 6 && (
            <p className="mt-2 text-xs text-muted-foreground">
              + {agents.length - 6} more — see Agents tab
            </p>
          )}
        </CardContent>
      </Card>

      {/* Recent council */}
      {councilSessions.length > 0 && (
        <Card className="gap-3 py-4">
          <CardHeader className="gap-1 px-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-semibold uppercase tracking-wide">Recent Council Sessions</CardTitle>
              </div>
              <Badge variant="outline" className="text-[10px]">{councilSessions.length}</Badge>
            </div>
          </CardHeader>
          <CardContent className="px-5">
            <div className="space-y-2">
              {councilSessions.slice(0, 5).map((session) => (
                <div key={session.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-muted/10 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{session.topic}</p>
                    <p className="text-[11px] text-muted-foreground">{session.mode} · {new Date(session.createdAt).toLocaleDateString()}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {session.confidence != null && (
                      <span className="text-xs font-mono text-muted-foreground">{(session.confidence * 100).toFixed(0)}%</span>
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

function ServiceCard({ name, description, onClick }: { name: string; description: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-border/50 bg-muted/10 px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-muted/30"
    >
      <p className="text-sm font-semibold">{name}</p>
      <p className="text-[11px] text-muted-foreground">{description}</p>
      <p className="mt-1 text-[10px] text-primary">Configure &rarr;</p>
    </button>
  );
}
