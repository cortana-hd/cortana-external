"use client";

import * as React from "react";
import Link from "next/link";
import {
  Bot,
  Clock,
  Cog,
  DollarSign,
  LayoutGrid,
  LineChart,
  PlugZap,
  ScrollText,
  Timer,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";

/* ── lazy imports for heavy tab content ── */
const ServicesClient = React.lazy(() => import("./services-client"));
const CronClient = React.lazy(() =>
  import("@/app/cron/cron-client").then((m) => ({ default: m.CronClient })),
);
const SystemStatsClient = React.lazy(() => import("@/app/system-stats/system-stats-client"));

/* ── types ── */

type SerializedAgent = {
  id: string;
  name: string;
  role: string;
  status: string;
  model: string | null;
  modelDisplay: string | null;
  capabilities: string;
  healthScore: number | null;
  lastSeen: string | null;
};

type CouncilSessionSummary = {
  id: string;
  topic: string;
  status: string;
  mode: string;
  confidence: number | null;
  createdAt: string;
  decidedAt: string | null;
};

type UsageData = {
  windowMinutes: number;
  totals: { sessions: number; totalTokens: number; inputTokens: number; outputTokens: number; estimatedCost: number };
  byModel: Array<{ model: string; sessions: number; totalTokens: number; estimatedCost: number }>;
  byAgent: Array<{ agentId: string; model: string; sessions: number; totalTokens: number; estimatedCost: number }>;
};

type SessionData = {
  key: string | null;
  sessionId: string | null;
  updatedAt: number | null;
  totalTokens: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  model: string | null;
  agentId: string | null;
  estimatedCost: number;
};

type LogEntry = {
  id: number;
  timestamp: string;
  severity: string;
  source: string;
  eventType: string;
  message: string;
};

type Tab = "overview" | "config" | "agents" | "cron" | "sessions" | "logs";

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: "overview", label: "Overview", icon: <LayoutGrid className="h-3.5 w-3.5" /> },
  { key: "config", label: "Configuration", icon: <Cog className="h-3.5 w-3.5" /> },
  { key: "agents", label: "Agents", icon: <Bot className="h-3.5 w-3.5" /> },
  { key: "cron", label: "Cron Jobs", icon: <Clock className="h-3.5 w-3.5" /> },
  { key: "sessions", label: "Sessions", icon: <Timer className="h-3.5 w-3.5" /> },
  { key: "logs", label: "Logs", icon: <ScrollText className="h-3.5 w-3.5" /> },
];

const WORKER_IDS = new Set(["huragok-worker"]);

const formatInt = (v: number) => new Intl.NumberFormat("en-US").format(Math.round(v));
const formatMoney = (v: number) => `$${v.toFixed(4)}`;

/* ── hub component ── */

