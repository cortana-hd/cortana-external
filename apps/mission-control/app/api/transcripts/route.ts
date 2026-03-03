import { NextResponse } from "next/server";
import { TranscriptFilters, getTranscriptMessages } from "@/lib/transcripts";

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

  const filters: TranscriptFilters = {
    rangeHours: parseNumber(searchParams.get("rangeHours")),
    limit: parseNumber(searchParams.get("limit")),
    sessionId: parseFilter(searchParams.get("sessionId")),
    speakerId: parseFilter(searchParams.get("speakerId")),
    messageType: parseFilter(searchParams.get("messageType")),
    query: parseFilter(searchParams.get("query")),
  };

  const payload = await getTranscriptMessages(filters);

  return NextResponse.json(payload, {
    headers: {
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    },
  });
}
