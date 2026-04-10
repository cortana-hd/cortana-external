import { promises as fs } from "node:fs";
import path from "node:path";
import prisma from "@/lib/prisma";

const TRADING_RUN_SYNC_LIMIT = 40;

export type TradingRunStateRecord = {
  runId: string;
  schemaVersion: number;
  strategy: string;
  status: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  notifiedAt: string | null;
  deliveryStatus: string | null;
  decision: string | null;
  confidence: number | null;
  risk: string | null;
  correctionMode: boolean | null;
  buyCount: number | null;
  watchCount: number | null;
  noBuyCount: number | null;
  symbolsScanned: number | null;
  candidatesEvaluated: number | null;
  focusTicker: string | null;
  focusAction: string | null;
  focusStrategy: string | null;
  dipBuyerBuy: string[];
  dipBuyerWatch: string[];
  dipBuyerNoBuy: string[];
  canslimBuy: string[];
  canslimWatch: string[];
  canslimNoBuy: string[];
  artifactDirectory: string | null;
  summaryPath: string | null;
  messagePath: string | null;
  watchlistPath: string | null;
  messagePreview: string | null;
  metrics: Record<string, unknown> | null;
  lastError: string | null;
  sourceHost: string | null;
};

export type TradingRunStateStore = {
  syncFromArtifacts: (cortanaRepoPath: string) => Promise<string[]>;
  loadLatest: () => Promise<TradingRunStateRecord | null>;
};

type TradingRunArtifactRecord = {
  runId: string;
  schemaVersion: number;
  strategy: string;
  status: string;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  notifiedAt: Date | null;
  deliveryStatus: string | null;
  decision: string | null;
  confidence: number | null;
  risk: string | null;
  correctionMode: boolean | null;
  buyCount: number | null;
  watchCount: number | null;
  noBuyCount: number | null;
  symbolsScanned: number | null;
  candidatesEvaluated: number | null;
  focusTicker: string | null;
  focusAction: string | null;
  focusStrategy: string | null;
  dipBuyerBuy: string[];
  dipBuyerWatch: string[];
  dipBuyerNoBuy: string[];
  canslimBuy: string[];
  canslimWatch: string[];
  canslimNoBuy: string[];
  artifactDirectory: string | null;
  summaryPath: string | null;
  messagePath: string | null;
  watchlistPath: string | null;
  messagePreview: string | null;
  metrics: Record<string, unknown> | null;
  lastError: string | null;
  sourceHost: string | null;
};

export const prismaTradingRunStateStore = createPrismaTradingRunStateStore();

export function createPrismaTradingRunStateStore(client: typeof prisma = prisma): TradingRunStateStore {
  return {
    syncFromArtifacts: async (cortanaRepoPath: string) => {
      const delegate = client.tradingRunState;
      const runsRoot = path.join(cortanaRepoPath, "var", "backtests", "runs");
      const runDirs = await findLatestRunDirectories(runsRoot, TRADING_RUN_SYNC_LIMIT);
      const warnings: string[] = [];

      for (const entry of runDirs) {
        const artifactRecord = await parseTradingRunArtifact(entry.path, entry.runId);
        if (!artifactRecord) {
          warnings.push(`Skipping ${entry.runId}: summary.json is missing or invalid.`);
          continue;
        }

        await delegate.upsert({
          where: { runId: artifactRecord.runId },
          create: {
            runId: artifactRecord.runId,
            schemaVersion: artifactRecord.schemaVersion,
            strategy: artifactRecord.strategy,
            status: artifactRecord.status,
            createdAt: artifactRecord.createdAt,
            startedAt: artifactRecord.startedAt,
            completedAt: artifactRecord.completedAt,
            notifiedAt: artifactRecord.notifiedAt,
            deliveryStatus: artifactRecord.deliveryStatus,
            decision: artifactRecord.decision,
            confidence: artifactRecord.confidence,
            risk: artifactRecord.risk,
            correctionMode: artifactRecord.correctionMode,
            buyCount: artifactRecord.buyCount,
            watchCount: artifactRecord.watchCount,
            noBuyCount: artifactRecord.noBuyCount,
            symbolsScanned: artifactRecord.symbolsScanned,
            candidatesEvaluated: artifactRecord.candidatesEvaluated,
            focusTicker: artifactRecord.focusTicker,
            focusAction: artifactRecord.focusAction,
            focusStrategy: artifactRecord.focusStrategy,
            dipBuyerBuy: artifactRecord.dipBuyerBuy,
            dipBuyerWatch: artifactRecord.dipBuyerWatch,
            dipBuyerNoBuy: artifactRecord.dipBuyerNoBuy,
            canslimBuy: artifactRecord.canslimBuy,
            canslimWatch: artifactRecord.canslimWatch,
            canslimNoBuy: artifactRecord.canslimNoBuy,
            artifactDirectory: artifactRecord.artifactDirectory,
            summaryPath: artifactRecord.summaryPath,
            messagePath: artifactRecord.messagePath,
            watchlistPath: artifactRecord.watchlistPath,
            messagePreview: artifactRecord.messagePreview,
            metrics: artifactRecord.metrics ?? null,
            lastError: artifactRecord.lastError,
            sourceHost: artifactRecord.sourceHost,
          },
          update: {
            schemaVersion: artifactRecord.schemaVersion,
            strategy: artifactRecord.strategy,
            status: artifactRecord.status,
            createdAt: artifactRecord.createdAt,
            startedAt: artifactRecord.startedAt,
            completedAt: artifactRecord.completedAt,
            notifiedAt: artifactRecord.notifiedAt,
            deliveryStatus: artifactRecord.deliveryStatus,
            decision: artifactRecord.decision,
            confidence: artifactRecord.confidence,
            risk: artifactRecord.risk,
            correctionMode: artifactRecord.correctionMode,
            buyCount: artifactRecord.buyCount,
            watchCount: artifactRecord.watchCount,
            noBuyCount: artifactRecord.noBuyCount,
            symbolsScanned: artifactRecord.symbolsScanned,
            candidatesEvaluated: artifactRecord.candidatesEvaluated,
            focusTicker: artifactRecord.focusTicker,
            focusAction: artifactRecord.focusAction,
            focusStrategy: artifactRecord.focusStrategy,
            dipBuyerBuy: artifactRecord.dipBuyerBuy,
            dipBuyerWatch: artifactRecord.dipBuyerWatch,
            dipBuyerNoBuy: artifactRecord.dipBuyerNoBuy,
            canslimBuy: artifactRecord.canslimBuy,
            canslimWatch: artifactRecord.canslimWatch,
            canslimNoBuy: artifactRecord.canslimNoBuy,
            artifactDirectory: artifactRecord.artifactDirectory,
            summaryPath: artifactRecord.summaryPath,
            messagePath: artifactRecord.messagePath,
            watchlistPath: artifactRecord.watchlistPath,
            messagePreview: artifactRecord.messagePreview,
            metrics: artifactRecord.metrics ?? null,
            lastError: artifactRecord.lastError,
            sourceHost: artifactRecord.sourceHost,
          },
        });
      }

      return warnings;
    },
    loadLatest: async () => {
      const delegate = client.tradingRunState;
      const row = await delegate.findFirst({
        orderBy: [
          { createdAt: "desc" },
          { runId: "desc" },
        ],
      });
      return row ? mapRowToRecord(row) : null;
    },
  };
}

