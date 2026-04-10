import { loadTradingOpsPolymarketData } from "@/lib/trading-ops-polymarket";

export async function GET() {
  const data = await loadTradingOpsPolymarketData();
  return Response.json(data);
}
