"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type HealthBadgeVariant,
  type HeartbeatStatus,
  SESSION_RECENT_MS,
  SESSION_STALE_MS,
  deriveGatewayHealth,
  deriveHostHealth,
  deriveSessionHealth,
  formatAge,
  heartbeatStatusLabel,
  heartbeatStatusVariant,
  healthStatusLabel,
  healthStatusVariant,
  summarizeSessions,
} from "@/lib/system-stats";

type HeartbeatPayload = {
  ok: boolean;
  lastHeartbeat: number | null;
  status: HeartbeatStatus;
  ageMs: number | null;
};

type ThinkingPayload = {
  ok: boolean;
  idle: boolean;
  current: string;
  items: string[];
  updatedAt: string;
  metrics: {
    activeSubagents: number;
    inProgressTasks: number;
    completedRecently: number;
  };
  heartbeat: {
    status: HeartbeatStatus;
    ageMs: number | null;
    lastHeartbeat: number | null;
  };
};

type DbStatusPayload = {
  postgres: boolean;
  lancedb: boolean;
};

type SessionPayload = {
  updatedAt: number | null;
  abortedLastRun: boolean | null;
  agentId: string | null;
  sessionId: string | null;
};

type SessionsPayload = {
  sessions: SessionPayload[];
};

type SystemStatsData = {
  heartbeat: HeartbeatPayload | null;
  thinking: ThinkingPayload | null;
  db: DbStatusPayload | null;
  sessions: SessionsPayload | null;
};

const POLL_MS = 30_000;
const SESSION_WINDOW_MINUTES = 120;

const formatInt = (value: number) => new Intl.NumberFormat("en-US").format(value);

const dbLabel = (value: boolean | null) => {
  if (value == null) return "Unknown";
  return value ? "Online" : "Offline";
};

const dbVariant = (value: boolean | null): HealthBadgeVariant => {
  if (value == null) return "outline";
  return value ? "success" : "destructive";
};

