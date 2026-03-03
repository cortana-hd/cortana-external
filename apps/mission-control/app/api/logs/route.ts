import { NextResponse } from "next/server";
import { LogFilters, getLogEntries } from "@/lib/logs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const parseNumber = (value: string | null) => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const parseFilter = (value: string | null) => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "all") return undefined;
  return trimmed;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const filters: LogFilters = {
    rangeHours: parseNumber(searchParams.get("rangeHours")),
    limit: parseNumber(searchParams.get("limit")),
    severity: parseFilter(searchParams.get("severity")),
    source: parseFilter(searchParams.get("source")),
    eventType: parseFilter(searchParams.get("eventType")),
    query: parseFilter(searchParams.get("query")),
  };

  const payload = await getLogEntries(filters);

  return NextResponse.json(payload, {
    headers: {
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    },
  });
}
