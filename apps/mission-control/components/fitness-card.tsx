"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatPercent, formatDuration } from "@/lib/format-utils";

type TrendPoint = { date: string; value: number | null };

type FitnessAlert = {
  id: string;
  severity: "critical" | "warning" | "info";
  label: string;
  message: string;
  timestamp: string;
};

type WorkoutSummary = {
  id: string;
  sport: string;
  start: string | null;
  strain: number | null;
  durationSeconds: number | null;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  kilojoules: number | null;
};

type FitnessSummary = {
  recovery: {
    score: number | null;
    status: "green" | "yellow" | "red" | "unknown";
    hrv: number | null;
    restingHeartRate: number | null;
    spo2: number | null;
    recordedAt: string | null;
  };
  sleep: {
    durationSeconds: number | null;
    efficiency: number | null;
    performance: number | null;
    consistency: number | null;
    sleepDebtSeconds: number | null;
    stage: {
      remSeconds: number | null;
      swsSeconds: number | null;
      lightSeconds: number | null;
    };
    recordedAt: string | null;
  };
  workouts: WorkoutSummary[];
  trends: {
    recovery: TrendPoint[];
    sleepPerformance: TrendPoint[];
  };
  alerts: FitnessAlert[];
  alertHistory: FitnessAlert[];
};

type FitnessResponse =
  | {
      status: "ok";
      generatedAt: string;
      cached: boolean;
      data: FitnessSummary;
    }
  | {
      status: "error";
      generatedAt: string;
      cached: boolean;
      error: { message: string; detail?: string };
    };

const POLL_MS = 5 * 60 * 1000;
const EMPTY_ALERTS: FitnessAlert[] = [];

const recoveryTone: Record<
  FitnessSummary["recovery"]["status"],
  { label: string; dotClass: string; textClass: string; badgeVariant: "success" | "warning" | "destructive" | "outline" }
> = {
  green: {
    label: "Green",
    dotClass: "bg-emerald-400",
    textClass: "text-emerald-300",
    badgeVariant: "success",
  },
  yellow: {
    label: "Yellow",
    dotClass: "bg-amber-400",
    textClass: "text-amber-300",
    badgeVariant: "warning",
  },
  red: {
    label: "Red",
    dotClass: "bg-red-400",
    textClass: "text-red-300",
    badgeVariant: "destructive",
  },
  unknown: {
    label: "Unknown",
    dotClass: "bg-muted-foreground/60",
    textClass: "text-muted-foreground",
    badgeVariant: "outline",
  },
};

const severityVariant = (severity: FitnessAlert["severity"]) => {
  if (severity === "critical") return "destructive";
  if (severity === "warning") return "warning";
  return "info";
};

const isSameDay = (value: string, now: Date) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
};

