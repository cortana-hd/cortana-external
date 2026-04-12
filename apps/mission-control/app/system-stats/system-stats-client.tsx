"use client";

import Link from "next/link";
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
import type { VacationOpsSnapshot } from "@/lib/vacation-ops";

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
  vacation: VacationOpsSnapshot | null;
};

const POLL_MS = 30_000;
const CACHE_MAX_AGE_MS = 5 * 60_000; // 5 minutes
const SESSION_WINDOW_MINUTES = 120;

/* ── module-level cache so data survives tab switches ── */
let cachedData: SystemStatsData | null = null;
let cachedAt = 0;

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

export default function SystemStatsClient({ hideHeader = false }: { hideHeader?: boolean } = {}) {
  const [data, setData] = useState<SystemStatsData>(() =>
    cachedData ?? { heartbeat: null, thinking: null, db: null, sessions: null, vacation: null },
  );
  const [loading, setLoading] = useState(!cachedData);
  const [error, setError] = useState<string | null>(null);
  const [snapshotAt, setSnapshotAt] = useState<number>(() => cachedData ? cachedAt : Date.now());

  const fetchStats = useCallback(async () => {
    const errors: string[] = [];

    /* Fast lane: heartbeat, thinking, db — render as soon as these land */
    const fastDone = Promise.allSettled([
      fetchJson<HeartbeatPayload>("/api/heartbeat-status"),
      fetchJson<ThinkingPayload>("/api/thinking-status"),
      fetchJson<DbStatusPayload>("/api/db-status"),
      fetchJson<{ status: "ok"; data: VacationOpsSnapshot }>("/api/vacation-ops"),
    ]).then(([heartbeatResult, thinkingResult, dbResult, vacationResult]) => {
      setData((prev) => {
        const next = { ...prev };
        if (heartbeatResult.status === "fulfilled") next.heartbeat = heartbeatResult.value;
        else errors.push("heartbeat");
        if (thinkingResult.status === "fulfilled") next.thinking = thinkingResult.value;
        else errors.push("gateway");
        if (dbResult.status === "fulfilled") next.db = dbResult.value;
        else errors.push("db");
        if (vacationResult.status === "fulfilled") next.vacation = vacationResult.value.data;
        else errors.push("vacation");
        cachedData = next;
        cachedAt = Date.now();
        return next;
      });
      setSnapshotAt(Date.now());
      setLoading(false);
    });

    /* Slow lane: sessions — arrives independently without blocking the UI */
    const slowDone = fetchJson<SessionsPayload>(`/api/sessions?minutes=${SESSION_WINDOW_MINUTES}`)
      .then((sessions) => {
        setData((prev) => {
          const next = { ...prev, sessions };
          cachedData = next;
          cachedAt = Date.now();
          return next;
        });
        setSnapshotAt(Date.now());
      })
      .catch(() => { errors.push("sessions"); });

    await Promise.allSettled([fastDone, slowDone]);
    setError(errors.length > 0 ? `Partial data: ${errors.join(", ")}` : null);
  }, []);

  useEffect(() => {
    const cacheAge = Date.now() - cachedAt;
    const skipInitial = cachedData != null && cacheAge < CACHE_MAX_AGE_MS;
    const timeout = skipInitial ? undefined : window.setTimeout(fetchStats, 0);
    const interval = window.setInterval(fetchStats, POLL_MS);
    return () => {
      if (timeout != null) window.clearTimeout(timeout);
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
  const lastVacationRunAt =
    data.vacation?.latestReadiness?.completedAt ?? data.vacation?.latestReadiness?.startedAt ?? null;
  const vacationCountdown = data.vacation?.mode === "active"
    ? formatVacationCountdown(data.vacation.activeWindow?.endAt ?? data.vacation.latestWindow?.endAt ?? null)
    : formatVacationCadence(data.vacation?.config.summaryTimes);

  const recentMinutes = Math.round(SESSION_RECENT_MS / 60_000);
  const staleHours = Math.round(SESSION_STALE_MS / 60_000 / 60);

  return (
    <div className={hideHeader ? "space-y-4" : "space-y-6"}>
      {!hideHeader && (
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
      )}

      {error ? <p className="text-xs text-amber-500">{error}</p> : null}

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 animate-pulse">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="h-4 w-28 rounded bg-muted/60" />
                  <div className="h-5 w-16 rounded-full bg-muted/50" />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="h-3 w-full rounded bg-muted/40" />
                <div className="h-3 w-3/4 rounded bg-muted/40" />
                <div className="h-3 w-1/2 rounded bg-muted/40" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between gap-2 text-base">
              <span>Vacation Ops</span>
              <div className="flex items-center gap-2">
                <Badge variant={vacationModeVariant(data.vacation?.mode)}>
                  {vacationModeLabel(data.vacation?.mode)}
                </Badge>
                <Badge variant={vacationReadinessVariant(data.vacation?.latestReadiness?.readinessOutcome)}>
                  {vacationReadinessLabel(data.vacation?.latestReadiness?.readinessOutcome)}
                </Badge>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Open incidents</span>
              <span className="text-sm font-semibold text-foreground">
                {formatInt(data.vacation?.counts.activeIncidents ?? 0)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Paused jobs</span>
              <span className="text-sm font-semibold text-foreground">
                {formatInt(data.vacation?.counts.pausedJobs ?? 0)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Window</span>
              <span className="text-right text-sm font-semibold text-foreground">
                {formatVacationWindowLabel(data.vacation)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                {data.vacation?.mode === "active" ? "Time remaining" : "Cadence"}
              </span>
              <span className="text-right text-sm font-semibold text-foreground">
                {vacationCountdown}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 pt-1">
              <p className="text-xs text-muted-foreground">
                Latest readiness {formatAgeFromIso(lastVacationRunAt)}
              </p>
              <Link href="/services?tab=vacation" className="text-xs font-medium text-primary hover:underline">
                Open console
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
      )}
    </div>
  );
}

function vacationModeLabel(mode: string | null | undefined) {
  if (mode === "active") return "Active";
  if (mode === "ready") return "Prepared";
  if (mode === "prep") return "Planning";
  return "Inactive";
}

function vacationModeVariant(mode: string | null | undefined): HealthBadgeVariant {
  if (mode === "active") return "success";
  if (mode === "ready") return "secondary";
  if (mode === "prep") return "secondary";
  return "outline";
}

function vacationReadinessLabel(outcome: string | null | undefined) {
  if (!outcome) return "N/A";
  if (outcome === "no_go") return "NO-GO";
  return outcome.toUpperCase().replaceAll("_", "-");
}

function vacationReadinessVariant(outcome: string | null | undefined): HealthBadgeVariant {
  if (outcome === "pass") return "success";
  if (outcome === "warn") return "warning";
  if (outcome === "fail" || outcome === "no_go") return "destructive";
  return "outline";
}

function formatVacationSummaryTime(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatVacationCountdown(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  const remainingMs = parsed.getTime() - Date.now();
  if (remainingMs <= 0) return "Ended";

  const totalMinutes = Math.floor(remainingMs / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatVacationCadence(summaryTimes?: { morning: string; evening: string }) {
  if (!summaryTimes) return "8:00 AM · 8:00 PM";
  return `${formatVacationClock(summaryTimes.morning)} · ${formatVacationClock(summaryTimes.evening)}`;
}

function formatVacationClock(value: string) {
  const [hourText, minuteText] = value.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function formatVacationWindowLabel(snapshot: VacationOpsSnapshot | null) {
  const window = snapshot?.activeWindow ?? snapshot?.latestWindow ?? null;
  if (!window?.label) return "None";
  const match = window.label.match(/(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return window.label;
  return `${match[2]}/${match[3]}/${match[1]}`;
}

function formatAgeFromIso(value: string | null | undefined) {
  if (!value) return "never";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return formatAge(Math.max(0, Date.now() - parsed.getTime()));
}
