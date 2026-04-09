"use client";

import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dumbbell, TrendingUp } from "lucide-react";

type TrendPoint = { date: string; value: number | null };

const formatShortDate = (value: string) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const COLOR_MODES = {
  recovery: (v: number) =>
    v >= 67 ? "#34d399" : v >= 34 ? "#fbbf24" : "#f87171",
} as const;

type ColorMode = keyof typeof COLOR_MODES;

function getBarColor(value: number | null, colorMode?: ColorMode, defaultColor?: string): string {
  if (value == null) return "var(--color-muted)";
  if (colorMode && COLOR_MODES[colorMode]) return COLOR_MODES[colorMode](value);
  return defaultColor ?? "#38bdf8"; // sky-400
}

type TrendChartProps = {
  data: TrendPoint[];
  label: string;
  currentValue: number | null;
  threshold?: number;
  defaultColor?: string;
  colorMode?: ColorMode;
};

export function TrendChartRecharts({
  data,
  label,
  currentValue,
  threshold,
  defaultColor,
  colorMode,
}: TrendChartProps) {
  if (!data.length) {
    return (
      <Card className="gap-3 py-4 transition-colors hover:border-border/60 cursor-pointer">
        <CardHeader className="px-5">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-semibold uppercase tracking-wide">{label}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="px-5">
          <p className="text-xs text-muted-foreground">No trend data yet.</p>
        </CardContent>
      </Card>
    );
  }

  const chartData = data.map((point) => ({
    date: point.date,
    shortDate: formatShortDate(point.date),
    value: point.value ?? 0,
    isNull: point.value == null,
    fill: getBarColor(point.value, colorMode, defaultColor),
  }));

  return (
    <Card className="gap-3 py-4 transition-colors hover:border-border/60 cursor-pointer">
      <CardHeader className="gap-1 px-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-semibold uppercase tracking-wide">{label}</CardTitle>
          </div>
          {currentValue != null && (
            <Badge variant="outline" className="font-mono text-[10px]">
              {Math.round(currentValue)}%
            </Badge>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground">Last 14 days</p>
      </CardHeader>
      <CardContent className="px-5">
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={chartData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" opacity={0.3} />
            <XAxis
              dataKey="shortDate"
              tick={{ fontSize: 9, fill: "var(--color-muted-foreground)" }}
              tickLine={false}
              axisLine={false}
              interval={2}
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fontSize: 9, fill: "var(--color-muted-foreground)" }}
              tickLine={false}
              axisLine={false}
              width={30}
            />
            {threshold != null && (
              <ReferenceLine
                y={threshold}
                stroke="var(--color-muted-foreground)"
                strokeDasharray="4 4"
                opacity={0.4}
                label={{
                  value: `${threshold}%`,
                  position: "right",
                  fontSize: 9,
                  fill: "var(--color-muted-foreground)",
                }}
              />
            )}
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--color-card)",
                border: "1px solid var(--color-border)",
                borderRadius: "8px",
                fontSize: "12px",
                padding: "6px 10px",
              }}
              formatter={(value) => [`${Math.round(Number(value))}%`, label]}
              labelFormatter={(l) => String(l)}
              cursor={{ fill: "var(--color-muted)", opacity: 0.2 }}
            />
            <Bar
              dataKey="value"
              radius={[4, 4, 0, 0]}
              animationDuration={1200}
              animationEasing="ease-out"
            />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

/* ── Combined Recovery + Sleep overlay line chart ── */

type CombinedTrendProps = {
  recovery: TrendPoint[];
  sleep: TrendPoint[];
};

export function RecoverySleepOverlay({ recovery, sleep }: CombinedTrendProps) {
  if (!recovery.length && !sleep.length) return null;

  // Merge both series by date
  const dateMap = new Map<string, { recovery: number | null; sleep: number | null }>();
  for (const p of recovery) {
    dateMap.set(p.date, { recovery: p.value, sleep: null });
  }
  for (const p of sleep) {
    const existing = dateMap.get(p.date);
    if (existing) existing.sleep = p.value;
    else dateMap.set(p.date, { recovery: null, sleep: p.value });
  }

  const chartData = [...dateMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, values]) => ({
      date,
      shortDate: formatShortDate(date),
      recovery: values.recovery,
      sleep: values.sleep,
    }));

  return (
    <Card className="gap-3 py-4 transition-colors hover:border-border/60 cursor-pointer">
      <CardHeader className="gap-1 px-5">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-sm font-semibold uppercase tracking-wide">Recovery vs Sleep</CardTitle>
        </div>
        <p className="text-[10px] text-muted-foreground">14-day overlay — see how sleep drives recovery</p>
      </CardHeader>
      <CardContent className="px-5">
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" opacity={0.3} />
            <XAxis
              dataKey="shortDate"
              tick={{ fontSize: 9, fill: "var(--color-muted-foreground)" }}
              tickLine={false}
              axisLine={false}
              interval={2}
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fontSize: 9, fill: "var(--color-muted-foreground)" }}
              tickLine={false}
              axisLine={false}
              width={30}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--color-card)",
                border: "1px solid var(--color-border)",
                borderRadius: "8px",
                fontSize: "12px",
                padding: "8px 12px",
              }}
              formatter={(value, name) => [
                `${Math.round(Number(value))}%`,
                name === "recovery" ? "Recovery" : "Sleep",
              ]}
              labelFormatter={(l) => String(l)}
            />
            <Legend
              verticalAlign="top"
              height={28}
              iconType="circle"
              iconSize={8}
              formatter={(value) => (
                <span style={{ fontSize: 11, color: "var(--color-muted-foreground)" }}>
                  {value === "recovery" ? "Recovery" : "Sleep"}
                </span>
              )}
            />
            <Area
              type="monotone"
              dataKey="recovery"
              stroke="#34d399"
              fill="#34d399"
              fillOpacity={0.08}
              strokeWidth={2}
              dot={{ r: 3, fill: "#34d399", strokeWidth: 0 }}
              activeDot={{ r: 5, stroke: "#34d399", strokeWidth: 2, fill: "var(--color-card)" }}
              animationDuration={1400}
              animationEasing="ease-out"
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="sleep"
              stroke="#a78bfa"
              strokeWidth={2}
              dot={{ r: 3, fill: "#a78bfa", strokeWidth: 0 }}
              activeDot={{ r: 5, stroke: "#a78bfa", strokeWidth: 2, fill: "var(--color-card)" }}
              animationDuration={1400}
              animationEasing="ease-out"
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

