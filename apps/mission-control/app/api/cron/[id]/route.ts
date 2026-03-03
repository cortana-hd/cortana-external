import { execSync, type ExecSyncOptionsWithStringEncoding } from "node:child_process";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const EXEC_OPTIONS: ExecSyncOptionsWithStringEncoding = {
  encoding: "utf8",
  timeout: 15000,
  stdio: ["ignore", "pipe", "pipe"],
};

type CronJob = Record<string, unknown>;

type ExecError = Error & { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };

type CronRequestBody = Record<string, unknown>;

const quote = (value: unknown) => {
  const stringified = typeof value === "string" ? value : JSON.stringify(value);
  return `'${stringified.replace(/'/g, `'\\''`)}'`;
};

const toKebabCase = (value: string) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();

const FIELD_MAP: Record<string, string> = {
  name: "name",
  scheduleKind: "schedule-kind",
  scheduleExpr: "schedule-expr",
  sessionTarget: "session-target",
  payloadKind: "payload-kind",
  payloadMessage: "payload-message",
  payloadModel: "payload-model",
  payloadTimeout: "payload-timeout",
  deliveryMode: "delivery-mode",
  agentId: "agent-id",
  isolated: "isolated",
  agentTurn: "agent-turn",
};

const buildFlags = (body: CronRequestBody) => {
  const entries = Object.entries(body);
  const flags: string[] = [];

  for (const [key, rawValue] of entries) {
    if (rawValue === undefined || rawValue === null) continue;
    if (typeof rawValue === "string" && rawValue.trim() === "") continue;

    const flag = FIELD_MAP[key] ?? toKebabCase(key);
    const value = typeof rawValue === "object" ? JSON.stringify(rawValue) : String(rawValue);
    flags.push(`--${flag} ${quote(value)}`);
  }

  return flags;
};

const runOpenclaw = (command: string) => execSync(command, EXEC_OPTIONS).trim();

const parseJson = (raw: string) => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const normalizeJobsList = (payload: unknown): CronJob[] => {
  if (Array.isArray(payload)) return payload as CronJob[];
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const candidates = ["jobs", "items", "data", "result"];
    for (const key of candidates) {
      const value = record[key];
      if (Array.isArray(value)) return value as CronJob[];
    }
  }
  return [];
};

const getExecDetails = (error: ExecError) => {
  const detail = error.stderr ?? error.stdout;
  if (!detail) return undefined;
  if (typeof detail === "string") return detail.trim();
  return detail.toString("utf8").trim();
};

const errorResponse = (error: unknown, fallback: string, status = 500) => {
  const message = error instanceof Error ? error.message : fallback;
  const details = error instanceof Error ? getExecDetails(error as ExecError) : undefined;
  return NextResponse.json({ error: message, details }, { status });
};

const getJobById = (jobs: CronJob[], id: string) => {
  const normalized = id.trim();
  if (!normalized) return null;
  return (
    jobs.find((job) => {
      const jobId = job.id ?? job.jobId ?? job.name ?? job.slug;
      return typeof jobId === "string" && jobId === normalized;
    }) ??
    jobs.find((job) => {
      const jobName = job.name;
      return typeof jobName === "string" && jobName === normalized;
    }) ??
    null
  );
};

const listJobs = () => {
  const raw = runOpenclaw("openclaw cron list --json");
  const parsed = parseJson(raw);
  if (!parsed) {
    throw new Error("Failed to parse OpenClaw response");
  }
  return normalizeJobsList(parsed);
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const jobs = listJobs();
    const job = getJobById(jobs, id);

    if (!job) {
      return NextResponse.json({ error: "Cron job not found" }, { status: 404 });
    }

    return NextResponse.json(job);
  } catch (error) {
    return errorResponse(error, "Failed to load cron job");
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: CronRequestBody;

  try {
    body = (await request.json()) as CronRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const results: Array<{ action: string; result: unknown }> = [];

  try {
    if (typeof body.enabled === "boolean") {
      const command = body.enabled
        ? `openclaw cron enable --id ${quote(id)}`
        : `openclaw cron disable --id ${quote(id)}`;
      const raw = runOpenclaw(command);
      results.push({ action: body.enabled ? "enable" : "disable", result: parseJson(raw) ?? raw });
    }

    const { enabled: _enabled, ...rest } = body;
    const flags = buildFlags(rest);

    if (flags.length > 0) {
      const command = `openclaw cron edit --id ${quote(id)} ${flags.join(" ")}`;
      const raw = runOpenclaw(command);
      results.push({ action: "edit", result: parseJson(raw) ?? raw });
    }

    if (results.length === 0) {
      return NextResponse.json({ error: "No job fields provided" }, { status: 400 });
    }

    return NextResponse.json({ ok: true, results });
  } catch (error) {
    return errorResponse(error, "Failed to update cron job");
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const raw = runOpenclaw(`openclaw cron rm --id ${quote(id)}`);
    return NextResponse.json({ ok: true, result: parseJson(raw) ?? raw });
  } catch (error) {
    return errorResponse(error, "Failed to delete cron job");
  }
}