export default function ServicesHub() {
  const [activeTab, setActiveTab] = React.useState<Tab>("overview");

  /* ── data state (all fetched client-side for instant page load) ── */
  const [agents, setAgents] = React.useState<SerializedAgent[]>([]);
  const [councilSessions, setCouncilSessions] = React.useState<CouncilSessionSummary[]>([]);
  const [usage, setUsage] = React.useState<UsageData | null>(null);
  const [sessions, setSessions] = React.useState<SessionData[]>([]);
  const [logs, setLogs] = React.useState<LogEntry[]>([]);
  const [logsLoading, setLogsLoading] = React.useState(false);
  const [logsLoaded, setLogsLoaded] = React.useState(false);
  const [dataLoading, setDataLoading] = React.useState(true);
  const [sessionsLoading, setSessionsLoading] = React.useState(false);
  const [sessionsLoaded, setSessionsLoaded] = React.useState(false);

  /* Preload heavy tab chunks in background */
  React.useEffect(() => {
    void import("./services-client");
    void import("@/app/cron/cron-client");
    void import("@/app/system-stats/system-stats-client");
  }, []);

  /* Fetch agents, council, usage in parallel on mount */
  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setDataLoading(true);
      const [agentsRes, councilRes, usageRes] = await Promise.allSettled([
        fetch("/api/agents", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/council", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/usage", { cache: "no-store" }).then((r) => r.json()),
      ]);
      if (cancelled) return;

      if (agentsRes.status === "fulfilled") {
        const raw = agentsRes.value?.agents ?? agentsRes.value ?? [];
        if (Array.isArray(raw)) {
          setAgents(raw.map((a: Record<string, unknown>) => ({
            id: String(a.id ?? ""),
            name: String(a.name ?? ""),
            role: String(a.role ?? ""),
            status: String(a.status ?? "unknown"),
            model: (a.model as string) ?? null,
            modelDisplay: (a.modelDisplay as string) ?? null,
            capabilities: String(a.capabilities ?? ""),
            healthScore: typeof a.healthScore === "number" ? a.healthScore : null,
            lastSeen: a.lastSeen ? String(a.lastSeen) : null,
          })));
        }
      }

      if (councilRes.status === "fulfilled") {
        const raw = councilRes.value?.sessions ?? councilRes.value ?? [];
        if (Array.isArray(raw)) {
          setCouncilSessions(raw.map((s: Record<string, unknown>) => ({
            id: String(s.id ?? ""),
            topic: String(s.topic ?? ""),
            status: String(s.status ?? ""),
            mode: String(s.mode ?? ""),
            confidence: typeof s.confidence === "number" ? s.confidence : null,
            createdAt: String(s.createdAt ?? ""),
            decidedAt: s.decidedAt ? String(s.decidedAt) : null,
          })));
        }
      }

      if (usageRes.status === "fulfilled" && usageRes.value) {
        const u = usageRes.value;
        if (u.totals) setUsage(u as UsageData);
      }

      setDataLoading(false);
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  /* lazy-load sessions when tab is activated */
  React.useEffect(() => {
    if (activeTab !== "sessions" || sessionsLoaded) return;
    let cancelled = false;
    const load = async () => {
      setSessionsLoading(true);
      try {
        const res = await fetch("/api/sessions", { cache: "no-store" });
        const data = (await res.json()) as { sessions?: SessionData[] };
        if (!cancelled) {
          setSessions(data.sessions ?? []);
          setSessionsLoaded(true);
        }
      } catch { /* ignore */ } finally {
        if (!cancelled) setSessionsLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [activeTab, sessionsLoaded]);

  /* lazy-load logs when tab is activated */
  React.useEffect(() => {
    if (activeTab !== "logs" || logsLoaded) return;
    let cancelled = false;
    const load = async () => {
      setLogsLoading(true);
      try {
        const res = await fetch("/api/logs?rangeHours=24&limit=100", { cache: "no-store" });
        const data = (await res.json()) as { logs?: LogEntry[] };
        if (!cancelled) {
          setLogs(data.logs ?? []);
          setLogsLoaded(true);
        }
      } catch { /* ignore */ } finally {
        if (!cancelled) setLogsLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [activeTab, logsLoaded]);

  const coreAgents = agents.filter((a) => !WORKER_IDS.has(a.id));
  const workerAgents = agents.filter((a) => WORKER_IDS.has(a.id));

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="space-y-1">
        <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">OpenClaw</p>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Services & Operations</h1>
        <p className="text-sm text-muted-foreground">
          Configuration, agents, scheduled jobs, and session analytics in one view.
        </p>
      </div>

      {/* Tab bar */}
      <div className="border-b border-border/50">
        <nav className="flex gap-0 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
                activeTab === tab.key
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      <div className="min-h-[50vh]">
        {activeTab === "overview" && (
          dataLoading
            ? <TabLoading />
            : <OverviewTab agents={agents} councilSessions={councilSessions} usage={usage} onSwitchTab={setActiveTab} />
        )}
        {activeTab === "config" && (
          <React.Suspense fallback={<TabLoading />}>
            <ServicesClient />
          </React.Suspense>
        )}
        {activeTab === "agents" && (
          dataLoading
            ? <TabLoading />
            : <AgentsTab coreAgents={coreAgents} workerAgents={workerAgents} />
        )}
        {activeTab === "cron" && (
          <React.Suspense fallback={<TabLoading />}>
            <CronClient />
          </React.Suspense>
        )}
        {activeTab === "sessions" && (
          <SessionsTab
            sessions={sessions}
            sessionsLoading={sessionsLoading}
            councilSessions={councilSessions}
            usage={usage}
          />
        )}
        {activeTab === "logs" && (
          <LogsTab logs={logs} loading={logsLoading} />
        )}
      </div>
    </div>
  );
}

function TabLoading() {
  return (
    <div className="space-y-3 py-4">
      <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/10 px-4 py-3">
        <div className="h-3 w-48 animate-pulse rounded bg-muted/60" />
        <div className="flex gap-2">
          <div className="h-7 w-20 animate-pulse rounded bg-muted/60" />
          <div className="h-7 w-16 animate-pulse rounded bg-muted/60" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded-lg border border-border/50 bg-card/40 p-3">
            <div className="h-3 w-24 animate-pulse rounded bg-muted/60" />
            <div className="mt-2 h-4 w-32 animate-pulse rounded bg-muted/60" />
            <div className="mt-1 h-3 w-40 animate-pulse rounded bg-muted/60" />
          </div>
        ))}
      </div>
      {[1, 2, 3].map((i) => (
        <div key={i} className="rounded-lg border border-border/50 bg-card/30 p-4">
          <div className="h-4 w-36 animate-pulse rounded bg-muted/60" />
          <div className="mt-1 h-3 w-64 animate-pulse rounded bg-muted/60" />
        </div>
      ))}
    </div>
  );
}

/* ── Overview Tab ── */

function OverviewTab({ agents, councilSessions, usage, onSwitchTab }: { agents: SerializedAgent[]; councilSessions: CouncilSessionSummary[]; usage: UsageData | null; onSwitchTab: (tab: Tab) => void }) {
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

/* ── Agents Tab ── */

function AgentsTab({ coreAgents, workerAgents }: { coreAgents: SerializedAgent[]; workerAgents: SerializedAgent[] }) {
  return (
    <div className="space-y-4">
      {workerAgents.length > 0 && (
        <Card className="gap-3 border-primary/25 bg-primary/5 py-4">
          <CardHeader className="gap-1 px-5">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide">Execution Workers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 px-5">
            {workerAgents.map((agent) => (
              <Link
                key={agent.id}
                href={`/agents/${agent.id}`}
                className="block rounded-lg border bg-background/90 p-3 transition-colors hover:bg-muted/40"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{agent.name}</p>
                    <p className="text-sm text-muted-foreground">{agent.role}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Last seen: {agent.lastSeen ? new Date(agent.lastSeen).toLocaleString() : "Unknown"}
                    </p>
                  </div>
                  <StatusBadge value={agent.status} variant="agent" />
                </div>
                {(agent.modelDisplay || agent.model) && (
                  <p className="mt-2 font-mono text-[11px] text-muted-foreground">{agent.modelDisplay || agent.model}</p>
                )}
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="gap-3 py-4">
        <CardHeader className="gap-1 px-5">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide">Core Agent Directory</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto px-5">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/70 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Agent</th>
                <th className="px-3 py-2">Role</th>
                <th className="hidden px-3 py-2 sm:table-cell">Capabilities</th>
                <th className="hidden px-3 py-2 sm:table-cell">Model</th>
                <th className="px-3 py-2 text-right">Health</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {coreAgents.map((agent) => (
                <tr key={agent.id} className="border-t transition-colors hover:bg-muted/30">
                  <td className="px-3 py-3">
                    <Link href={`/agents/${agent.id}`} className="group block">
                      <p className="font-semibold group-hover:text-primary">{agent.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Last seen: {agent.lastSeen ? new Date(agent.lastSeen).toLocaleString() : "Unknown"}
                      </p>
                    </Link>
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">{agent.role}</td>
                  <td className="hidden px-3 py-3 text-sm text-muted-foreground sm:table-cell">{agent.capabilities}</td>
                  <td className="hidden px-3 py-3 sm:table-cell">
                    <span className="font-mono text-xs text-muted-foreground">{agent.modelDisplay || agent.model || "—"}</span>
                  </td>
                  <td className="px-3 py-3 text-right text-muted-foreground">
                    {typeof agent.healthScore === "number" ? agent.healthScore.toFixed(1) : "—"}
                  </td>
                  <td className="px-3 py-3"><StatusBadge value={agent.status} variant="agent" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

/* ── Sessions Tab (merged: sessions + council + usage) ── */

function SessionsTab({
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
  const totalCost = sessions.reduce((s, x) => s + (x.estimatedCost ?? 0), 0);

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

/* ── small sub-components ── */

/* ── Logs Tab ── */

function LogsTab({ logs, loading }: { logs: LogEntry[]; loading: boolean }) {
  const severityVariant = (s: string) => {
    const n = s.toLowerCase();
    if (["critical", "error", "failed"].some((k) => n.includes(k))) return "destructive" as const;
    if (n.includes("warn")) return "warning" as const;
    if (["success", "ok", "done"].some((k) => n.includes(k))) return "success" as const;
    return "info" as const;
  };

  const timeFmt = new Intl.DateTimeFormat("en-US", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ScrollText className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold uppercase tracking-wide">System Logs</h2>
          <Badge variant="outline" className="text-[10px]">{logs.length} entries</Badge>
        </div>
        <span className="text-[11px] text-muted-foreground">Last 24h · max 100</span>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="rounded-lg border border-border/50 bg-card/40 p-3">
              <div className="h-3 w-48 animate-pulse rounded bg-muted/60" />
              <div className="mt-2 h-4 w-full animate-pulse rounded bg-muted/60" />
            </div>
          ))}
        </div>
      ) : logs.length === 0 ? (
        <p className="py-8 text-sm text-muted-foreground">No log entries in the last 24 hours.</p>
      ) : (
        <div className="space-y-1.5">
          {logs.map((entry) => (
            <div key={entry.id} className="rounded-lg border border-border/50 bg-card/40 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] text-muted-foreground">
                  {timeFmt.format(new Date(entry.timestamp))}
                </span>
                <Badge variant={severityVariant(entry.severity)} className="text-[10px]">
                  {entry.severity}
                </Badge>
                <span className="font-mono text-[10px] text-muted-foreground">{entry.source}</span>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {entry.eventType.replaceAll("_", " ")}
                </span>
              </div>
              <p className="mt-1 break-words text-sm text-foreground/90">{entry.message || entry.eventType}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-border/50 bg-card/60 p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="text-[10px] uppercase tracking-widest">{label}</span>
      </div>
      <p className="mt-1 font-mono text-lg font-semibold leading-tight">{value}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>
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
