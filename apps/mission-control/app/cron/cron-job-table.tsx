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
import type { CronJob } from "./cron-types";

const getJobId = (job: CronJob) =>
  (job.id || job.jobId || job.name || job.slug || "") as string;

const getJobName = (job: CronJob) =>
  (job.name || job.id || job.jobId || "Untitled") as string;

const getJobEnabled = (job: CronJob) => {
  if (typeof job.enabled === "boolean") return job.enabled;
  if (typeof job.disabled === "boolean") return !job.disabled;
  return true;
};

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

const pickValue = <T,>(...values: T[]) =>
  values.find((value) => value !== undefined && value !== null);

const getJobState = (job: CronJob) => (job.state ?? {}) as Record<string, unknown>;

const getLastRunAt = (job: CronJob) => {
  const state = getJobState(job);
  return (
    toTimestamp(
      pickValue(
        state.lastRunAtMs,
        state.lastRunAt,
        state.lastRun,
        job.lastRunAtMs,
        job.lastRunAt,
        job.lastRun
      )
    ) ?? null
  );
};

const getNextRunAt = (job: CronJob) => {
  const state = getJobState(job);
  return (
    toTimestamp(
      pickValue(
        state.nextRunAtMs,
        state.nextRunAt,
        state.nextRun,
        job.nextRunAtMs,
        job.nextRunAt,
        job.nextRun
      )
    ) ?? null
  );
};

const getLastStatus = (job: CronJob) => {
  const state = getJobState(job);
  const value =
    state.lastStatus || state.last_status || state.status || job.lastStatus || job.status;
  return typeof value === "string" && value.trim() ? value : "unknown";
};

const getConsecutiveErrors = (job: CronJob) => {
  const state = getJobState(job);
  const value = pickValue(
    state.consecutiveErrors,
    state.consecutive_errors,
    state.consecutiveFailures,
    job.consecutiveErrors,
    job.consecutive_errors
  );
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
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

const getScheduleText = (job: CronJob) => {
  const schedule = job.schedule as Record<string, unknown> | undefined;
  if (!schedule) return "\u2014";

  const kind = typeof schedule.kind === "string" ? schedule.kind : "";
  const expr = typeof schedule.expr === "string" ? schedule.expr : undefined;
  const everyMs = typeof schedule.everyMs === "number" ? schedule.everyMs : undefined;
  const at = typeof schedule.at === "string" ? schedule.at : undefined;

  if (kind === "cron" && expr) return `Cron \u00B7 ${expr}`;
  if (kind === "every" && everyMs) return `Every \u00B7 ${formatDuration(everyMs)}`;
  if (kind === "at" && at) return `At \u00B7 ${at}`;

  if (expr) return expr;
  if (everyMs) return formatDuration(everyMs);
  if (at) return at;

  return kind || "\u2014";
};

const relativeTime = (timestamp: number | null) => {
  if (!timestamp) return "\u2014";
  const diff = timestamp - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (abs < 60_000) return rtf.format(Math.round(diff / 1000), "second");
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), "hour");
  if (abs < 604_800_000) return rtf.format(Math.round(diff / 86_400_000), "day");

  return new Date(timestamp).toLocaleDateString();
};

const statusVariant = (status: string) => {
  const normalized = status.toLowerCase();
  if (["done", "completed", "success", "ok"].includes(normalized)) return "success";
  if (["failed", "error", "timeout", "stale"].includes(normalized)) return "destructive";
  if (["running", "queued", "pending"].includes(normalized)) return "warning";
  return "secondary";
};

type CronJobTableProps = {
  jobs: CronJob[];
  onToggle: (job: CronJob) => void;
  onRunNow: (job: CronJob) => void;
  onEdit: (job: CronJob) => void;
  onDelete: (job: CronJob) => void;
  onViewRuns: (job: CronJob) => void;
  actionId: string | null;
};

export function CronJobTable({
  jobs,
  onToggle,
  onRunNow,
  onEdit,
  onDelete,
  onViewRuns,
  actionId,
}: CronJobTableProps) {
  return (
    <div className="space-y-4">
      {/* Mobile card layout */}
      <div className="grid gap-3 md:hidden">
        {jobs.map((job) => {
          const id = getJobId(job);
          const enabled = getJobEnabled(job);
          const lastRun = relativeTime(getLastRunAt(job));
          const nextRun = relativeTime(getNextRunAt(job));
          const status = getLastStatus(job);
          const errors = getConsecutiveErrors(job);

          return (
            <Card key={id} className="border-border/60">
              <CardHeader className="space-y-2">
                <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                  <span className="truncate">{getJobName(job)}</span>
                  <Badge variant={enabled ? "success" : "outline"}>
                    {enabled ? "Enabled" : "Disabled"}
                  </Badge>
                </CardTitle>
                <p className="text-xs text-muted-foreground">{getScheduleText(job)}</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
                  <div>
                    <p className="uppercase tracking-wide">Last run</p>
                    <p className="text-foreground">{lastRun}</p>
                  </div>
                  <div>
                    <p className="uppercase tracking-wide">Next run</p>
                    <p className="text-foreground">{nextRun}</p>
                  </div>
                  <div>
                    <p className="uppercase tracking-wide">Last status</p>
                    <Badge variant={statusVariant(status)}>{status}</Badge>
                  </div>
                  <div>
                    <p className="uppercase tracking-wide">Errors</p>
                    <Badge variant={errors > 0 ? "destructive" : "secondary"}>
                      {errors}
                    </Badge>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onToggle(job)}
                    disabled={actionId === id}
                  >
                    {enabled ? "Disable" : "Enable"}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => onRunNow(job)}
                    disabled={actionId === id}
                  >
                    Run now
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => onEdit(job)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => onViewRuns(job)}>
                    History
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => onDelete(job)}
                  >
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Desktop table layout */}
      <div className="hidden rounded-md border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Schedule</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last run</TableHead>
              <TableHead>Last status</TableHead>
              <TableHead>Errors</TableHead>
              <TableHead>Next run</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.map((job) => {
              const id = getJobId(job);
              const enabled = getJobEnabled(job);
              const lastRun = relativeTime(getLastRunAt(job));
              const nextRun = relativeTime(getNextRunAt(job));
              const status = getLastStatus(job);
              const errors = getConsecutiveErrors(job);

              return (
                <TableRow key={id}>
                  <TableCell>
                    <div className="font-semibold text-foreground">
                      {getJobName(job)}
                    </div>
                    <div className="text-xs text-muted-foreground">{id}</div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {getScheduleText(job)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={enabled ? "success" : "outline"}>
                      {enabled ? "Enabled" : "Disabled"}
                    </Badge>
                  </TableCell>
                  <TableCell>{lastRun}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(status)}>{status}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={errors > 0 ? "destructive" : "secondary"}>
                      {errors}
                    </Badge>
                  </TableCell>
                  <TableCell>{nextRun}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onToggle(job)}
                        disabled={actionId === id}
                      >
                        {enabled ? "Disable" : "Enable"}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => onRunNow(job)}
                        disabled={actionId === id}
                      >
                        Run
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => onEdit(job)}>
                        Edit
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => onViewRuns(job)}>
                        History
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => onDelete(job)}
                      >
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// Re-export helpers needed by the orchestrator for filtering/sorting
export {
  getJobId,
  getJobName,
  getJobEnabled,
  getConsecutiveErrors,
  getLastRunAt,
  getNextRunAt,
  getLastStatus,
};
