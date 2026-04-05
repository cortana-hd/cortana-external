import { Hono } from "hono";

import { AppleHealthService } from "./service.js";

export function createAppleHealthRouter(service: AppleHealthService): Hono {
  const router = new Hono();

  router.get("/apple-health/health", async (c) => {
    const result = await service.handleHealth();
    return c.json(result.body, result.status as never);
  });

  router.get("/apple-health/data", async (c) => {
    const result = await service.handleData();
    if (result.warning) {
      c.header("Warning", result.warning);
    }
    return c.json(result.body, result.status as never);
  });

  return router;
}
