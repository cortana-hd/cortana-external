import fs from "node:fs";

export function parseUniverseSourceLadder(raw: string): string[] {
  const parsed = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .filter((value) => ["remote_json", "local_json", "python_seed"].includes(value));
  return parsed.length ? parsed : ["python_seed"];
}

export function extractUniverseSymbols(payload: unknown): string[] {
  const rows = extractUniverseRows(payload);
  const symbols = rows
    .map((value) => String(value ?? "").trim().toUpperCase().replaceAll(".", "-"))
    .filter(Boolean)
    .filter((value) => /^[A-Z0-9\-^]+$/.test(value));
  if (!symbols.length) {
    throw new Error("Universe payload did not contain any valid symbols");
  }
  return dedupe(symbols);
}

export function readJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

export function dedupe(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function parseSharedStateNotification(payload: string | undefined): { updatedAt?: string } | null {
  if (!payload) {
    return null;
  }
  try {
    const parsed = JSON.parse(payload) as { updatedAt?: string };
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function extractUniverseRows(payload: unknown): string[] {
  if (Array.isArray(payload)) {
    return payload.map((value) => String(value));
  }
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.symbols)) {
      return record.symbols.map((value) => String(value));
    }
    if (record.data && typeof record.data === "object" && Array.isArray((record.data as Record<string, unknown>).symbols)) {
      return ((record.data as Record<string, unknown>).symbols as unknown[]).map((value) => String(value));
    }
  }
  throw new Error("Universe payload format is unsupported");
}
