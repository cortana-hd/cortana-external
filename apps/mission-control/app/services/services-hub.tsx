"use client";

import * as React from "react";
import {
  Bot,
  Clock,
  Cog,
  LayoutGrid,
  ScrollText,
  Timer,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { OverviewTab } from "./tabs/overview-tab";
import { AgentsTab } from "./tabs/agents-tab";
import { SessionsTab } from "./tabs/sessions-tab";
import { LogsTab } from "./tabs/logs-tab";
import { TabLoading } from "./tabs/shared";
import type {
  SerializedAgent,
  CouncilSessionSummary,
  UsageData,
  SessionData,
  LogEntry,
  Tab,
} from "./tabs/shared";

/* ── lazy imports for heavy tab content ── */
const ServicesClient = React.lazy(() => import("./services-client"));
const CronClient = React.lazy(() =>
  import("@/app/cron/cron-client").then((m) => ({ default: m.CronClient })),
);

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: "overview", label: "Overview", icon: <LayoutGrid className="h-3.5 w-3.5" /> },
  { key: "config", label: "Configuration", icon: <Cog className="h-3.5 w-3.5" /> },
  { key: "agents", label: "Agents", icon: <Bot className="h-3.5 w-3.5" /> },
  { key: "cron", label: "Cron Jobs", icon: <Clock className="h-3.5 w-3.5" /> },
  { key: "sessions", label: "Sessions", icon: <Timer className="h-3.5 w-3.5" /> },
  { key: "logs", label: "Logs", icon: <ScrollText className="h-3.5 w-3.5" /> },
];

const WORKER_IDS = new Set(["huragok-worker"]);

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