async function findLatestRunDirectories(rootPath: string, limit: number): Promise<Array<{ runId: string; path: string }>> {
  try {
    const entries = await fs.readdir(rootPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse()
      .slice(0, limit)
      .map((runId) => ({ runId, path: path.join(rootPath, runId) }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw error;
  }
}

async function parseTradingRunArtifact(runPath: string, runId: string): Promise<TradingRunArtifactRecord | null> {
  const summaryPath = path.join(runPath, "summary.json");
  const watchlistPath = path.join(runPath, "watchlist-full.json");
  const messagePath = path.join(runPath, "message.txt");
  const stderrPath = path.join(runPath, "stderr.txt");
  const [summary, watchlist, message, stderr] = await Promise.all([
    readJsonFile<Record<string, unknown>>(summaryPath),
    readJsonFile<Record<string, unknown>>(watchlistPath),
    readTextIfExists(messagePath),
    readTextIfExists(stderrPath),
  ]);

  const summaryData = summary.data;
  if (!summaryData) return null;

  const metrics = asRecord(summaryData.metrics);
  const watchlistData = watchlist.data;
  const watchlistSummary = asRecord(watchlistData?.summary);
  const focus = asRecord(watchlistData?.focus);
  const strategies = asRecord(watchlistData?.strategies);
  const dipBuyer = asRecord(strategies?.dipBuyer);
  const canslim = asRecord(strategies?.canslim);

  const createdAt =
    parseDateValue(summaryData.createdAt) ??
    parseDateValue(summaryData.startedAt) ??
    parseDateValue(summaryData.completedAt) ??
    parseDateValue(summaryData.finalizedAt) ??
    parseRunIdTimestamp(runId) ??
    new Date();
  const startedAt = parseDateValue(summaryData.startedAt);
  const completedAt = parseDateValue(summaryData.completedAt) ?? parseDateValue(summaryData.finalizedAt);
  const notifiedAt = parseDateValue(summaryData.notifiedAt);

  const normalizedStatus = stringValue(summaryData.status) ?? (completedAt ? "success" : "unknown");

  return {
    runId,
    schemaVersion: numberValue(summaryData.schemaVersion) ?? numberValue(summaryData.schema_version) ?? 1,
    strategy: stringValue(summaryData.strategy) ?? "Trading market-session unified",
    status: normalizedStatus,
    createdAt,
    startedAt,
    completedAt,
    notifiedAt,
    deliveryStatus: deriveDeliveryStatus(normalizedStatus, notifiedAt),
    decision: stringValue(watchlistData?.decision) ?? stringValue(metrics?.decision),
    confidence: numberValue(metrics?.confidence),
    risk: stringValue(metrics?.risk),
    correctionMode: booleanValue(watchlistData?.correctionMode) ?? booleanValue(metrics?.correctionMode),
    buyCount: numberValue(watchlistSummary?.buy) ?? numberValue(metrics?.buy),
    watchCount: numberValue(watchlistSummary?.watch) ?? numberValue(metrics?.watch),
    noBuyCount: numberValue(watchlistSummary?.noBuy) ?? numberValue(metrics?.noBuy),
    symbolsScanned: numberValue(metrics?.symbolsScanned),
    candidatesEvaluated: numberValue(metrics?.candidatesEvaluated),
    focusTicker: stringValue(focus?.ticker),
    focusAction: stringValue(focus?.action),
    focusStrategy: stringValue(focus?.strategy),
    dipBuyerBuy: extractTickers(dipBuyer?.buy),
    dipBuyerWatch: extractTickers(dipBuyer?.watch),
    dipBuyerNoBuy: extractTickers(dipBuyer?.noBuy),
    canslimBuy: extractTickers(canslim?.buy),
    canslimWatch: extractTickers(canslim?.watch),
    canslimNoBuy: extractTickers(canslim?.noBuy),
    artifactDirectory: stringValue(asRecord(summaryData.artifacts)?.directory) ?? runPath,
    summaryPath: stringValue(asRecord(summaryData.artifacts)?.summary) ?? summaryPath,
    messagePath: stringValue(asRecord(summaryData.artifacts)?.message) ?? (message ? messagePath : null),
    watchlistPath: stringValue(asRecord(summaryData.artifacts)?.watchlistFullJson) ?? (watchlist.data ? watchlistPath : null),
    messagePreview: message ? message.split(/\r?\n/).slice(0, 6).join("\n") : null,
    metrics,
    lastError: deriveLastError(summaryData, stderr),
    sourceHost: stringValue(summaryData.host),
  };
}

function mapRowToRecord(row: Record<string, unknown>): TradingRunStateRecord {
  return {
    runId: stringValue(row.runId) ?? "unknown",
    schemaVersion: numberValue(row.schemaVersion) ?? 1,
    strategy: stringValue(row.strategy) ?? "Trading market-session unified",
    status: stringValue(row.status) ?? "unknown",
    createdAt: dateToIso(row.createdAt) ?? new Date(0).toISOString(),
    startedAt: dateToIso(row.startedAt),
    completedAt: dateToIso(row.completedAt),
    notifiedAt: dateToIso(row.notifiedAt),
    deliveryStatus: stringValue(row.deliveryStatus),
    decision: stringValue(row.decision),
    confidence: numberValue(row.confidence),
    risk: stringValue(row.risk),
    correctionMode: booleanValue(row.correctionMode),
    buyCount: numberValue(row.buyCount),
    watchCount: numberValue(row.watchCount),
    noBuyCount: numberValue(row.noBuyCount),
    symbolsScanned: numberValue(row.symbolsScanned),
    candidatesEvaluated: numberValue(row.candidatesEvaluated),
    focusTicker: stringValue(row.focusTicker),
    focusAction: stringValue(row.focusAction),
    focusStrategy: stringValue(row.focusStrategy),
    dipBuyerBuy: stringArray(row.dipBuyerBuy),
    dipBuyerWatch: stringArray(row.dipBuyerWatch),
    dipBuyerNoBuy: stringArray(row.dipBuyerNoBuy),
    canslimBuy: stringArray(row.canslimBuy),
    canslimWatch: stringArray(row.canslimWatch),
    canslimNoBuy: stringArray(row.canslimNoBuy),
    artifactDirectory: stringValue(row.artifactDirectory),
    summaryPath: stringValue(row.summaryPath),
    messagePath: stringValue(row.messagePath),
    watchlistPath: stringValue(row.watchlistPath),
    messagePreview: stringValue(row.messagePreview),
    metrics: asRecord(row.metrics),
    lastError: stringValue(row.lastError),
    sourceHost: stringValue(row.sourceHost),
  };
}

async function readJsonFile<T>(filePath: string): Promise<{ data: T | null }> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return { data: JSON.parse(raw) as T };
  } catch {
    return { data: null };
  }
}

async function readTextIfExists(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return "";
    throw error;
  }
}

function deriveDeliveryStatus(status: string | null, notifiedAt: Date | null): string | null {
  if (notifiedAt) return "notified";
  if (!status) return null;
  if (status === "failed" || status === "cancelled") return "failed";
  if (status === "success") return "pending";
  if (status === "queued" || status === "running") return "pending";
  return null;
}

function deriveLastError(summaryData: Record<string, unknown>, stderr: string): string | null {
  const explicit =
    stringValue(summaryData.lastError) ??
    stringValue(summaryData.last_error) ??
    stringValue(summaryData.error);
  if (explicit) return explicit;
  const firstLine = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine ?? null;
}

function extractTickers(value: unknown): string[] {
  return asArray(value)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => stringValue(entry.ticker))
    .filter((ticker): ticker is string => Boolean(ticker));
}

function parseDateValue(value: unknown): Date | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseRunIdTimestamp(runId: string): Date | null {
  const match = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(runId);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const parsed = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateToIso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}
