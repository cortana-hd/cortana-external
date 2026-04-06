import { Hono } from "hono";

import { AppleHealthService } from "./service.js";

const MAX_BODY_SIZE = 1024 * 1024;

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

  router.post("/apple-health/import", async (c) => {
    if (!service.validateToken(c.req.header("authorization"))) {
      return c.json({ error: "unauthorized" }, 401 as never);
    }

    const contentLength = Number(c.req.header("content-length") ?? "0");
    if (contentLength > MAX_BODY_SIZE) {
      return c.json({ error: "payload too large" }, 413 as never);
    }

    try {
      const result = await service.handleImport(await c.req.json());
      return c.json(result.body, result.status as never);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        return c.json({ error: "validation failed" }, 400 as never);
      }
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500 as never);
    }
  });

  return router;
}
