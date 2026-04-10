import { loadTradingOpsPolymarketLiveData } from "@/lib/trading-ops-polymarket-live";

export async function GET() {
  const data = await loadTradingOpsPolymarketLiveData();
  return Response.json(data);
}
