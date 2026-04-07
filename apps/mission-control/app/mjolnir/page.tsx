import { Activity, BedDouble, Dumbbell, Heart, Moon, Scale, Timer, TrendingUp, Weight, Zap } from "lucide-react";
import { AutoRefresh } from "@/components/auto-refresh";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatPercent, formatNumber, formatDecimal, formatDuration, formatTimestamp } from "@/lib/format-utils";

export const dynamic = "force-dynamic";

/* ── types ── */

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

export const getWorkoutRenderKey = (
  workout: Pick<WorkoutSummary, "id" | "start">,
  index: number,
) => `${workout.id}-${workout.start ?? "na"}-${index}`;

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
  body: {
    heightM: number | null;
    weightKg: number | null;
    maxHeartRate: number | null;
  };
  tonal: {
    available: boolean;
    workoutCount: number;
    lastUpdated: string | null;
    strengthScores: Array<{ label: string; value: number }>;
    recentWorkouts: Array<{
      id: string;
      startTime: string | null;
      duration: number | null;
      movementCount: number;
      totalVolume: number;
      topMovements: Array<{ name: string; reps: number; weight: number }>;
    }>;
  };
};

type FitnessResponse =
  | { status: "ok"; generatedAt: string; cached: boolean; data: FitnessSummary }
  | { status: "error"; generatedAt: string; cached: boolean; error: { message: string; detail?: string } };

/* ── formatters ── */

const formatShortDate = (value: string) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const severityVariant = (severity: FitnessAlert["severity"]) => {
  if (severity === "critical") return "destructive" as const;
  if (severity === "warning") return "warning" as const;
  return "info" as const;
};

const recoveryStatusColor = (status: string) => {
  if (status === "green") return "text-emerald-600 dark:text-emerald-400";
  if (status === "yellow") return "text-amber-500 dark:text-amber-400";
  if (status === "red") return "text-red-500 dark:text-red-400";
  return "text-muted-foreground";
};

const recoveryBadgeVariant = (status: string) => {
  if (status === "green") return "success" as const;
  if (status === "yellow") return "warning" as const;
  if (status === "red") return "destructive" as const;
  return "outline" as const;
};

/* ── data fetch ── */

async function getFitnessData(): Promise<FitnessResponse> {
  const baseUrl = `http://localhost:${process.env.PORT || "3000"}`;
  const response = await fetch(`${baseUrl}/api/mjolnir`, { method: "GET", cache: "no-store" });
  if (!response.ok) {
    return { status: "error", generatedAt: new Date().toISOString(), cached: false, error: { message: `Request failed (${response.status})` } };
  }
  return (await response.json()) as FitnessResponse;
}

/* ── page ── */

