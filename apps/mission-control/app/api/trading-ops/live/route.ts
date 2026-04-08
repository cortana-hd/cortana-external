import { NextResponse } from "next/server";
import { loadTradingOpsLiveData } from "@/lib/trading-ops-live";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const data = await loadTradingOpsLiveData();
  return NextResponse.json(data, {
    headers: {
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    },
  });
}
