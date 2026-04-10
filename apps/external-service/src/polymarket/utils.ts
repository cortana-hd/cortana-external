import type { SportsFocusFilters } from "./types.js";

export function normalizeRootBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/u, "");
}

export function normalizeGatewayBaseUrl(baseUrl: string): string {
  return normalizeRootBaseUrl(baseUrl).replace(/\/v1$/u, "");
}

export function normalizeOptionalString(value: string | undefined): string {
  return value?.trim() ?? "";
}

export function parsePositiveInt(raw: string | undefined, fallback?: number): number | undefined {
  if (!raw?.trim()) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("limit must be a positive integer");
  }
  return parsed;
}

export function parseSlugs(raw: string | undefined): string[] | undefined {
  if (!raw?.trim()) {
    return undefined;
  }

  const slugs = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return slugs.length > 0 ? slugs : undefined;
}

export function parseNonNegativeNumber(raw: string | undefined, fieldName: string): number | null {
  if (!raw?.trim()) {
    return null;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${fieldName} must be a non-negative number`);
  }

  return parsed;
}

export function parseSportsSort(raw: string | undefined): SportsFocusFilters["sort"] {
  const value = raw?.trim().toLowerCase();
  if (!value) {
    return "composite";
  }

  if (
    value === "composite" ||
    value === "liquidity" ||
    value === "volume" ||
    value === "open_interest" ||
    value === "nearest_start_time"
  ) {
    return value;
  }

  throw new Error("sort must be one of composite, liquidity, volume, open_interest, nearest_start_time");
}

export function compareDescending(left: number | null | undefined, right: number | null | undefined): number {
  const a = left ?? -1;
  const b = right ?? -1;
  return b - a;
}

export function compareAscendingNullable(left: number | null | undefined, right: number | null | undefined): number {
  const a = left ?? Number.POSITIVE_INFINITY;
  const b = right ?? Number.POSITIVE_INFINITY;
  return a - b;
}

export function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function compactStrings(values: Array<string | null | undefined>): string[] {
  return values.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

export function normalizeMarketTitle(value: string | null | undefined): string {
  return (value ?? "").trim().toLocaleLowerCase("en-US");
}

export function hoursUntil(isoTimestamp: string): number | null {
  const timestamp = Date.parse(isoTimestamp);
  if (Number.isNaN(timestamp)) {
    return null;
  }
  return (timestamp - Date.now()) / 3_600_000;
}
