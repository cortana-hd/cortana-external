"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { CalendarDays, Palmtree, ShieldAlert, ShieldCheck, TimerReset } from "lucide-react";
import { AnimatedValue } from "@/components/mjolnir/animated-value";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { VacationOpsSnapshot } from "@/lib/vacation-ops";
import { cn } from "@/lib/utils";

type VacationOpsResponse =
  | { status: "ok"; data: VacationOpsSnapshot }
  | { status: "error"; message: string };

const POLL_MS = 60_000;

function badgeVariantForMode(mode: string) {
  if (mode === "active") return "success" as const;
  if (mode === "ready") return "info" as const;
  if (mode === "failed" || mode === "expired") return "destructive" as const;
  if (mode === "completed") return "secondary" as const;
  return "outline" as const;
}

function formatModeLabel(mode: string | null | undefined) {
  if (mode === "active") return "Active";
  if (mode === "ready") return "Prepared";
  if (mode === "prep") return "Planning";
  return "Inactive";
}

function badgeVariantForReadiness(outcome: string | null | undefined) {
  if (outcome === "pass") return "success" as const;
  if (outcome === "warn") return "warning" as const;
  if (outcome === "no_go" || outcome === "fail") return "destructive" as const;
  return "outline" as const;
}

function formatWhen(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatClock(value: string) {
  const [hourText, minuteText] = value.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function formatWindowLabel(label: string | null | undefined) {
  if (!label) return "—";
  const match = label.match(/(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return label;
  return `${match[2]}-${match[3]}-${match[1]}`;
}

function formatRelative(value: string | null | undefined) {
  if (!value) return "never";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  const ageMs = Math.max(0, Date.now() - parsed.getTime());
  const mins = Math.floor(ageMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem === 0 ? `${hours}h ago` : `${hours}h ${rem}m ago`;
}

function formatCountdown(value: string | null | undefined, now = Date.now()) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  const remainingMs = parsed.getTime() - now;
  if (remainingMs <= 0) return "Ended";

  const totalMinutes = Math.floor(remainingMs / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function VacationOpsCard({ className }: { className?: string } = {}) {
  const [data, setData] = useState<VacationOpsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/vacation-ops", { cache: "no-store" });
      const payload = (await response.json()) as VacationOpsResponse;
      if (!response.ok || payload.status !== "ok") {
        throw new Error(payload.status === "error" ? payload.message : "Vacation Ops unavailable");
      }
      setData(payload.data);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Vacation Ops unavailable");
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(interval);
  }, [load]);

  useEffect(() => {
    const interval = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const accentClass = useMemo(() => {
    if (!data) return "border-sky-500/25";
    if (data.mode === "active") return "border-emerald-500/35";
    if (data.latestReadiness?.readinessOutcome === "warn") return "border-amber-500/35";
    if (data.latestReadiness?.readinessOutcome === "fail" || data.latestReadiness?.readinessOutcome === "no_go") return "border-red-500/35";
    return "border-sky-500/25";
  }, [data]);

  const stagedWindow = useMemo(() => {
    if (!data) return null;
    if (data.activeWindow) return data.activeWindow;
    if (data.latestWindow && ["ready", "prep"].includes(data.latestWindow.status)) return data.latestWindow;
    return null;
  }, [data]);

  const countdownValue = useMemo(
    () => formatCountdown(stagedWindow?.endAt ?? data?.latestWindow?.endAt ?? null, nowTick),
    [data?.latestWindow?.endAt, nowTick, stagedWindow?.endAt],
  );
  const countdownEndsAt = stagedWindow?.endAt ?? data?.latestWindow?.endAt ?? null;

  return (
    <Card className={cn("overflow-hidden border-l-4 bg-[linear-gradient(135deg,rgba(15,23,42,0.02),transparent_45%,rgba(14,165,233,0.05))]", accentClass, className)}>
      <CardHeader className="gap-2 pb-2 pt-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Palmtree className="h-4 w-4" />
            <span className="text-[10px] font-medium uppercase tracking-[0.22em]">Vacation Ops</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base">Away-mode readiness</CardTitle>
            <Badge variant={badgeVariantForMode(data?.mode ?? "inactive")}>{formatModeLabel(data?.mode)}</Badge>
            <Badge variant={badgeVariantForReadiness(data?.latestReadiness?.readinessOutcome)} className="uppercase">
              {data?.latestReadiness?.readinessOutcome === "no_go" ? "NO-GO" : data?.latestReadiness?.readinessOutcome?.replace("_", "-") ?? "n/a"}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <p>{data ? `Latest readiness ${formatRelative(data.latestReadiness?.completedAt ?? data.latestReadiness?.startedAt)}` : "Loading readiness state…"}</p>
            {data?.mode === "active" ? (
              <div className="inline-flex flex-wrap items-center gap-2 rounded-full border border-emerald-200/70 bg-emerald-50/80 px-3 py-1.5 text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] dark:border-emerald-900/40 dark:bg-emerald-950/40">
                <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">Time remaining</span>
                <span className="text-sm font-semibold tracking-tight tabular-nums">{countdownValue}</span>
                <span className="text-xs text-muted-foreground">Ends {formatWhen(countdownEndsAt)}</span>
              </div>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <MetricTile icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Open incidents" value={data?.counts.activeIncidents ?? null} tone={(data?.counts.activeIncidents ?? 0) > 0 ? "warning" : "success"} />
          <MetricTile icon={<ShieldAlert className="h-3.5 w-3.5" />} label="Needs operator" value={data?.counts.humanRequiredIncidents ?? null} tone={(data?.counts.humanRequiredIncidents ?? 0) > 0 ? "danger" : "neutral"} />
          <MetricTile icon={<TimerReset className="h-3.5 w-3.5" />} label="Paused jobs" value={data?.counts.pausedJobs ?? null} tone={(data?.counts.pausedJobs ?? 0) > 0 ? "info" : "neutral"} />
          <MetricTile
            icon={<CalendarDays className="h-3.5 w-3.5" />}
            label={data?.mode === "active" ? "Next summary" : "Cadence"}
            valueText={data?.mode === "active" ? formatWhen(data?.nextSummaryAt) : `${data ? formatClock(data.config.summaryTimes.morning) : "8:00 AM"} · ${data ? formatClock(data.config.summaryTimes.evening) : "8:00 PM"}`}
            tone="neutral"
          />
        </div>

        <div className="grid gap-3 xl:grid-cols-[1.3fr_1fr]">
          <div className="rounded-xl border border-border/50 bg-background/70 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Window</p>
              <p className="text-[11px] text-muted-foreground">Timezone: {data?.config.timezone ?? "—"}</p>
            </div>
            <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">{stagedWindow ? (data?.mode === "active" ? "Active window" : "Prepared window") : "Last window"}</p>
                <p className="font-medium">{stagedWindow ? formatWindowLabel(stagedWindow.label) : data?.latestWindow ? formatWindowLabel(data.latestWindow.label) : "No window staged"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{stagedWindow ? "Scheduled range" : "Last range"}</p>
                <p className="font-medium">{stagedWindow ? `${formatWhen(stagedWindow.startAt)} → ${formatWhen(stagedWindow.endAt)}` : data?.latestWindow ? `${formatWhen(data.latestWindow.startAt)} → ${formatWhen(data.latestWindow.endAt)}` : "Use preflight to stage one"}</p>
              </div>
            </div>
          </div>

          <div className="flex items-end justify-between gap-3 rounded-xl border border-border/50 bg-background/70 p-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Schedule</p>
              <p className="mt-1 text-sm font-medium">{data ? `${formatClock(data.config.summaryTimes.morning)} · ${formatClock(data.config.summaryTimes.evening)}` : "8:00 AM · 8:00 PM"}</p>
              <p className="mt-1 text-xs text-muted-foreground">Operator console lives in Services.</p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/services?tab=vacation">Open Console</Link>
            </Button>
          </div>
        </div>

        {error ? <p className="text-xs text-amber-500">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

function MetricTile({
  icon,
  label,
  value,
  valueText,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value?: number | null;
  valueText?: string;
  tone: "success" | "warning" | "danger" | "info" | "neutral";
}) {
  const toneClass = {
    success: "border-emerald-500/30 bg-emerald-500/8",
    warning: "border-amber-500/30 bg-amber-500/10",
    danger: "border-red-500/30 bg-red-500/10",
    info: "border-sky-500/30 bg-sky-500/10",
    neutral: "border-border/50 bg-background/70",
  }[tone];

  return (
    <div className={cn("rounded-xl border p-3", toneClass)}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-2 text-lg font-semibold tabular-nums">
        {typeof value === "number" ? <AnimatedValue value={value} className="text-lg font-semibold" /> : valueText ?? "—"}
      </div>
    </div>
  );
}
