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
  enabled: "enabled",
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

export async function GET() {
  try {
    const raw = runOpenclaw("openclaw cron list --json");
    const parsed = parseJson(raw);
    if (!parsed) {
      return NextResponse.json(
        { error: "Failed to parse OpenClaw response", details: raw || undefined },
        { status: 502 }
      );
    }

    return NextResponse.json({ jobs: normalizeJobsList(parsed) });
  } catch (error) {
    return errorResponse(error, "Failed to list cron jobs");
  }
}

export async function POST(request: Request) {
  let body: CronRequestBody;

  try {
    body = (await request.json()) as CronRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const flags = buildFlags(body);
  if (flags.length === 0) {
    return NextResponse.json({ error: "No job fields provided" }, { status: 400 });
  }

  const command = `openclaw cron add ${flags.join(" ")}`;

  try {
    const raw = runOpenclaw(command);
    const parsed = parseJson(raw);
    return NextResponse.json({ ok: true, result: parsed ?? raw });
  } catch (error) {
    return errorResponse(error, "Failed to create cron job");
  }
}
