import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface MarketIntelRuntimeConfig {
  polymarketPublicBaseUrl: string;
  polymarketApiBaseUrl: string;
  polymarketKeyId: string | null;
  polymarketSecretKey: string | null;
}

export interface PolymarketCredentials {
  keyId: string;
  secretKey: string;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const envPath = path.join(repoRoot, ".env");
const DEFAULT_POLYMARKET_PUBLIC_BASE_URL = "https://gateway.polymarket.us";
const DEFAULT_POLYMARKET_API_BASE_URL = "https://api.polymarket.us";
let repoEnvLoaded = false;

export function getMarketIntelRuntimeConfig(): MarketIntelRuntimeConfig {
  ensureRepoEnvLoaded();

  return {
    polymarketPublicBaseUrl:
      readEnvVar("POLYMARKET_PUBLIC_BASE_URL") ?? DEFAULT_POLYMARKET_PUBLIC_BASE_URL,
    polymarketApiBaseUrl:
      readEnvVar("POLYMARKET_API_BASE_URL") ?? DEFAULT_POLYMARKET_API_BASE_URL,
    polymarketKeyId:
      readEnvVar("POLYMARKET_KEY_ID") ??
      readEnvVar("POLYMARKET_CLIENT_KEY") ??
      readEnvVar("POLYMARKET_API_KEY"),
    polymarketSecretKey:
      readEnvVar("POLYMARKET_SECRET_KEY") ??
      readEnvVar("POLYMARKET_SECRET"),
  };
}

export function requirePolymarketCredentials(): PolymarketCredentials {
  const config = getMarketIntelRuntimeConfig();

  if (!config.polymarketKeyId || !config.polymarketSecretKey) {
    throw new Error(
      "Polymarket US credentials are missing. Set POLYMARKET_KEY_ID (or POLYMARKET_CLIENT_KEY) and POLYMARKET_SECRET_KEY in /Users/hd/Developer/cortana-external/.env.",
    );
  }

  return {
    keyId: config.polymarketKeyId,
    secretKey: config.polymarketSecretKey,
  };
}

function ensureRepoEnvLoaded(): void {
  if (repoEnvLoaded) {
    return;
  }
  repoEnvLoaded = true;

  if (!existsSync(envPath)) {
    return;
  }

  const contents = readFileSync(envPath, "utf8");
  for (const line of contents.split(/\r?\n/u)) {
    applyEnvLine(line);
  }
}

function applyEnvLine(line: string): void {
  const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/u);
  if (!match) {
    return;
  }

  const [, key, rawValue] = match;
  if (process.env[key] != null) {
    return;
  }

  process.env[key] = normalizeEnvValue(rawValue);
}

function normalizeEnvValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "";
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed.replace(/\s+#.*$/u, "").trim();
}

function readEnvVar(key: string): string | null {
  const value = process.env[key]?.trim();
  return value ? value : null;
}
