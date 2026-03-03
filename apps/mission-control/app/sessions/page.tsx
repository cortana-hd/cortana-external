"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Session = {
  key: string | null;
  sessionId: string | null;
  updatedAt: number | null;
  totalTokens: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  model: string | null;
  agentId: string | null;
  systemSent: boolean | null;
  abortedLastRun: boolean | null;
  estimatedCost: number;
};

type SessionsResponse = { sessions: Session[]; error?: string };

export const formatInt = (value: number) => new Intl.NumberFormat("en-US").format(Math.round(value));
export const formatMoney = (value: number) => `$${value.toFixed(4)}`;

export function summarizeSessions(sessions: Session[]) {
  return sessions.reduce(
    (acc, session) => {
      acc.total += 1;
      acc.inputTokens += session.inputTokens ?? 0;
      acc.outputTokens += session.outputTokens ?? 0;
      acc.estimatedCost += session.estimatedCost ?? 0;
      acc.systemSent += session.systemSent ? 1 : 0;
      acc.aborted += session.abortedLastRun ? 1 : 0;

      if (session.updatedAt && (!acc.latestUpdatedAt || session.updatedAt > acc.latestUpdatedAt)) {
        acc.latestUpdatedAt = session.updatedAt;
      }

      return acc;
    },
    {
      total: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCost: 0,
      systemSent: 0,
      aborted: 0,
      latestUpdatedAt: null as number | null,
    }
  );
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/sessions", { cache: "no-store" });
        const payload = (await response.json()) as SessionsResponse;

        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load sessions");
        }

        if (!cancelled) {
          setSessions(payload.sessions ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load sessions");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const summary = useMemo(() => summarizeSessions(sessions), [sessions]);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Sessions</h1>
        <p className="text-sm text-muted-foreground">
          Active OpenClaw sessions across agents, including token usage and estimated cost.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Sessions</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{formatInt(summary.total)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Input tokens</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{formatInt(summary.inputTokens)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Output tokens</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{formatInt(summary.outputTokens)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Estimated cost</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{formatMoney(summary.estimatedCost)}</CardContent>
        </Card>
      </div>

      {!loading && !error ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">System stats</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">System-started</p>
              <p className="text-xl font-semibold">{formatInt(summary.systemSent)}</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Aborted last run</p>
              <p className="text-xl font-semibold">{formatInt(summary.aborted)}</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Latest session update</p>
              <p className="text-sm font-medium">
                {summary.latestUpdatedAt ? new Date(summary.latestUpdatedAt).toLocaleString() : "N/A"}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {loading ? <p className="text-sm text-muted-foreground">Loading sessions…</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {!loading && !error ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent sessions</CardTitle>
          </CardHeader>
          <CardContent>
            {sessions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active sessions found.</p>
            ) : (
              <div className="space-y-3">
                {sessions.map((session, index) => (
                  <div key={session.key ?? session.sessionId ?? `session-${index}`} className="rounded-md border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{session.agentId ?? "unknown-agent"}</p>
                      <p className="text-xs text-muted-foreground">{session.model ?? "unknown-model"}</p>
                    </div>
                    <p className="mt-1 break-all text-xs text-muted-foreground">{session.sessionId ?? session.key ?? "no-session-id"}</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {formatInt(session.totalTokens ?? 0)} tokens · {formatMoney(session.estimatedCost ?? 0)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
