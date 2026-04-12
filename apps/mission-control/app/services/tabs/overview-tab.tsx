"use client";

import Link from "next/link";
import {
  Bot,
  Clock,
  DollarSign,
  LineChart,
  Palmtree,
  PlugZap,
  Users,
} from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { TabLayout, SectionCard, ListRow, EmptyState, StatCard, RefreshButton, formatInt, formatMoney } from "./shared";
import type { SerializedAgent, CouncilSessionSummary, UsageData, Tab } from "./shared";

import SystemStatsClient from "@/app/system-stats/system-stats-client";

export function OverviewTab({ agents, councilSessions, usage, onSwitchTab, loading, error, onRefresh }: { agents: SerializedAgent[]; councilSessions: CouncilSessionSummary[]; usage: UsageData | null; onSwitchTab: (tab: Tab) => void; loading?: boolean; error?: string | null; onRefresh?: () => void }) {
  const activeAgents = agents.filter((a) => a.status === "active").length;
  const runningCouncil = councilSessions.filter((s) => s.status === "running").length;

  return (
    <TabLayout
      title="Overview"
      subtitle="System health, agents, and council activity"
      loading={loading}
      error={error}
      actions={onRefresh && <RefreshButton onClick={onRefresh} loading={loading} />}
      stats={
        <>
          <StatCard icon={<Bot className="h-4 w-4" />} label="Agents" value={`${activeAgents}/${agents.length}`} sub="active" />
          <StatCard icon={<Clock className="h-4 w-4" />} label="Council" value={String(councilSessions.length)} sub={`${runningCouncil} running`} />
          <StatCard icon={<DollarSign className="h-4 w-4" />} label="Cost (24h)" value={usage ? formatMoney(usage.totals.estimatedCost) : "—"} sub={usage ? `${formatInt(usage.totals.sessions)} sessions` : ""} />
          <StatCard icon={<LineChart className="h-4 w-4" />} label="Tokens (24h)" value={usage ? formatInt(usage.totals.totalTokens) : "—"} sub={usage ? `in: ${formatInt(usage.totals.inputTokens)}` : ""} />
        </>
      }
    >
      <SystemStatsClient hideHeader />

      <SectionCard
        icon={<PlugZap className="h-4 w-4" />}
        title="External Services"
        subtitle="Connect and monitor third-party integrations. Use the Configuration tab to manage credentials."
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <ServiceTile name="Schwab" description="Market data & brokerage" onClick={() => onSwitchTab("config")} />
          <ServiceTile name="Whoop" description="Recovery & sleep tracking" onClick={() => onSwitchTab("config")} />
          <ServiceTile name="Tonal" description="Strength training data" onClick={() => onSwitchTab("config")} />
          <ServiceTile name="Alpaca" description="Paper/live trade execution" onClick={() => onSwitchTab("config")} />
          <ServiceTile name="CoinMarketCap" description="Crypto market data" onClick={() => onSwitchTab("config")} />
          <ServiceTile name="FRED" description="Federal Reserve economic data" onClick={() => onSwitchTab("config")} />
        </div>
      </SectionCard>

      <SectionCard
        icon={<Palmtree className="h-4 w-4" />}
        title="Vacation Ops"
        subtitle="Away-mode readiness, activation, and unattended incident visibility."
      >
        <button
          type="button"
          onClick={() => onSwitchTab("vacation")}
          className="w-full rounded-lg border border-border/50 bg-muted/10 px-4 py-3 text-left transition-colors hover:border-border hover:bg-muted/20"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Open Vacation Ops console</p>
              <p className="text-[11px] text-muted-foreground">Run preflight, enable away mode, and inspect incidents without leaving Services.</p>
            </div>
            <span className="text-[10px] text-primary">Open tab →</span>
          </div>
        </button>
      </SectionCard>

      <SectionCard
        icon={<Bot className="h-4 w-4" />}
        title="Agent Roster"
        count={`${agents.length} agents`}
      >
        {agents.length === 0 ? (
          <EmptyState message="No agents registered." />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {agents.slice(0, 6).map((agent) => (
                <Link
                  key={agent.id}
                  href={`/agents/${agent.id}`}
                  className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/10 px-3 py-2 transition-colors hover:bg-muted/20"
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
              <p className="mt-2 text-xs text-muted-foreground">+ {agents.length - 6} more — see Agents tab</p>
            )}
          </>
        )}
      </SectionCard>

      {councilSessions.length > 0 && (
        <SectionCard
          icon={<Users className="h-4 w-4" />}
          title="Recent Council Sessions"
          count={councilSessions.length}
        >
          <div className="space-y-2">
            {councilSessions.slice(0, 5).map((session) => (
              <ListRow key={session.id}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{session.topic}</p>
                  <p className="text-[11px] text-muted-foreground">{session.mode} · {new Date(session.createdAt).toLocaleDateString()}</p>
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

function ServiceTile({ name, description, onClick }: { name: string; description: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-border/50 bg-muted/10 px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-muted/20"
    >
      <p className="text-sm font-semibold">{name}</p>
      <p className="text-[11px] text-muted-foreground">{description}</p>
      <p className="mt-1 text-[10px] text-primary">Configure &rarr;</p>
    </button>
  );
}
