import type { Hono } from "hono";

import type { AppConfig } from "../config.js";
import { createLogger } from "../lib/logger.js";
import { registerPolymarketRoutes as registerRoutes } from "./routes.js";
import { PolymarketPinsStore } from "./pins.js";
import { PolymarketService } from "./service.js";

export function createPolymarketService(config: AppConfig): PolymarketService {
  return new PolymarketService({
    apiBaseUrl: config.POLYMARKET_API_BASE_URL,
    gatewayBaseUrl: config.POLYMARKET_PUBLIC_BASE_URL,
    keyId: config.POLYMARKET_KEY_ID || config.POLYMARKET_CLIENT_KEY || config.POLYMARKET_API_KEY,
    secretKey: config.POLYMARKET_SECRET_KEY || config.POLYMARKET_SECRET,
    timeoutMs: config.POLYMARKET_REQUEST_TIMEOUT_MS,
    logger: createLogger("polymarket"),
    pinsStore: new PolymarketPinsStore(config.POLYMARKET_PINNED_MARKETS_PATH),
  });
}

export function registerPolymarketRoutes(app: Hono, service: PolymarketService): void {
  registerRoutes(app, service);
}

export { PolymarketService } from "./service.js";
