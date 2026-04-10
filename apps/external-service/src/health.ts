export type HealthState = "healthy" | "unhealthy" | "ok" | "degraded" | "unconfigured";

export interface AggregateHealthInput {
  whoop: Record<string, unknown>;
  tonal: Record<string, unknown>;
  alpaca: Record<string, unknown>;
  appleHealth: Record<string, unknown>;
  marketData: Record<string, unknown>;
  polymarket: Record<string, unknown>;
}

export interface AggregateHealthOutput extends AggregateHealthInput {
  status: "ok" | "degraded" | "unhealthy";
  statusCode: 200 | 503;
}

function statusOf(entry: Record<string, unknown>): HealthState | null {
  const status = entry.status;
  return status === "healthy" || status === "unhealthy" || status === "ok" || status === "degraded" || status === "unconfigured"
    ? status
    : null;
}

function isHealthy(entry: Record<string, unknown>): boolean {
  const status = statusOf(entry);
  return status === "healthy" || status === "ok";
}

export function buildAggregateHealth(input: AggregateHealthInput): AggregateHealthOutput {
  const required = [input.whoop, input.tonal, input.alpaca, input.marketData, input.polymarket];
  const requiredHealthyCount = required.filter(isHealthy).length;
  const appleHealthStatus = statusOf(input.appleHealth);

  const status: AggregateHealthOutput["status"] =
    requiredHealthyCount === required.length && (appleHealthStatus == null || appleHealthStatus === "healthy" || appleHealthStatus === "ok" || appleHealthStatus === "unconfigured")
      ? "ok"
      : requiredHealthyCount === 0
        ? "unhealthy"
        : "degraded";

  return {
    status,
    statusCode: status === "unhealthy" ? 503 : 200,
    whoop: input.whoop,
    tonal: input.tonal,
    alpaca: input.alpaca,
    appleHealth: input.appleHealth,
    marketData: input.marketData,
    polymarket: input.polymarket,
  };
}
