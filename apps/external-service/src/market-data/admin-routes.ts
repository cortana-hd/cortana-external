import path from "node:path";

import { buildOpsPayload, getServiceOperatorAction, getServiceOperatorState } from "./ops-reporter.js";
import type { MarketDataGovernanceReporter } from "./governance-reporter.js";
import type { ProviderMetrics, SchwabRestClient } from "./schwab-rest-client.js";
import type { MarketDataRouteResult, MarketDataUniverse } from "./types.js";
import type { UniverseArtifactManager } from "./universe-manager.js";
import type { SchwabStreamerRuntime } from "./schwab-streamer-runtime.js";
import { readJsonFile } from "./universe-utils.js";

interface MarketDataAdminRoutesConfig {
  cacheDir: string;
  universeSourceLadder: string[];
  providerMetrics: ProviderMetrics;
  universeManager: UniverseArtifactManager;
  streamerRuntime: SchwabStreamerRuntime;
  schwabRestClient: SchwabRestClient;
  governanceReporter: MarketDataGovernanceReporter;
  checkHealth: () => Promise<Record<string, unknown>>;
  ensureRuntimeReady: () => Promise<void>;
  enforceStreamerFailurePolicy: () => Promise<void>;
  toErrorRoute: <T>(error: unknown, data: T) => MarketDataRouteResult<T>;
}

export class MarketDataAdminRoutes {
  private readonly cacheDir: string;
  private readonly universeSourceLadder: string[];
  private readonly providerMetrics: ProviderMetrics;
  private readonly universeManager: UniverseArtifactManager;
  private readonly streamerRuntime: SchwabStreamerRuntime;
  private readonly schwabRestClient: SchwabRestClient;
  private readonly governanceReporter: MarketDataGovernanceReporter;
  private readonly checkHealth: () => Promise<Record<string, unknown>>;
  private readonly ensureRuntimeReady: () => Promise<void>;
  private readonly enforceStreamerFailurePolicy: () => Promise<void>;
  private readonly toErrorRoute: <T>(error: unknown, data: T) => MarketDataRouteResult<T>;

  constructor(config: MarketDataAdminRoutesConfig) {
    this.cacheDir = config.cacheDir;
    this.universeSourceLadder = config.universeSourceLadder;
    this.providerMetrics = config.providerMetrics;
    this.universeManager = config.universeManager;
    this.streamerRuntime = config.streamerRuntime;
    this.schwabRestClient = config.schwabRestClient;
    this.governanceReporter = config.governanceReporter;
    this.checkHealth = config.checkHealth;
    this.ensureRuntimeReady = config.ensureRuntimeReady;
    this.enforceStreamerFailurePolicy = config.enforceStreamerFailurePolicy;
    this.toErrorRoute = config.toErrorRoute;
  }

  async handleOps(): Promise<MarketDataRouteResult<Record<string, unknown>>> {
    await this.ensureRuntimeReady();
    await this.enforceStreamerFailurePolicy();
    const health = await this.checkHealth();
    const streamerMeta =
      (((health.providers as Record<string, unknown> | undefined)?.schwabStreamerMeta as Record<string, unknown> | undefined) ?? {});
    const latestUniverse = readJsonFile<MarketDataUniverse>(path.join(this.cacheDir, "base-universe.json"));
    const universeAudit = this.universeManager.readAudit(5);
    const serviceOperatorState = getServiceOperatorState(this.schwabRestClient);
    const serviceOperatorAction = getServiceOperatorAction(this.schwabRestClient);
    await this.governanceReporter.reconcile({
      serviceOperatorState,
      serviceOperatorAction,
      streamerOperatorState: String(streamerMeta.operatorState ?? "healthy"),
      streamerOperatorAction: String(streamerMeta.operatorAction ?? "No operator action required."),
      health,
    });
    return {
      status: 200,
      body: {
        source: "service",
        status: "ok",
        degradedReason: null,
        stalenessSeconds: 0,
        providerMode: "schwab_primary",
        fallbackEngaged: false,
        providerModeReason: "Ops reporting is reflecting the current primary service lanes.",
        data: await buildOpsPayload({
          cacheDir: this.cacheDir,
          latestUniverse,
          universeAudit,
          providerMetrics: this.providerMetrics,
          health,
          streamerRuntime: this.streamerRuntime,
          serviceOperatorState,
          serviceOperatorAction,
          universeSourceLadder: this.universeSourceLadder,
        }),
      },
    };
  }

  async handleReady(): Promise<MarketDataRouteResult<Record<string, unknown>>> {
    try {
      const health = await this.checkHealth();
      const streamerMeta =
        (((health.providers as Record<string, unknown> | undefined)?.schwabStreamerMeta as Record<string, unknown> | undefined) ?? {});
      const streamerOperatorState = String(streamerMeta.operatorState ?? "healthy");
      const streamerOperatorAction = String(streamerMeta.operatorAction ?? "No operator action required.");
      const serviceOperatorState = getServiceOperatorState(this.schwabRestClient);
      const serviceOperatorAction = getServiceOperatorAction(this.schwabRestClient);
      await this.governanceReporter.reconcile({
        serviceOperatorState,
        serviceOperatorAction,
        streamerOperatorState,
        streamerOperatorAction,
        health,
      });
      const operatorState = serviceOperatorState !== "healthy" ? serviceOperatorState : streamerOperatorState;
      const ready = !["human_action_required", "max_connections_blocked"].includes(operatorState);
      return {
        status: ready ? 200 : 503,
        body: {
          source: "service",
          status: ready ? "ok" : "degraded",
          degradedReason: ready ? null : `service not ready (${operatorState})`,
          stalenessSeconds: 0,
          providerMode: "schwab_primary",
          fallbackEngaged: false,
          providerModeReason: "Readiness reflects the current primary service lane health.",
          data: {
            ready,
            checkedAt: new Date().toISOString(),
            operatorState,
            operatorAction:
              serviceOperatorState !== "healthy"
                ? serviceOperatorAction
                : streamerOperatorAction,
          },
        },
      };
    } catch (healthError) {
      return this.toErrorRoute(healthError, {
        ready: false,
        checkedAt: new Date().toISOString(),
      });
    }
  }
}
