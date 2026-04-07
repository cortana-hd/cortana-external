"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import type { CronJob, CronRun, FormMode, FormState } from "./cron-types";
import { DEFAULT_FORM } from "./cron-types";
import {
  fetchCronJobs,
  fetchCronRuns,
  createCronJob,
  updateCronJob,
  deleteCronJob as deleteCronJobApi,
  triggerCronJob,
  toggleCronJob,
} from "./cron-api";
import { CronJobForm } from "./cron-job-form";
import {
  CronJobTable,
  getJobId,
  getJobName,
  getJobEnabled,
  getConsecutiveErrors,
  getLastRunAt,
  getNextRunAt,
  getLastStatus,
} from "./cron-job-table";
import { CronRunHistory, getRunsRows } from "./cron-run-history";

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
      const payload = await fetchCronJobs();
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
      await toggleCronJob(id, next);
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
      await triggerCronJob(id);
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
      if (!formState.name.trim()) {
        setError("Name is required.");
        return;
      }

      if (formMode === "create") {
        await createCronJob(formState);
        setSuccess("Cron job created.");
      } else if (activeJob) {
        const id = getJobId(activeJob);
        if (!id) {
          setError("Unable to edit this cron job because it has no id.");
          return;
        }

        await updateCronJob(id, formState);
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
      await deleteCronJobApi(id);
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
      const payload = await fetchCronRuns(id);
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
                <CronJobTable
                  jobs={filteredJobs}
                  onToggle={handleToggle}
                  onRunNow={handleRunNow}
                  onEdit={openEdit}
                  onDelete={setDeleteJob}
                  onViewRuns={openHistory}
                  actionId={actionId}
                />
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {formOpen && (
        <CronJobForm
          form={formState}
          onChange={setFormState}
          onSubmit={handleSubmit}
          onCancel={() => setFormOpen(false)}
          mode={formMode}
        />
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
        <CronRunHistory
          runs={historyRuns}
          loading={historyLoading}
          error={historyError}
          raw={historyRaw}
          jobName={getJobName(historyJob)}
          jobId={getJobId(historyJob)}
          onClose={() => setHistoryJob(null)}
        />
      )}
    </div>
  );
}