/* ── Tonal Volume Progression line chart ── */

type TonalWorkout = {
  id: string;
  startTime: string | null;
  duration: number | null;
  movementCount: number;
  totalVolume: number;
  topMovements: Array<{ name: string; reps: number; weight: number }>;
};

export function VolumeProgressionChart({ workouts }: { workouts: TonalWorkout[] }) {
  if (workouts.length === 0) return null;

  // Aggregate volume by date (multiple workouts on the same day get summed)
  const byDate = new Map<string, { volume: number; movements: number }>();
  for (const w of workouts) {
    if (!w.startTime) continue;
    const dateKey = w.startTime.slice(0, 10); // YYYY-MM-DD
    const existing = byDate.get(dateKey);
    if (existing) {
      existing.volume += w.totalVolume;
      existing.movements += w.movementCount;
    } else {
      byDate.set(dateKey, { volume: w.totalVolume, movements: w.movementCount });
    }
  }

  // Build last 5 calendar days, filling 0 for rest days
  const today = new Date();
  const chartData: Array<{ date: string; shortDate: string; volume: number; movements: number }> = [];
  for (let i = 4; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateKey = d.toISOString().slice(0, 10);
    const existing = byDate.get(dateKey);
    chartData.push({
      date: dateKey,
      shortDate: formatShortDate(dateKey),
      volume: existing?.volume ?? 0,
      movements: existing?.movements ?? 0,
    });
  }

  const hasAnyVolume = chartData.some((d) => d.volume > 0);
  if (!hasAnyVolume) return null;

  const useLinePath = chartData.length >= 4;

  return (
    <Card className="gap-3 py-4 transition-colors hover:border-border/60 cursor-pointer">
      <CardHeader className="gap-1 px-3 sm:px-5">
        <div className="flex items-center gap-2">
          <Dumbbell className="h-4 w-4 text-sky-500 dark:text-sky-400" />
          <CardTitle className="text-xs sm:text-sm font-semibold uppercase tracking-wide">Volume Progression</CardTitle>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Total volume per Tonal workout — trending up means progressive overload
        </p>
      </CardHeader>
      <CardContent className="px-2 sm:px-5">
        <ResponsiveContainer width="100%" height={160}>
          {useLinePath ? (
            <LineChart data={chartData} margin={{ top: 5, right: 25, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" opacity={0.3} />
              <XAxis
                dataKey="shortDate"
                tick={{ fontSize: 9, fill: "var(--color-muted-foreground)" }}
                tickLine={false}
                axisLine={false}
                interval={Math.max(0, Math.floor(chartData.length / 5) - 1)}
              />
              <YAxis
                tick={{ fontSize: 9, fill: "var(--color-muted-foreground)" }}
                tickLine={false}
                axisLine={false}
                width={45}
                tickFormatter={(v) => `${(Number(v) / 1000).toFixed(1)}k`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--color-card)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "8px",
                  fontSize: "12px",
                  padding: "8px 12px",
                }}
                formatter={(value) => [`${Number(value).toLocaleString()} lbs`, "Volume"]}
                labelFormatter={(l) => String(l)}
              />
              <Line
                type="monotone"
                dataKey="volume"
                stroke="#38bdf8"
                strokeWidth={2.5}
                dot={{ r: 4, fill: "#38bdf8", strokeWidth: 0 }}
                activeDot={{ r: 6, stroke: "#38bdf8", strokeWidth: 2, fill: "var(--color-card)" }}
                animationDuration={1400}
                animationEasing="ease-out"
              />
            </LineChart>
          ) : (
            <BarChart data={chartData} margin={{ top: 5, right: 25, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" opacity={0.3} />
              <XAxis
                dataKey="shortDate"
                tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 9, fill: "var(--color-muted-foreground)" }}
                tickLine={false}
                axisLine={false}
                width={45}
                tickFormatter={(v) => `${(Number(v) / 1000).toFixed(1)}k`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--color-card)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "8px",
                  fontSize: "12px",
                  padding: "8px 12px",
                }}
                formatter={(value) => [`${Number(value).toLocaleString()} lbs`, "Volume"]}
                labelFormatter={(l) => String(l)}
              />
              <Bar
                dataKey="volume"
                fill="#38bdf8"
                radius={[6, 6, 0, 0]}
                animationDuration={1200}
                animationEasing="ease-out"
                barSize={30}
              />
            </BarChart>
          )}
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
