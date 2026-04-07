import * as React from "react";

/* ── types ── */

export type SerializedAgent = {
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

export type CouncilSessionSummary = {
  id: string;
  topic: string;
  status: string;
  mode: string;
  confidence: number | null;
  createdAt: string;
  decidedAt: string | null;
};

export type UsageData = {
  windowMinutes: number;
  totals: { sessions: number; totalTokens: number; inputTokens: number; outputTokens: number; estimatedCost: number };
  byModel: Array<{ model: string; sessions: number; totalTokens: number; estimatedCost: number }>;
  byAgent: Array<{ agentId: string; model: string; sessions: number; totalTokens: number; estimatedCost: number }>;
};

export type SessionData = {
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

export type LogEntry = {
  id: number;
  timestamp: string;
  severity: string;
  source: string;
  eventType: string;
  message: string;
};

export type Tab = "overview" | "config" | "agents" | "cron" | "sessions" | "logs";

/* ── helpers ── */

export const formatInt = (v: number) => new Intl.NumberFormat("en-US").format(Math.round(v));
export const formatMoney = (v: number) => `$${v.toFixed(4)}`;

/* ── shared components ── */

export function TabLoading() {
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

export function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
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
