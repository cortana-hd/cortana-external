"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type CronJob = Record<string, unknown> & {
  id?: string;
  name?: string;
  enabled?: boolean;
  schedule?: Record<string, unknown>;
  state?: Record<string, unknown>;
};

type CronRun = Record<string, unknown>;

type CronListResponse = {
  jobs?: CronJob[];
  error?: string;
  details?: string;
};

type CronRunsResponse = {
  runs?: CronRun[] | Record<string, unknown>;
  raw?: string;
  error?: string;
  details?: string;
};

type FormMode = "create" | "edit";

type FormState = {
  name: string;
  scheduleKind: string;
  scheduleExpr: string;
  sessionTarget: string;
  payloadKind: string;
  payloadMessage: string;
  payloadModel: string;
  payloadTimeout: string;
  deliveryMode: string;
  agentId: string;
  enabled: boolean;
  isolated: boolean;
  agentTurn: boolean;
};

const DEFAULT_FORM: FormState = {
  name: "",
  scheduleKind: "cron",
  scheduleExpr: "",
  sessionTarget: "",
  payloadKind: "message",
  payloadMessage: "",
  payloadModel: "",
  payloadTimeout: "",
  deliveryMode: "none",
  agentId: "",
  enabled: true,
  isolated: true,
  agentTurn: true,
};

const REQUEST_HEADERS = { "Content-Type": "application/json" };

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

const pickValue = <T,>(...values: T[]) => values.find((value) => value !== undefined && value !== null);

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

const getScheduleText = (job: CronJob) => {
  const schedule = job.schedule as Record<string, unknown> | undefined;
  if (!schedule) return "—";

  const kind = typeof schedule.kind === "string" ? schedule.kind : "";
  const expr = typeof schedule.expr === "string" ? schedule.expr : undefined;
  const everyMs = typeof schedule.everyMs === "number" ? schedule.everyMs : undefined;
  const at = typeof schedule.at === "string" ? schedule.at : undefined;

  if (kind === "cron" && expr) return `Cron · ${expr}`;
  if (kind === "every" && everyMs) return `Every · ${formatDuration(everyMs)}`;
  if (kind === "at" && at) return `At · ${at}`;

  if (expr) return expr;
  if (everyMs) return formatDuration(everyMs);
  if (at) return at;

  return kind || "—";
};

const formatDuration = (ms: number) => {
  if (!Number.isFinite(ms)) return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
};

