import fs from "node:fs";
import https from "node:https";
import { createAdaptorServer, serve } from "@hono/node-server";

import { createApplication } from "./app.js";
import { getConfig } from "./config.js";
import { createLogger } from "./lib/logger.js";
import { ensurePortAvailable } from "./lib/port.js";

const startupLogger = createLogger("startup");
const refreshLogger = createLogger("refresh");
const shutdownLogger = createLogger("shutdown");

function withTimeout(timeoutMs: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timeout),
  };
}

async function main(): Promise<void> {
  const config = getConfig();
  await ensurePortAvailable(config.PORT);
  const tlsCertPath = config.EXTERNAL_SERVICE_TLS_CERT_PATH.trim();
  const tlsKeyPath = config.EXTERNAL_SERVICE_TLS_KEY_PATH.trim();
  const tlsEnabled = Boolean(tlsCertPath && tlsKeyPath);
  if (tlsEnabled) {
    await ensurePortAvailable(config.EXTERNAL_SERVICE_TLS_PORT);
  }

  const { app, services } = createApplication();

  try {
    await services.marketData.startup();
    startupLogger.log("market-data startup ok");
  } catch (error) {
    startupLogger.error("market-data startup failed", error);
  }

  const whoopWarmup = withTimeout(20_000);
  try {
    await services.whoop.warmup();
    startupLogger.log("whoop warmup ok");
  } catch (error) {
    startupLogger.error("whoop warmup failed", error);
  } finally {
    whoopWarmup.cancel();
  }

  const tonalWarmup = withTimeout(20_000);
  try {
    await services.tonal.warmup(tonalWarmup.signal);
    startupLogger.log("tonal warmup ok");
  } catch (error) {
    startupLogger.error("tonal warmup failed", error);
  } finally {
    tonalWarmup.cancel();
  }

  let maintenanceRunning = false;
  const maintenanceInterval = setInterval(async () => {
    if (maintenanceRunning) {
      return;
    }
    maintenanceRunning = true;

    const whoopTimeout = withTimeout(20_000);
    try {
      await services.whoop.proactiveRefreshIfExpiring(60 * 60 * 1000);
      refreshLogger.log("whoop proactive refresh check completed");
    } catch (error) {
      refreshLogger.error("whoop proactive refresh failed", error);
    } finally {
      whoopTimeout.cancel();
    }

    const tonalTimeout = withTimeout(20_000);
    try {
      await services.tonal.proactiveRefreshIfExpiring(tonalTimeout.signal, 60 * 60 * 1000);
      refreshLogger.log("tonal proactive refresh check completed");
    } catch (error) {
      refreshLogger.error("tonal proactive refresh failed", error);
    } finally {
      tonalTimeout.cancel();
      maintenanceRunning = false;
    }
  }, 30 * 60 * 1000);

  const server = serve({
    fetch: app.fetch,
    hostname: "127.0.0.1",
    port: config.PORT,
  });

  let tlsServer: ReturnType<typeof createAdaptorServer> | null = null;
  if (tlsEnabled) {
    const cert = fs.readFileSync(tlsCertPath);
    const key = fs.readFileSync(tlsKeyPath);
    tlsServer = createAdaptorServer({
      fetch: app.fetch,
      createServer: https.createServer,
      serverOptions: { cert, key },
    });
    tlsServer.listen(config.EXTERNAL_SERVICE_TLS_PORT, "127.0.0.1");
  }

  startupLogger.log(`Starting server on 127.0.0.1:${config.PORT}`);
  if (tlsEnabled) {
    startupLogger.log(`Starting TLS server on 127.0.0.1:${config.EXTERNAL_SERVICE_TLS_PORT}`);
  }

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    shutdownLogger.log("draining connections...");
    clearInterval(maintenanceInterval);
    await services.marketData.shutdown().catch((error) => {
      shutdownLogger.error("market-data shutdown failed", error);
    });
    tlsServer?.close();
    server.close(() => {
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => {
    void shutdown();
  });
  process.on("SIGINT", () => {
    void shutdown();
  });
}

void main().catch((error) => {
  startupLogger.error("startup aborted", error);
  process.exit(1);
});
