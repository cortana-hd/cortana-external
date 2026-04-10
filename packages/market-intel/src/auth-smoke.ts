#!/usr/bin/env node
import { AuthenticationError, PolymarketUS, PolymarketUSError, RateLimitError } from "polymarket-us";

import { getMarketIntelRuntimeConfig, requirePolymarketCredentials } from "./runtime-config.js";

async function main() {
  const config = getMarketIntelRuntimeConfig();
  const credentials = requirePolymarketCredentials();
  const client = new PolymarketUS({
    keyId: credentials.keyId,
    secretKey: credentials.secretKey,
    gatewayBaseUrl: normalizeGatewayBaseUrl(config.polymarketPublicBaseUrl),
    apiBaseUrl: normalizeRootBaseUrl(config.polymarketApiBaseUrl),
    timeout: 15_000,
  });

  const [balances, positions, openOrders, markets] = await Promise.all([
    client.account.balances(),
    client.portfolio.positions({ limit: 25 }),
    client.orders.list(),
    client.markets.list({ limit: 1, active: true }),
  ]);

  console.log(
    JSON.stringify(
      {
        ok: true,
        apiBaseUrl: normalizeRootBaseUrl(config.polymarketApiBaseUrl),
        gatewayBaseUrl: normalizeGatewayBaseUrl(config.polymarketPublicBaseUrl),
        keyIdSuffix: credentials.keyId.slice(-6),
        marketSample: markets.markets[0]?.slug ?? null,
        balances: balances.balances.map((balance) => ({
          currency: balance.currency,
          currentBalance: balance.currentBalance,
          buyingPower: balance.buyingPower,
        })),
        positionCount: Object.keys(positions.positions).length,
        openOrdersCount: openOrders.orders.length,
      },
      null,
      2,
    ),
  );
}

function normalizeGatewayBaseUrl(baseUrl: string): string {
  return normalizeRootBaseUrl(baseUrl).replace(/\/v1$/u, "");
}

function normalizeRootBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/u, "");
}

main().catch((error) => {
  if (error instanceof AuthenticationError) {
    console.error("Polymarket US authentication failed. Check POLYMARKET_KEY_ID and POLYMARKET_SECRET_KEY.");
    process.exit(1);
  }

  if (error instanceof RateLimitError) {
    console.error("Polymarket US rate limit hit during auth smoke. Retry in a few seconds.");
    process.exit(1);
  }

  if (error instanceof PolymarketUSError) {
    console.error(error.message);
    process.exit(1);
  }

  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