export function FitnessCard({ className }: { className?: string } = {}) {
  const [data, setData] = useState<FitnessSummary | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    const load = async (initial: boolean) => {
      if (initial) setLoading(true);

      try {
        const response = await fetch("/api/mjolnir", { cache: "no-store" });
        if (!response.ok) throw new Error(`Request failed (${response.status})`);
        const payload = (await response.json()) as FitnessResponse;
        if (!alive) return;
        if (payload.status !== "ok") {
          throw new Error(payload.error.message || "Mjolnir summary unavailable");
        }
        setData(payload.data);
        setGeneratedAt(payload.generatedAt);
        setError(null);
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "Mjolnir summary unavailable.");
      } finally {
        if (!alive) return;
        if (initial) setLoading(false);
      }
    };

    load(true);
    const interval = window.setInterval(() => load(false), POLL_MS);

    return () => {
      alive = false;
      window.clearInterval(interval);
    };
  }, []);

  const recovery = data?.recovery;
  const sleep = data?.sleep;
  const hasData = Boolean(data);

  const todayWorkoutCount = useMemo(() => {
    if (!data?.workouts?.length) return 0;
    const now = new Date();
    return data.workouts.filter((workout) => workout.start && isSameDay(workout.start, now))
      .length;
  }, [data]);

  const alerts = data?.alerts ?? EMPTY_ALERTS;
  const activeAlerts = alerts.length;

  const topSeverity = useMemo(() => {
    if (!alerts.length) return null;
    if (alerts.some((alert) => alert.severity === "critical")) return "critical" as const;
    if (alerts.some((alert) => alert.severity === "warning")) return "warning" as const;
    return "info" as const;
  }, [alerts]);

  const recoveryStatus = recovery?.status ?? "unknown";
  const recoveryUi = recoveryTone[recoveryStatus];

  return (
    <Card className={className}>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Mjolnir snapshot</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline">refresh 5m</Badge>
            <Badge asChild variant="outline">
              <Link href="/mjolnir">Details</Link>
            </Badge>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {generatedAt ? `Updated ${new Date(generatedAt).toLocaleTimeString()}` : "Latest Whoop signal"}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <p className="text-xs text-amber-400">{error} Retrying…</p> : null}
        {loading && !data ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={`fitness-loading-${index}`}
                className="rounded-lg border border-border/60 bg-card/50 p-3"
              >
                <div className="h-3 w-24 animate-pulse rounded bg-muted" />
                <div className="mt-3 h-7 w-20 animate-pulse rounded bg-muted" />
                <div className="mt-2 h-3 w-16 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-4">
            <div className="flex flex-col rounded-lg border border-border/60 bg-card/50 p-3">
              <p className="min-h-[1.5rem] text-xs uppercase tracking-wide text-muted-foreground">Recovery score</p>
              <p className="font-mono text-2xl font-semibold text-foreground">
                {hasData ? recovery?.score ?? "—" : "—"}
              </p>
              <div className="mt-1 flex items-center gap-2">
                <Badge variant={recoveryUi.badgeVariant} className="capitalize text-[10px]">
                  <span className={cn("h-1.5 w-1.5 rounded-full", recoveryUi.dotClass)} />
                  {recoveryUi.label}
                </Badge>
                <p className={cn("text-[11px]", recoveryUi.textClass)}>
                  {hasData && recovery?.recordedAt
                    ? `Recorded ${new Date(recovery.recordedAt).toLocaleTimeString()}`
                    : ""}
                </p>
              </div>
            </div>

            <div className="flex flex-col rounded-lg border border-border/60 bg-card/50 p-3">
              <p className="min-h-[1.5rem] text-xs uppercase tracking-wide text-muted-foreground">Sleep</p>
              <p className="font-mono text-2xl font-semibold text-foreground">
                {hasData ? formatDuration(sleep?.durationSeconds ?? null) : "—"}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Performance {hasData ? formatPercent(sleep?.performance ?? null) : "—"}
              </p>
            </div>

            <div className="flex flex-col rounded-lg border border-border/60 bg-card/50 p-3">
              <p className="min-h-[1.5rem] text-xs uppercase tracking-wide text-muted-foreground">Workouts</p>
              <p className="font-mono text-2xl font-semibold text-foreground">
                {hasData ? (todayWorkoutCount > 0 ? todayWorkoutCount : "0") : "—"}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">Today</p>
            </div>

            <div className="flex flex-col rounded-lg border border-border/60 bg-card/50 p-3">
              <p className="min-h-[1.5rem] text-xs uppercase tracking-wide text-muted-foreground">Active alerts</p>
              <p className="font-mono text-2xl font-semibold text-foreground">
                {hasData ? activeAlerts : "—"}
              </p>
              <div className="mt-1">
                <Badge
                  variant={hasData ? (topSeverity ? severityVariant(topSeverity) : "success") : "outline"}
                  className="text-[10px]"
                >
                  {hasData ? (topSeverity ? topSeverity : "All clear") : "No data"}
                </Badge>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
