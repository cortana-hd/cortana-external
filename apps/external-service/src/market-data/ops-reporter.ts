import path from "node:path";

import type { ProviderMetrics, SchwabRestClient } from "./schwab-rest-client.js";
import type { MarketDataUniverse } from "./types.js";
import type { UniverseAuditEntry } from "./universe-manager.js";
import type { SchwabStreamerRuntime } from "./schwab-streamer-runtime.js";

interface HealthReportArgs {
  coinMarketCapConfigured: boolean;
  schwabConfigured: boolean;
  fredConfigured: boolean;
  streamerRuntime: SchwabStreamerRuntime;
  providerMetrics: ProviderMetrics;
  universeSourceLadder: string[];
  universeRemoteJsonUrl: string;
  universeLocalJsonPath: string | null;
}

interface OpsPayloadArgs {
  cacheDir: string;
  latestUniverse: MarketDataUniverse | null;
  universeAudit: UniverseAuditEntry[];
  providerMetrics: ProviderMetrics;
  health: Record<string, unknown>;
  streamerRuntime: SchwabStreamerRuntime;
  serviceOperatorState: string;
  serviceOperatorAction: string;
  universeSourceLadder: string[];
}

export async function buildHealthReport(args: HealthReportArgs): Promise<Record<string, unknown>> {
  const sharedState = await args.streamerRuntime.readSharedState();
  const streamerHealth = args.streamerRuntime.getStreamer()?.getHealth() ?? sharedState?.health ?? null;
  return {
    status: "healthy",
    providers: {
      coinmarketcap: args.coinMarketCapConfigured ? "configured" : "disabled",
      schwab: args.schwabConfigured ? "configured" : "disabled",
      schwabStreamer: args.streamerRuntime.getStreamer() ? "enabled" : "disabled",
      schwabStreamerMeta: streamerHealth,
      schwabStreamerRole: args.streamerRuntime.getActiveRole(),
      schwabStreamerRoleConfigured: args.streamerRuntime.getConfiguredRole(),
      schwabStreamerPgLockKey: args.streamerRuntime.getStreamerPgLockKey(),
      schwabStreamerSharedStateBackend: args.streamerRuntime.getSharedStateBackend(),
      schwabStreamerSharedStatePath: args.streamerRuntime.getSharedStatePath(),
      schwabStreamerSharedStateUpdatedAt: sharedState?.updatedAt ?? null,
      schwabTokenStatus: args.providerMetrics.schwabTokenStatus,
      schwabTokenReason: args.providerMetrics.schwabTokenReason,
      fred: args.fredConfigured ? "configured" : "unauthenticated",
      universeSourceLadder: args.universeSourceLadder,
      universeRemoteJsonUrl: args.universeRemoteJsonUrl || null,
      universeLocalJsonPath: args.universeLocalJsonPath,
      providerMetrics: args.providerMetrics,
    },
  };
}

export function getServiceOperatorState(schwabRestClient: SchwabRestClient): string {
  return schwabRestClient.getOperatorState();
}

export function getServiceOperatorAction(schwabRestClient: SchwabRestClient): string {
  return schwabRestClient.getOperatorAction();
}

export async function buildOpsPayload(args: OpsPayloadArgs): Promise<Record<string, unknown>> {
  const sharedState = await args.streamerRuntime.readSharedState();
  const streamerHealth = args.streamerRuntime.getStreamer()?.getHealth() ?? sharedState?.health ?? null;
  const streamerConnected = Boolean((streamerHealth as { connected?: unknown } | null)?.connected);
  const restCooldownActive =
    args.serviceOperatorState === "provider_cooldown" || Boolean(args.providerMetrics.schwabCooldownUntil);
  const historyLaneMode = restCooldownActive ? "cache_or_alpaca_fallback" : "schwab_primary";
  const historyLaneReason = restCooldownActive
    ? "Schwab REST is cooling down, so history callers should prefer recent Schwab cache first and Alpaca only where explicitly allowed."
    : "Schwab REST is healthy enough for primary history reads.";
  const liveQuoteLaneMode = streamerConnected ? "schwab_primary" : restCooldownActive ? "alpaca_fallback" : "schwab_primary";
  const liveQuoteLaneReason = streamerConnected
    ? "Live quote lane is using the Schwab streamer primary path."
    : restCooldownActive
      ? "Streamer is not connected and Schwab REST is cooling down; approved live quote subsystems may need Alpaca fallback."
      : "Live quote lane is relying on Schwab REST/shared state because the streamer is not connected.";
  return {
    streamerRoleConfigured: args.streamerRuntime.getConfiguredRole(),
    streamerRoleActive: args.streamerRuntime.getActiveRole(),
    streamerLockHeld: args.streamerRuntime.isLeaderLockHeld(),
    serviceOperatorState: args.serviceOperatorState,
    serviceOperatorAction: args.serviceOperatorAction,
    sharedStateBackend: args.streamerRuntime.getSharedStateBackend(),
    sharedStateUpdatedAt: await args.streamerRuntime.getSharedStateUpdatedAt(),
    providerMetrics: args.providerMetrics,
    providerLaneGuidance: {
      liveQuotes: {
        providerMode: liveQuoteLaneMode,
        fallbackEngaged: liveQuoteLaneMode !== "schwab_primary",
        providerModeReason: liveQuoteLaneReason,
      },
      history: {
        providerMode: historyLaneMode,
        fallbackEngaged: historyLaneMode !== "schwab_primary",
        providerModeReason: historyLaneReason,
      },
      fundamentals: {
        providerMode: "schwab_primary",
        fallbackEngaged: false,
        providerModeReason: "Fundamentals remain on the Schwab-primary-or-cache lane.",
      },
      metadata: {
        providerMode: "schwab_primary",
        fallbackEngaged: false,
        providerModeReason: "Metadata remains on the Schwab-primary-or-cache lane.",
      },
    },
    health: args.health,
    universe: {
      latest: args.latestUniverse,
      audit: args.universeAudit,
      ownership: {
        artifactPath: path.join(args.cacheDir, "base-universe.json"),
        auditPath: path.join(args.cacheDir, "base-universe-audit.jsonl"),
        sourceLadder: args.universeSourceLadder,
        refreshPolicy: "TS owns the artifact refresh path; the bundled S&P artifact is the default base-universe source.",
      },
    },
  };
}
