import { TradingOpsDashboard } from "@/components/trading-ops-dashboard";
import { loadTradingOpsDashboardData } from "@/lib/trading-ops";

export const dynamic = "force-dynamic";

export default async function TradingOpsPage() {
  const data = await loadTradingOpsDashboardData();
  return <TradingOpsDashboard data={data} />;
}
