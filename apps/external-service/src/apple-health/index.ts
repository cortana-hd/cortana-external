import type { Hono } from "hono";

import type { AppConfig } from "../config.js";
import { createLogger } from "../lib/logger.js";
import { createAppleHealthRouter } from "./routes.js";
import { AppleHealthService } from "./service.js";

export function createAppleHealthService(config: AppConfig): AppleHealthService {
  return new AppleHealthService({
    dataPath: config.APPLE_HEALTH_DATA_PATH,
    maxAgeMs: config.APPLE_HEALTH_MAX_AGE_HOURS * 60 * 60 * 1000,
    logger: createLogger("apple-health"),
  });
}

export function registerAppleHealthRoutes(app: Hono, service: AppleHealthService): void {
  app.route("/", createAppleHealthRouter(service));
}

export { AppleHealthService } from "./service.js";
