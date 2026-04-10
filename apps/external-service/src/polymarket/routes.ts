import type { Hono } from "hono";

import { PolymarketService } from "./service.js";

export function registerPolymarketRoutes(app: Hono, service: PolymarketService): void {
  app.get("/polymarket/health", (c) => service.healthHandler(c));
  app.get("/polymarket/balances", (c) => service.balancesHandler(c));
  app.get("/polymarket/positions", (c) => service.positionsHandler(c));
  app.get("/polymarket/orders", (c) => service.ordersHandler(c));
  app.get("/polymarket/focus", (c) => service.focusHandler(c));
  app.get("/polymarket/pins", (c) => service.listPinsHandler(c));
  app.post("/polymarket/pins", (c) => service.addPinHandler(c));
  app.delete("/polymarket/pins/:marketSlug", (c) => service.removePinHandler(c));
  app.get("/polymarket/results", (c) => service.resultsHandler(c));
  app.get("/polymarket/live", (c) => service.liveHandler(c));
  app.get("/polymarket/board/live", (c) => service.boardLiveHandler(c));
}
