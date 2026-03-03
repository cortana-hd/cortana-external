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

const normalizeRuns = (payload: unknown) => {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const candidates = ["runs", "items", "data", "result"];
    for (const key of candidates) {
      const value = record[key];
      if (Array.isArray(value)) return value;
    }
  }
  return payload;
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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const raw = runOpenclaw(`openclaw cron runs --id ${quote(id)} --limit 20`);
    const parsed = parseJson(raw);

    if (!parsed) {
      return NextResponse.json({ runs: [], raw });
    }

    return NextResponse.json({ runs: normalizeRuns(parsed) });
  } catch (error) {
    return errorResponse(error, "Failed to fetch cron runs");
  }
}