const relativeTime = (timestamp: number | null) => {
  if (!timestamp) return "—";
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

const requestJson = async <T,>(url: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(url, { cache: "no-store", ...options });
  let payload: T;
  try {
    payload = (await response.json()) as T;
  } catch {
    throw new Error(`Request failed (${response.status})`);
  }

  if (!response.ok) {
    const errorPayload = payload as { error?: string };
    throw new Error(errorPayload.error || `Request failed (${response.status})`);
  }

  return payload;
};

const buildPayload = (state: FormState, includeEmpty = false) => {
  const payload: Record<string, unknown> = {};
  const pushValue = (key: keyof FormState, value: unknown) => {
    if (!includeEmpty) {
      if (typeof value === "string" && value.trim() === "") return;
      if (value === undefined || value === null) return;
    }
    payload[key] = value;
  };

  pushValue("name", state.name.trim());
  pushValue("scheduleKind", state.scheduleKind);
  pushValue("scheduleExpr", state.scheduleExpr.trim());
  pushValue("sessionTarget", state.sessionTarget.trim());
  pushValue("payloadKind", state.payloadKind.trim());
  pushValue("payloadMessage", state.payloadMessage.trim());
  pushValue("payloadModel", state.payloadModel.trim());
  pushValue("payloadTimeout", state.payloadTimeout.trim());
  pushValue("deliveryMode", state.deliveryMode.trim());
  pushValue("agentId", state.agentId.trim());
  pushValue("enabled", state.enabled);
  pushValue("isolated", state.isolated);
  pushValue("agentTurn", state.agentTurn);

  return payload;
};

const toInputString = (value: unknown) => {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
};

const parseJobToForm = (job: CronJob): FormState => {
  const schedule = (job.schedule ?? {}) as Record<string, unknown>;
  const payload = (job.payload ?? {}) as Record<string, unknown>;
  const session = (job.session ?? {}) as Record<string, unknown>;
  const delivery = (job.delivery ?? {}) as Record<string, unknown>;

  return {
    name: (job.name as string) || "",
    scheduleKind: (schedule.kind as string) || "cron",
    scheduleExpr:
      toInputString(schedule.expr) ||
      (typeof schedule.everyMs === "number" ? String(schedule.everyMs) : "") ||
      toInputString(schedule.at),
    sessionTarget:
      toInputString(job.sessionTarget) ||
      toInputString(session.target) ||
      toInputString(job.target),
    payloadKind: toInputString(payload.kind) || "message",
    payloadMessage: toInputString(payload.message),
    payloadModel: toInputString(payload.model),
    payloadTimeout:
      toInputString(payload.timeoutMs) ||
      toInputString(payload.timeout) ||
      toInputString(job.payloadTimeout),
    deliveryMode:
      toInputString(delivery.mode) ||
      toInputString(job.deliveryMode) ||
      toInputString(delivery.type) ||
      "none",
    agentId: toInputString(job.agentId) || toInputString(job.agent_id),
    enabled: getJobEnabled(job),
    isolated: typeof job.isolated === "boolean" ? job.isolated : true,
    agentTurn: typeof job.agentTurn === "boolean" ? job.agentTurn : true,
  };
};

const getRunsRows = (runs: CronRun[] | Record<string, unknown>) => {
  if (Array.isArray(runs)) return runs;
  if (runs && typeof runs === "object") {
    const record = runs as Record<string, unknown>;
    const values = record.runs;
    if (Array.isArray(values)) return values as CronRun[];
  }
  return [];
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
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleString();
};

const formatRunDuration = (run: CronRun) => {
  const value = getRunValue(run, ["durationMs", "duration_ms", "duration", "runtimeMs"]);
  if (typeof value === "number" && Number.isFinite(value)) return formatDuration(value);
  if (typeof value === "string" && value.trim()) return value;
  return "—";
};

const formatRunStatus = (run: CronRun) => {
  const value = getRunValue(run, ["status", "result", "state"]);
  return typeof value === "string" && value.trim() ? value : "unknown";
};

const formatRunDelivery = (run: CronRun) => {
  const delivery = run.delivery as Record<string, unknown> | undefined;
  if (delivery && typeof delivery.mode === "string") return delivery.mode;
  const value = getRunValue(run, ["delivery", "deliveryMode", "deliveryStatus"]);
  return typeof value === "string" && value.trim() ? value : "—";
};

export function CronClient() {
  const [jobs, setJobs] = React.useState<CronJob[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [filter, setFilter] = React.useState("all");
  const [sortBy, setSortBy] = React.useState("nextRun");
  const [formOpen, setFormOpen] = React.useState(false);
  const [formMode, setFormMode] = React.useState<FormMode>("create");
  const [formState, setFormState] = React.useState<FormState>(DEFAULT_FORM);
  const [activeJob, setActiveJob] = React.useState<CronJob | null>(null);
  const [deleteJob, setDeleteJob] = React.useState<CronJob | null>(null);
  const [historyJob, setHistoryJob] = React.useState<CronJob | null>(null);
  const [historyRuns, setHistoryRuns] = React.useState<CronRun[]>([]);
  const [historyRaw, setHistoryRaw] = React.useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = React.useState(false);
  const [historyError, setHistoryError] = React.useState<string | null>(null);
  const [actionId, setActionId] = React.useState<string | null>(null);

  const loadJobs = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const payload = await requestJson<CronListResponse>("/api/cron");
      setJobs(payload.jobs ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load cron jobs.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  React.useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(null), 3000);
    return () => clearTimeout(timer);
  }, [success]);

  const filteredJobs = React.useMemo(() => {
    const term = search.trim().toLowerCase();
    const base = jobs.filter((job) => {
      const name = getJobName(job).toLowerCase();
      return !term || name.includes(term);
    });

    const filtered = base.filter((job) => {
      if (filter === "enabled") return getJobEnabled(job);
      if (filter === "disabled") return !getJobEnabled(job);
      if (filter === "errors") return getConsecutiveErrors(job) > 0;
      return true;
    });

    const sorted = [...filtered].sort((a, b) => {
      if (sortBy === "name") return getJobName(a).localeCompare(getJobName(b));
      if (sortBy === "lastRun") return (getLastRunAt(b) ?? 0) - (getLastRunAt(a) ?? 0);
      if (sortBy === "nextRun") return (getNextRunAt(a) ?? 0) - (getNextRunAt(b) ?? 0);
      if (sortBy === "status") return getLastStatus(a).localeCompare(getLastStatus(b));
      return 0;
    });

    return sorted;
  }, [jobs, search, filter, sortBy]);

  const summary = React.useMemo(() => {
    const enabled = jobs.filter((job) => getJobEnabled(job)).length;
    const disabled = jobs.length - enabled;
    const errors = jobs.filter((job) => getConsecutiveErrors(job) > 0).length;
    return { total: jobs.length, enabled, disabled, errors };
  }, [jobs]);

  const handleToggle = async (job: CronJob) => {
    const id = getJobId(job);
    if (!id) return;
    const next = !getJobEnabled(job);

    try {
      setActionId(id);
      setError(null);
      await requestJson(`/api/cron/${encodeURIComponent(id)}/toggle`, {
        method: "POST",
        headers: REQUEST_HEADERS,
        body: JSON.stringify({ enabled: next }),
      });
      setSuccess(`Cron ${next ? "enabled" : "disabled"}.`);
      await loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle cron.");
    } finally {
      setActionId(null);
    }
  };

  const handleRunNow = async (job: CronJob) => {
    const id = getJobId(job);
    if (!id) return;

    try {
      setActionId(id);
      setError(null);
      await requestJson(`/api/cron/${encodeURIComponent(id)}/run`, { method: "POST" });
      setSuccess("Cron run started.");
      await loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run cron.");
    } finally {
      setActionId(null);
    }
  };

  const openCreate = () => {
    setFormMode("create");
    setFormState({ ...DEFAULT_FORM });
    setFormOpen(true);
  };

  const openEdit = (job: CronJob) => {
    setFormMode("edit");
    setActiveJob(job);
    setFormState(parseJobToForm(job));
    setFormOpen(true);
  };

  const handleSubmit = async () => {
    try {
      setError(null);
      const payload = buildPayload(formState);
      if (!payload.name) {
        setError("Name is required.");
        return;
      }

      if (formMode === "create") {
        await requestJson("/api/cron", {
          method: "POST",
          headers: REQUEST_HEADERS,
          body: JSON.stringify(payload),
        });
        setSuccess("Cron job created.");
      } else if (activeJob) {
        const id = getJobId(activeJob);
        if (!id) {
          setError("Unable to edit this cron job because it has no id.");
          return;
        }

        await requestJson(`/api/cron/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: REQUEST_HEADERS,
          body: JSON.stringify(payload),
        });
        setSuccess("Cron job updated.");
      }

      setFormOpen(false);
      await loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save cron job.");
    }
  };

  const handleDelete = async () => {
    if (!deleteJob) return;
    const id = getJobId(deleteJob);
    if (!id) return;

    try {
      setActionId(id);
      setError(null);
      await requestJson(`/api/cron/${encodeURIComponent(id)}`, { method: "DELETE" });
      setSuccess("Cron job deleted.");
      setDeleteJob(null);
      await loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete cron job.");
    } finally {
      setActionId(null);
    }
  };

  const openHistory = async (job: CronJob) => {
    const id = getJobId(job);
    if (!id) return;
    setHistoryJob(job);
    setHistoryLoading(true);
    setHistoryError(null);
    setHistoryRuns([]);
    setHistoryRaw(null);

    try {
      const payload = await requestJson<CronRunsResponse>(
        `/api/cron/${encodeURIComponent(id)}/runs`
      );
      const runs = payload.runs ? getRunsRows(payload.runs) : [];
      setHistoryRuns(runs);
      setHistoryRaw(payload.raw ?? null);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : "Failed to load run history.");
    } finally {
      setHistoryLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
            Cron Scheduler
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Cron editor</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review schedules, trigger runs, and adjust delivery settings.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">Total {summary.total}</Badge>
          <Badge variant="success">Enabled {summary.enabled}</Badge>
          <Badge variant="outline">Disabled {summary.disabled}</Badge>
          {summary.errors > 0 && <Badge variant="destructive">Errors {summary.errors}</Badge>}
        </div>
      </div>

      <Card>
        <CardHeader className="gap-3">
          <CardTitle className="text-base">Schedule control</CardTitle>
          <div className="flex flex-wrap gap-3">
            <div className="flex min-w-[200px] flex-1 items-center gap-2">
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search cron jobs"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="min-w-[160px]">
                  <SelectValue placeholder="Sort" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name">Sort by name</SelectItem>
                  <SelectItem value="lastRun">Sort by last run</SelectItem>
                  <SelectItem value="nextRun">Sort by next run</SelectItem>
                  <SelectItem value="status">Sort by status</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={loadJobs} disabled={loading}>
                Refresh
              </Button>
              <Button onClick={openCreate}>Create cron</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={filter} onValueChange={setFilter} className="space-y-4">
            <TabsList variant="line" className="w-full justify-start">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="enabled">Enabled</TabsTrigger>
              <TabsTrigger value="disabled">Disabled</TabsTrigger>
              <TabsTrigger value="errors">Errors</TabsTrigger>
            </TabsList>
            <TabsContent value={filter}>
              {error && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}
              {success && (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                  {success}
                </div>
              )}

              {loading ? (
                <div className="rounded-md border px-3 py-6 text-sm text-muted-foreground">
                  Loading cron jobs...
                </div>
              ) : filteredJobs.length === 0 ? (
                <div className="rounded-md border px-3 py-6 text-sm text-muted-foreground">
                  No cron jobs found for this view.
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid gap-3 md:hidden">
                    {filteredJobs.map((job) => {
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
                                onClick={() => handleToggle(job)}
                                disabled={actionId === id}
                              >
                                {enabled ? "Disable" : "Enable"}
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => handleRunNow(job)}
                                disabled={actionId === id}
                              >
                                Run now
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => openEdit(job)}>
                                Edit
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => openHistory(job)}>
                                History
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => setDeleteJob(job)}
                              >
                                Delete
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>

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
                        {filteredJobs.map((job) => {
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
                                    onClick={() => handleToggle(job)}
                                    disabled={actionId === id}
                                  >
                                    {enabled ? "Disable" : "Enable"}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => handleRunNow(job)}
                                    disabled={actionId === id}
                                  >
                                    Run
                                  </Button>
                                  <Button size="sm" variant="outline" onClick={() => openEdit(job)}>
                                    Edit
                                  </Button>
                                  <Button size="sm" variant="outline" onClick={() => openHistory(job)}>
                                    History
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    onClick={() => setDeleteJob(job)}
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
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
          <Card className="w-full max-w-3xl">
            <CardHeader className="border-b">
              <CardTitle className="text-base">
                {formMode === "create" ? "Create cron job" : "Edit cron job"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="cron-name">Name</Label>
                  <Input
                    id="cron-name"
                    value={formState.name}
                    onChange={(event) =>
                      setFormState((prev) => ({ ...prev, name: event.target.value }))
                    }
                    placeholder="daily-summary"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cron-agent">Agent ID</Label>
                  <Input
                    id="cron-agent"
                    value={formState.agentId}
                    onChange={(event) =>
                      setFormState((prev) => ({ ...prev, agentId: event.target.value }))
                    }
                    placeholder="agent-01"
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Schedule kind</Label>
                  <Select
                    value={formState.scheduleKind}
                    onValueChange={(value) =>
                      setFormState((prev) => ({ ...prev, scheduleKind: value }))
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select kind" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cron">Cron expression</SelectItem>
                      <SelectItem value="every">Every</SelectItem>
                      <SelectItem value="at">At time</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cron-expr">Schedule expression</Label>
                  <Input
                    id="cron-expr"
                    value={formState.scheduleExpr}
                    onChange={(event) =>
                      setFormState((prev) => ({ ...prev, scheduleExpr: event.target.value }))
                    }
                    placeholder="*/15 * * * *"
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="cron-session">Session target</Label>
                  <Input
                    id="cron-session"
                    value={formState.sessionTarget}
                    onChange={(event) =>
                      setFormState((prev) => ({ ...prev, sessionTarget: event.target.value }))
                    }
                    placeholder="assistant"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Delivery mode</Label>
                  <Select
                    value={formState.deliveryMode}
                    onValueChange={(value) =>
                      setFormState((prev) => ({ ...prev, deliveryMode: value }))
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select delivery" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="channel">Channel</SelectItem>
                      <SelectItem value="direct">Direct</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Payload kind</Label>
                    <Select
                      value={formState.payloadKind}
                      onValueChange={(value) =>
                        setFormState((prev) => ({ ...prev, payloadKind: value }))
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select payload" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="message">Message</SelectItem>
                        <SelectItem value="json">JSON</SelectItem>
                        <SelectItem value="task">Task</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="payload-model">Payload model</Label>
                    <Input
                      id="payload-model"
                      value={formState.payloadModel}
                      onChange={(event) =>
                        setFormState((prev) => ({ ...prev, payloadModel: event.target.value }))
                      }
                      placeholder="gpt-4.1"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="payload-message">Payload message</Label>
                  <Textarea
                    id="payload-message"
                    value={formState.payloadMessage}
                    onChange={(event) =>
                      setFormState((prev) => ({ ...prev, payloadMessage: event.target.value }))
                    }
                    placeholder="Enter payload instructions"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="payload-timeout">Payload timeout</Label>
                  <Input
                    id="payload-timeout"
                    value={formState.payloadTimeout}
                    onChange={(event) =>
                      setFormState((prev) => ({ ...prev, payloadTimeout: event.target.value }))
                    }
                    placeholder="60000"
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={formState.enabled}
                    onChange={(event) =>
                      setFormState((prev) => ({ ...prev, enabled: event.target.checked }))
                    }
                    className="h-4 w-4"
                  />
                  Enabled
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={formState.isolated}
                    onChange={(event) =>
                      setFormState((prev) => ({ ...prev, isolated: event.target.checked }))
                    }
                    className="h-4 w-4"
                  />
                  Isolated
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={formState.agentTurn}
                    onChange={(event) =>
                      setFormState((prev) => ({ ...prev, agentTurn: event.target.checked }))
                    }
                    className="h-4 w-4"
                  />
                  Agent turn
                </label>
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" onClick={() => setFormOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleSubmit}>
                  {formMode === "create" ? "Create job" : "Save changes"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {deleteJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
          <Card className="w-full max-w-md">
            <CardHeader className="border-b">
              <CardTitle className="text-base">Delete cron job</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-6">
              <p className="text-sm text-muted-foreground">
                Delete {getJobName(deleteJob)}? This cannot be undone.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setDeleteJob(null)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={actionId === getJobId(deleteJob)}
                >
                  Delete
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {historyJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
          <Card className="w-full max-w-3xl">
            <CardHeader className="border-b">
              <CardTitle className="text-base">Run history: {getJobName(historyJob)}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-6">
              {historyLoading ? (
                <p className="text-sm text-muted-foreground">Loading runs...</p>
              ) : historyError ? (
                <p className="text-sm text-destructive">{historyError}</p>
              ) : historyRuns.length === 0 ? (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">No runs found.</p>
                  {historyRaw && (
                    <Textarea
                      readOnly
                      value={historyRaw}
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
                      {historyRuns.map((run, index) => {
                        const status = formatRunStatus(run);
                        return (
                          <TableRow key={`${getJobId(historyJob)}-${index}`}>
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
                <Button variant="outline" onClick={() => setHistoryJob(null)}>
                  Close
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
