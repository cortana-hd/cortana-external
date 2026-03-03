import { execSync, type ExecSyncOptionsWithStringEncoding } from "node:child_process";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const EXEC_OPTIONS: ExecSyncOptionsWithStringEncoding = {
  encoding: "utf8",
  timeout: 15000,
  stdio: ["ignore", "pipe", "pipe"],
};

type ExecError = Error & { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };

type ToggleBody = { enabled?: boolean };

const quote = (value: unknown) => {
  const stringified = typeof value === "string" ? value : JSON.stringify(value);
  return `'${stringified.replace(/'/g, `'\\''`)}'`;
};

const runOpenclaw = (command: string) => execSync(command, EXEC_OPTIONS).trim();

const parseJson = (raw: string) => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: ToggleBody;

  try {
    body = (await request.json()) as ToggleBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "Missing enabled boolean" }, { status: 400 });
  }

  try {
    const command = body.enabled
      ? `openclaw cron enable --id ${quote(id)}`
      : `openclaw cron disable --id ${quote(id)}`;
    const raw = runOpenclaw(command);
    return NextResponse.json({ ok: true, enabled: body.enabled, result: parseJson(raw) ?? raw });
  } catch (error) {
    return errorResponse(error, "Failed to toggle cron job");
  }
}
