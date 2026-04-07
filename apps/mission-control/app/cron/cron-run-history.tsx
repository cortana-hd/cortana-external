"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type { CronRun } from "./cron-types";

const toTimestamp = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getTime();
  return null;
};

const formatDuration = (ms: number) => {
  if (!Number.isFinite(ms)) return "\u2014";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
};

const getRunValue = (run: CronRun, keys: string[]) => {
  for (const key of keys) {
    const value = run[key];
    if (value !== undefined && value !== null) return value;
  }
  return null;
};

const formatRunTimestamp = (run: CronRun) => {
  const value = getRunValue(run, ["timestamp", "startedAt", "started_at", "time"]);
  const timestamp = toTimestamp(value);
  if (!timestamp) return "\u2014";
  return new Date(timestamp).toLocaleString();
};

const formatRunDuration = (run: CronRun) => {
  const value = getRunValue(run, ["durationMs", "duration_ms", "duration", "runtimeMs"]);
  if (typeof value === "number" && Number.isFinite(value)) return formatDuration(value);
  if (typeof value === "string" && value.trim()) return value;
  return "\u2014";
};

const formatRunStatus = (run: CronRun) => {
  const value = getRunValue(run, ["status", "result", "state"]);
  return typeof value === "string" && value.trim() ? value : "unknown";
};

const formatRunDelivery = (run: CronRun) => {
  const delivery = run.delivery as Record<string, unknown> | undefined;
  if (delivery && typeof delivery.mode === "string") return delivery.mode;
  const value = getRunValue(run, ["delivery", "deliveryMode", "deliveryStatus"]);
  return typeof value === "string" && value.trim() ? value : "\u2014";
};

const statusVariant = (status: string) => {
  const normalized = status.toLowerCase();
  if (["done", "completed", "success", "ok"].includes(normalized)) return "success";
  if (["failed", "error", "timeout", "stale"].includes(normalized)) return "destructive";
  if (["running", "queued", "pending"].includes(normalized)) return "warning";
  return "secondary";
};

type CronRunHistoryProps = {
  runs: CronRun[];
  loading: boolean;
  error: string | null;
  raw: string | null;
  jobName: string;
  jobId: string;
  onClose: () => void;
};

export function CronRunHistory({
  runs,
  loading,
  error,
  raw,
  jobName,
  jobId,
  onClose,
}: CronRunHistoryProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
      <Card className="w-full max-w-3xl">
        <CardHeader className="border-b">
          <CardTitle className="text-base">Run history: {jobName}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading runs...</p>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : runs.length === 0 ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">No runs found.</p>
              {raw && (
                <Textarea
                  readOnly
                  value={raw}
                  className="min-h-[160px] font-mono text-xs"
                />
              )}
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Delivery</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run, index) => {
                    const status = formatRunStatus(run);
                    return (
                      <TableRow key={`${jobId}-${index}`}>
                        <TableCell>{formatRunTimestamp(run)}</TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(status)}>{status}</Badge>
                        </TableCell>
                        <TableCell>{formatRunDuration(run)}</TableCell>
                        <TableCell>{formatRunDelivery(run)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="flex justify-end">
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Re-export for use by the orchestrator
export { getRunValue as _getRunValue };

export const getRunsRows = (runs: CronRun[] | Record<string, unknown>) => {
  if (Array.isArray(runs)) return runs;
  if (runs && typeof runs === "object") {
    const record = runs as Record<string, unknown>;
    const values = record.runs;
    if (Array.isArray(values)) return values as CronRun[];
  }
  return [];
};