const fetchJson = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} failed`);
  return (await res.json()) as T;
};

export default function SystemStatsClient() {
  const [data, setData] = useState<SystemStatsData>({
    heartbeat: null,
    thinking: null,
    db: null,
    sessions: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [snapshotAt, setSnapshotAt] = useState<number>(() => Date.now());

  const fetchStats = useCallback(async () => {
    const [heartbeatResult, thinkingResult, dbResult, sessionsResult] = await Promise.allSettled([
      fetchJson<HeartbeatPayload>("/api/heartbeat-status"),
      fetchJson<ThinkingPayload>("/api/thinking-status"),
      fetchJson<DbStatusPayload>("/api/db-status"),
      fetchJson<SessionsPayload>(`/api/sessions?minutes=${SESSION_WINDOW_MINUTES}`),
    ]);

    const errors: string[] = [];

    setData((prev) => {
      const next = { ...prev };

      if (heartbeatResult.status === "fulfilled") next.heartbeat = heartbeatResult.value;
      else errors.push("heartbeat");

      if (thinkingResult.status === "fulfilled") next.thinking = thinkingResult.value;
      else errors.push("gateway");

      if (dbResult.status === "fulfilled") next.db = dbResult.value;
      else errors.push("db");

      if (sessionsResult.status === "fulfilled") next.sessions = sessionsResult.value;
      else errors.push("sessions");

      return next;
    });

    setSnapshotAt(Date.now());
    setError(errors.length > 0 ? `Partial data: ${errors.join(", ")}` : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(fetchStats, 0);
    const interval = window.setInterval(fetchStats, POLL_MS);
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, [fetchStats]);

  const heartbeatStatus = data.heartbeat?.status ?? null;
  const hostHealth = deriveHostHealth({
    heartbeat: heartbeatStatus,
    postgres: data.db?.postgres ?? null,
    lancedb: data.db?.lancedb ?? null,
  });

  const gatewayHealth = deriveGatewayHealth({
    heartbeat: data.thinking?.heartbeat?.status ?? null,
    idle: data.thinking?.idle ?? null,
  });

  const sessionSummary = useMemo(
    () => summarizeSessions(data.sessions?.sessions ?? [], snapshotAt, SESSION_RECENT_MS, SESSION_STALE_MS),
    [data.sessions, snapshotAt]
  );
  const sessionHealth = deriveSessionHealth(sessionSummary);

  const lastHeartbeat = formatAge(data.heartbeat?.ageMs ?? null);
  const lastGatewayUpdate = data.thinking?.updatedAt
    ? new Date(data.thinking.updatedAt).toLocaleTimeString()
    : "—";
  const lastSessionAgeMs =
    sessionSummary.lastUpdated == null ? null : Math.max(0, snapshotAt - sessionSummary.lastUpdated);
  const lastSessionUpdate = sessionSummary.lastUpdated == null ? "—" : formatAge(lastSessionAgeMs);

  const recentMinutes = Math.round(SESSION_RECENT_MS / 60_000);
  const staleHours = Math.round(SESSION_STALE_MS / 60_000 / 60);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">System Stats</h1>
          <p className="text-sm text-muted-foreground">
            Host, gateway, and session health signals from live telemetry.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">refresh {POLL_MS / 1000}s</Badge>
          <span>last updated {new Date(snapshotAt).toLocaleTimeString()}</span>
        </div>
      </div>

      {loading ? <p className="text-sm text-muted-foreground">Loading system stats...</p> : null}
      {error ? <p className="text-xs text-amber-500">{error}</p> : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              Host health
              <Badge variant={healthStatusVariant(hostHealth)}>
                {healthStatusLabel(hostHealth)}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Heartbeat</span>
              <Badge variant={heartbeatStatusVariant(heartbeatStatus)}>
                {heartbeatStatusLabel(heartbeatStatus)}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">Last heartbeat {lastHeartbeat}</p>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Postgres</span>
              <Badge variant={dbVariant(data.db?.postgres ?? null)}>
                {dbLabel(data.db?.postgres ?? null)}
              </Badge>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Vector DB</span>
              <Badge variant={dbVariant(data.db?.lancedb ?? null)}>
                {dbLabel(data.db?.lancedb ?? null)}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              Gateway health
              <Badge variant={healthStatusVariant(gatewayHealth)}>
                {healthStatusLabel(gatewayHealth)}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Processing</span>
              <Badge variant={data.thinking?.idle ? "secondary" : "success"}>
                {data.thinking?.idle ? "Idle" : "Active"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {data.thinking?.current ?? "Telemetry warming up..."}
            </p>
            <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
              <div>
                <p className="text-[10px] uppercase tracking-wide">Subagents</p>
                <p className="text-sm font-semibold text-foreground">
                  {formatInt(data.thinking?.metrics?.activeSubagents ?? 0)}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide">In progress</p>
                <p className="text-sm font-semibold text-foreground">
                  {formatInt(data.thinking?.metrics?.inProgressTasks ?? 0)}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide">Completed</p>
                <p className="text-sm font-semibold text-foreground">
                  {formatInt(data.thinking?.metrics?.completedRecently ?? 0)}
                </p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Updated {lastGatewayUpdate}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              Session health
              <Badge variant={healthStatusVariant(sessionHealth)}>
                {healthStatusLabel(sessionHealth)}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Active sessions</span>
              <span className="text-sm font-semibold text-foreground">
                {formatInt(sessionSummary.active)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                Updated &lt; {recentMinutes}m
              </span>
              <span className="text-sm font-semibold text-foreground">
                {formatInt(sessionSummary.recent)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                Stale &gt; {staleHours}h
              </span>
              <span className="text-sm font-semibold text-foreground">
                {formatInt(sessionSummary.stale)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Aborted</span>
              <span className="text-sm font-semibold text-foreground">
                {formatInt(sessionSummary.aborted)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Window last {SESSION_WINDOW_MINUTES} minutes · last update {lastSessionUpdate}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