export default async function FitnessPage() {
  const response = await getFitnessData();

  if (response.status !== "ok") {
    return (
      <div className="space-y-6">
        <AutoRefresh />
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader>
            <CardTitle className="text-lg">Mjolnir data unavailable</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>{response.error.message}</p>
            <p>
              Ensure the Whoop service is running at{" "}
              <code className="font-mono">http://localhost:3033</code> and that OAuth is authorized.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { data } = response;

  return (
    <div className="space-y-6">
      <AutoRefresh />

      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">Mjolnir</p>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Health & Recovery</h1>
          <p className="text-sm text-muted-foreground">Daily recovery, sleep, and workout signals from Whoop.</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant={response.cached ? "outline" : "success"} className="text-[10px]">
            {response.cached ? "cached" : "live"}
          </Badge>
          <span>{formatTimestamp(response.generatedAt)}</span>
        </div>
      </div>

      {/* ── Active Alerts ── */}
      {data.alerts.length > 0 && (
        <div className="flex flex-wrap gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-950/20">
          {data.alerts.map((alert) => (
            <Badge key={alert.id} variant={severityVariant(alert.severity)}>
              {alert.label}: {alert.message}
            </Badge>
          ))}
        </div>
      )}

      {/* ── Hero: Recovery Ring + Sleep Overview ── */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Recovery Ring Card */}
        <Card className="gap-3 py-4">
          <CardHeader className="gap-1 px-5">
            <div className="flex items-center gap-2">
              <Heart className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <CardTitle className="text-sm font-semibold uppercase tracking-wide">Recovery</CardTitle>
            </div>
            <p className="text-[11px] text-muted-foreground">{formatTimestamp(data.recovery.recordedAt)}</p>
          </CardHeader>
          <CardContent className="px-5">
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-6">
              {/* Ring */}
              <RecoveryRing score={data.recovery.score} status={data.recovery.status} />

              {/* Satellite metrics */}
              <div className="grid flex-1 grid-cols-3 gap-3 sm:grid-cols-1 sm:gap-2">
                <HealthMetric icon={<Activity className="h-3.5 w-3.5" />} label="HRV" value={formatDecimal(data.recovery.hrv, " ms")} />
                <HealthMetric icon={<Heart className="h-3.5 w-3.5" />} label="RHR" value={formatNumber(data.recovery.restingHeartRate, " bpm")} />
                <HealthMetric icon={<Zap className="h-3.5 w-3.5" />} label="SpO₂" value={formatPercent(data.recovery.spo2)} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Sleep Card */}
        <Card className="gap-3 py-4">
          <CardHeader className="gap-1 px-5">
            <div className="flex items-center gap-2">
              <Moon className="h-4 w-4 text-violet-500 dark:text-violet-400" />
              <CardTitle className="text-sm font-semibold uppercase tracking-wide">Sleep</CardTitle>
            </div>
            <p className="text-[11px] text-muted-foreground">Last night: {formatTimestamp(data.sleep.recordedAt)}</p>
          </CardHeader>
          <CardContent className="space-y-4 px-5">
            {/* Key metrics */}
            <div className="grid grid-cols-2 gap-3">
              <HealthMetric icon={<BedDouble className="h-3.5 w-3.5" />} label="Duration" value={formatDuration(data.sleep.durationSeconds)} />
              <HealthMetric icon={<TrendingUp className="h-3.5 w-3.5" />} label="Performance" value={formatPercent(data.sleep.performance)} />
              <HealthMetric icon={<Zap className="h-3.5 w-3.5" />} label="Efficiency" value={formatPercent(data.sleep.efficiency)} />
              <HealthMetric icon={<Timer className="h-3.5 w-3.5" />} label="Consistency" value={formatPercent(data.sleep.consistency)} />
            </div>

            {/* Sleep stages bar */}
            <SleepStagesBar
              rem={data.sleep.stage.remSeconds}
              deep={data.sleep.stage.swsSeconds}
              light={data.sleep.stage.lightSeconds}
            />

            {/* Sleep debt */}
            <div className="flex items-center justify-between rounded-lg border border-dashed border-muted-foreground/20 bg-muted/10 px-3 py-2">
              <span className="health-metric-label">Sleep debt</span>
              <span className="font-mono text-sm font-semibold">{formatDuration(data.sleep.sleepDebtSeconds)}</span>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ── Workouts ── */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <Dumbbell className="h-4 w-4 text-orange-500 dark:text-orange-400" />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Today&apos;s Workouts</h2>
          <Badge variant="outline" className="text-[10px]">{data.workouts.length}</Badge>
        </div>
        {data.workouts.length === 0 ? (
          <Card className="gap-0 py-4">
            <CardContent className="px-5">
              <p className="text-sm text-muted-foreground">No workouts logged yet today.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data.workouts.map((workout, index) => (
              <WorkoutCard key={getWorkoutRenderKey(workout, index)} workout={workout} />
            ))}
          </div>
        )}
      </section>

      {/* ── Body Metrics + Tonal Strength ── */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Body Metrics */}
        <Card className="gap-3 py-4">
          <CardHeader className="gap-1 px-5">
            <div className="flex items-center gap-2">
              <Scale className="h-4 w-4 text-blue-500 dark:text-blue-400" />
              <CardTitle className="text-sm font-semibold uppercase tracking-wide">Body Metrics</CardTitle>
            </div>
            <p className="text-[11px] text-muted-foreground">From Whoop body measurement</p>
          </CardHeader>
          <CardContent className="px-5">
            <div className="grid grid-cols-3 gap-3">
              <HealthMetric
                icon={<Scale className="h-3.5 w-3.5" />}
                label="Weight"
                value={data.body?.weightKg != null ? `${Math.round(data.body.weightKg * 2.205)} lbs` : "—"}
              />
              <HealthMetric
                icon={<TrendingUp className="h-3.5 w-3.5" />}
                label="Height"
                value={data.body?.heightM != null ? `${Math.round(data.body.heightM * 39.37)}"` : "—"}
              />
              <HealthMetric
                icon={<Heart className="h-3.5 w-3.5" />}
                label="Max HR"
                value={formatNumber(data.body?.maxHeartRate ?? null, " bpm")}
              />
            </div>
          </CardContent>
        </Card>

        {/* Tonal Strength */}
        <Card className="gap-3 py-4">
          <CardHeader className="gap-1 px-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Weight className="h-4 w-4 text-purple-500 dark:text-purple-400" />
                <CardTitle className="text-sm font-semibold uppercase tracking-wide">Tonal Strength</CardTitle>
              </div>
              {data.tonal?.available ? (
                <Badge variant="success" className="text-[10px]">connected</Badge>
              ) : (
                <Badge variant="outline" className="text-[10px]">not connected</Badge>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {data.tonal?.available
                ? `${data.tonal.workoutCount} workouts tracked${data.tonal.lastUpdated ? ` · updated ${formatShortDate(data.tonal.lastUpdated)}` : ""}`
                : "Connect Tonal in Services → Configuration"}
            </p>
          </CardHeader>
          <CardContent className="px-5">
            {data.tonal?.available && data.tonal.strengthScores.length > 0 ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {data.tonal.strengthScores.map((s) => (
                    <div key={s.label} className="rounded-lg border border-purple-200/50 bg-purple-50/30 px-3 py-2 dark:border-purple-900/30 dark:bg-purple-950/20">
                      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{s.label}</p>
                      <p className="font-mono text-lg font-bold text-purple-600 dark:text-purple-400">{s.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : data.tonal?.available ? (
              <p className="py-2 text-xs text-muted-foreground">No strength score data available yet.</p>
            ) : (
              <p className="py-2 text-xs text-muted-foreground">Configure Tonal credentials to see strength metrics.</p>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ── Tonal Recent Workouts ── */}
      {data.tonal?.available && data.tonal.recentWorkouts.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <Weight className="h-4 w-4 text-purple-500 dark:text-purple-400" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Recent Tonal Workouts</h2>
            <Badge variant="outline" className="text-[10px]">{data.tonal.recentWorkouts.length}</Badge>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data.tonal.recentWorkouts.map((w) => (
              <Card key={w.id} className="gap-2 py-3">
                <CardHeader className="gap-0 px-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Weight className="h-4 w-4 text-purple-500 dark:text-purple-400" />
                      <CardTitle className="text-sm">{w.movementCount} movements</CardTitle>
                    </div>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {w.totalVolume > 0 ? `${w.totalVolume.toLocaleString()} lbs` : "—"}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {w.startTime ? formatTimestamp(w.startTime) : "Unknown date"}
                    {w.duration ? ` · ${formatDuration(w.duration)}` : ""}
                  </p>
                </CardHeader>
                <CardContent className="px-4">
                  {w.topMovements.length > 0 ? (
                    <div className="space-y-1">
                      {w.topMovements.map((m, i) => (
                        <div key={`${m.name}-${i}`} className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">{m.name}</span>
                          <span className="font-mono font-medium">{m.reps}×{Math.round(m.weight)} lbs</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No movement details</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* ── Trends + Alert History ── */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Trends */}
        <Card className="gap-3 py-4">
          <CardHeader className="gap-1 px-5">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm font-semibold uppercase tracking-wide">14-Day Trends</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-5 px-5">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium">Recovery</p>
                <div className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                  <span className="text-[10px] text-muted-foreground">Last 14 days</span>
                </div>
              </div>
              <TrendBars data={data.trends.recovery} tone="bg-emerald-500/80 dark:bg-emerald-400/70" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium">Sleep Performance</p>
                <div className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full bg-violet-500" />
                  <span className="text-[10px] text-muted-foreground">Last 14 days</span>
                </div>
              </div>
              <TrendBars data={data.trends.sleepPerformance} tone="bg-violet-500/80 dark:bg-violet-400/70" />
            </div>
          </CardContent>
        </Card>

        {/* Alert History */}
        <Card className="gap-3 py-4">
          <CardHeader className="gap-1 px-5">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm font-semibold uppercase tracking-wide">Alert History</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="px-5">
            {data.alertHistory.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Badge variant="success" className="text-[10px]">Clear</Badge>
                <span>No recent threshold breaches.</span>
              </div>
            ) : (
              <div className="space-y-0">
                {data.alertHistory.slice(0, 10).map((alert, i) => (
                  <div
                    key={alert.id}
                    className={cn(
                      "flex items-start gap-3 py-2.5",
                      i < data.alertHistory.slice(0, 10).length - 1 && "border-b border-border/40",
                    )}
                  >
                    {/* Timeline dot */}
                    <div className="mt-1.5 flex flex-col items-center">
                      <span className={cn(
                        "inline-block h-2 w-2 rounded-full",
                        alert.severity === "critical" ? "bg-red-500" : alert.severity === "warning" ? "bg-amber-500" : "bg-blue-500",
                      )} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-medium">{alert.label}</span>
                        <Badge variant={severityVariant(alert.severity)} className="text-[10px]">{alert.severity}</Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{alert.message}</p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">{formatShortDate(alert.timestamp)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

/* ── sub-components ── */

function RecoveryRing({ score, status }: { score: number | null; status: string }) {
  const pct = score != null ? Math.max(0, Math.min(100, score)) : 0;
  const r = 42;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (pct / 100) * circumference;
  const ringClass = `recovery-ring-${status}`;

  return (
    <div className="recovery-ring">
      <svg viewBox="0 0 100 100">
        <circle className="recovery-ring-track" cx="50" cy="50" r={r} />
        <circle
          className={`recovery-ring-fill ${ringClass}`}
          cx="50"
          cy="50"
          r={r}
          strokeDasharray={circumference}
          strokeDashoffset={score != null ? offset : circumference}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn("text-3xl font-bold", recoveryStatusColor(status))}>
          {score != null ? Math.round(score) : "—"}
        </span>
        <Badge variant={recoveryBadgeVariant(status)} className="mt-1 text-[10px]">
          {status}
        </Badge>
      </div>
    </div>
  );
}

function SleepStagesBar({ rem, deep, light }: { rem: number | null; deep: number | null; light: number | null }) {
  const total = (rem ?? 0) + (deep ?? 0) + (light ?? 0);
  if (total === 0) return <p className="text-xs text-muted-foreground">No sleep stage data.</p>;

  const remPct = ((rem ?? 0) / total) * 100;
  const deepPct = ((deep ?? 0) / total) * 100;
  const lightPct = ((light ?? 0) / total) * 100;

  return (
    <div className="space-y-2">
      {/* Stacked bar */}
      <div className="flex h-3 overflow-hidden rounded-full">
        <div className="sleep-bar-rem transition-all" style={{ width: `${remPct}%` }} title={`REM: ${formatDuration(rem)}`} />
        <div className="sleep-bar-deep transition-all" style={{ width: `${deepPct}%` }} title={`Deep: ${formatDuration(deep)}`} />
        <div className="sleep-bar-light transition-all" style={{ width: `${lightPct}%` }} title={`Light: ${formatDuration(light)}`} />
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs">
        <SleepLegendItem color="bg-violet-500 dark:bg-violet-400" label="REM" value={formatDuration(rem)} />
        <SleepLegendItem color="bg-blue-500 dark:bg-blue-400" label="Deep" value={formatDuration(deep)} />
        <SleepLegendItem color="bg-cyan-400 dark:bg-cyan-300" label="Light" value={formatDuration(light)} />
      </div>
    </div>
  );
}

function SleepLegendItem({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn("inline-block h-2 w-2 rounded-full", color)} />
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

function HealthMetric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border/40 bg-muted/10 px-3 py-2">
      <div className="text-muted-foreground">{icon}</div>
      <div className="min-w-0">
        <p className="health-metric-label">{label}</p>
        <p className="font-mono text-sm font-semibold leading-tight">{value}</p>
      </div>
    </div>
  );
}

function WorkoutCard({ workout }: { workout: WorkoutSummary }) {
  const strainPct = workout.strain != null ? Math.min(100, (workout.strain / 21) * 100) : 0;

  return (
    <Card className="gap-2 py-3">
      <CardHeader className="gap-0 px-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Dumbbell className="h-4 w-4 text-orange-500 dark:text-orange-400" />
            <CardTitle className="text-sm">{workout.sport}</CardTitle>
          </div>
          <Badge variant="outline" className="font-mono text-[10px]">
            {formatDecimal(workout.strain)} strain
          </Badge>
        </div>
        <p className="text-[11px] text-muted-foreground">{formatTimestamp(workout.start)}</p>
      </CardHeader>
      <CardContent className="space-y-2.5 px-4">
        {/* Strain bar */}
        <div className="h-1.5 w-full overflow-hidden rounded-full strain-bar-bg">
          <div className="h-full rounded-full strain-bar-fill transition-all" style={{ width: `${strainPct}%` }} />
        </div>
        {/* Stats */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <p className="health-metric-label">Duration</p>
            <p className="font-mono text-sm font-semibold">{formatDuration(workout.durationSeconds)}</p>
          </div>
          <div>
            <p className="health-metric-label">Energy</p>
            <p className="font-mono text-sm font-semibold">{formatNumber(workout.kilojoules, " kJ")}</p>
          </div>
          <div>
            <p className="health-metric-label">Avg HR</p>
            <p className="font-mono text-sm font-semibold">{formatNumber(workout.avgHeartRate, " bpm")}</p>
          </div>
          <div>
            <p className="health-metric-label">Max HR</p>
            <p className="font-mono text-sm font-semibold">{formatNumber(workout.maxHeartRate, " bpm")}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TrendBars({ data, tone }: { data: TrendPoint[]; tone: string }) {
  if (!data.length) return <p className="text-xs text-muted-foreground">No trend data yet.</p>;

  return (
    <div className="flex h-20 items-end gap-0.5">
      {data.map((point) => {
        const height = point.value == null ? 8 : Math.max(8, Math.min(100, Math.round(point.value)));
        const label = point.value == null ? "—" : `${Math.round(point.value)}%`;
        return (
          <div
            key={point.date}
            className="group relative flex h-full flex-1 items-end"
            title={`${point.date}: ${label}`}
          >
            <div className="absolute inset-0 rounded-sm bg-muted/20" />
            <div
              className={cn("relative w-full rounded-sm transition-all", tone)}
              style={{ height: `${height}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}
