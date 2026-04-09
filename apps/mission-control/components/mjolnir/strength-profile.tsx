"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AnimatedValue } from "./animated-value";

type StrengthScore = { label: string; value: number };

const BODY_REGIONS: Record<string, string[]> = {
  "Upper Body": ["UPPER", "CHEST", "SHOULDERS", "BACK", "BICEPS", "TRICEPS"],
  "Core": ["CORE", "ABS", "OBLIQUES"],
  "Lower Body": ["LOWER", "GLUTES", "HAMSTRINGS", "QUADS"],
};

const REGION_COLORS: Record<string, string> = {
  "Upper Body": "#38bdf8",
  "Core": "#818cf8",
  "Lower Body": "#34d399",
  "Other": "#94a3b8",
};

function getRegion(label: string): string {
  for (const [region, labels] of Object.entries(BODY_REGIONS)) {
    if (labels.includes(label.toUpperCase())) return region;
  }
  return "Other";
}

export function StrengthProfile({ scores }: { scores: StrengthScore[] }) {
  const overall = scores.find((s) => s.label.toUpperCase() === "OVERALL");
  const filtered = scores.filter((s) => s.label.toUpperCase() !== "OVERALL");

  const chartData = filtered.map((s) => ({
    name: s.label,
    value: s.value,
    region: getRegion(s.label),
    fill: REGION_COLORS[getRegion(s.label)] ?? REGION_COLORS.Other,
  }));

  return (
    <div className="space-y-4">
      {/* Overall score hero */}
      {overall && (
        <div className="flex items-center gap-3 rounded-lg border border-sky-200/40 bg-sky-50/30 px-4 py-3 dark:border-sky-800/30 dark:bg-sky-950/20">
          <div className="flex-1">
            <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Overall Strength</p>
            <AnimatedValue
              value={overall.value}
              className="text-3xl font-bold text-sky-600 dark:text-sky-400"
            />
          </div>
        </div>
      )}

      {/* Radar chart */}
      <ResponsiveContainer width="100%" height={280}>
        <RadarChart data={chartData} cx="50%" cy="50%" outerRadius="75%">
          <PolarGrid stroke="var(--color-border)" opacity={0.3} />
          <PolarAngleAxis
            dataKey="name"
            tick={{ fontSize: 10, fill: "var(--color-muted-foreground)", fontWeight: 500 }}
          />
          <PolarRadiusAxis
            tick={{ fontSize: 9, fill: "var(--color-muted-foreground)" }}
            axisLine={false}
            domain={[0, "auto"]}
          />
          <Radar
            dataKey="value"
            stroke="#38bdf8"
            fill="#38bdf8"
            fillOpacity={0.15}
            strokeWidth={2}
            dot={{ r: 4, fill: "#38bdf8", strokeWidth: 0 }}
            animationDuration={1200}
            animationEasing="ease-out"
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--color-card)",
              border: "1px solid var(--color-border)",
              borderRadius: "8px",
              fontSize: "12px",
              padding: "6px 10px",
            }}
            formatter={(value) => [Number(value).toLocaleString(), "Score"]}
          />
        </RadarChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="flex flex-wrap gap-3">
        {Object.entries(REGION_COLORS).filter(([k]) => k !== "Other").map(([region, color]) => (
          <div key={region} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
            {region}
          </div>
        ))}
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={filtered.length * 32 + 20}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 0, right: 40, left: 10, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-border)" opacity={0.3} />
          <XAxis
            type="number"
            tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fontSize: 11, fill: "var(--color-muted-foreground)", fontWeight: 500 }}
            tickLine={false}
            axisLine={false}
            width={90}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--color-card)",
              border: "1px solid var(--color-border)",
              borderRadius: "8px",
              fontSize: "12px",
              padding: "6px 10px",
            }}
            formatter={(value) => [Number(value).toLocaleString(), "Score"]}
            cursor={{ fill: "var(--color-muted)", opacity: 0.15 }}
          />
          <Bar
            dataKey="value"
            radius={[0, 6, 6, 0]}
            animationDuration={1200}
            animationEasing="ease-out"
            barSize={20}
          >
            {chartData.map((entry) => (
              <Cell key={entry.name} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
