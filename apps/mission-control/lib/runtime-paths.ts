import fs from "node:fs";
import path from "node:path";

const DEFAULT_CORTANA_SOURCE_REPO = "/Users/hd/Developer/cortana";
const DEFAULT_BACKTESTER_REPO = "/Users/hd/Developer/cortana-external/backtester";

function readEnvPath(name: string): string | null {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : null;
}

export function getCortanaSourceRepo(): string {
  return readEnvPath("CORTANA_SOURCE_REPO") ?? DEFAULT_CORTANA_SOURCE_REPO;
}

export function getBacktesterRepoPath(): string {
  const explicit = readEnvPath("BACKTESTER_REPO_PATH");
  if (explicit) return explicit;

  const candidates = [
    path.resolve(process.cwd(), "backtester"),
    path.resolve(process.cwd(), "..", "..", "backtester"),
    DEFAULT_BACKTESTER_REPO,
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return DEFAULT_BACKTESTER_REPO;
}

export function getDocsPath(): string {
  return readEnvPath("DOCS_PATH") ?? path.join(getCortanaSourceRepo(), "docs");
}

export function getResearchPath(): string {
  return readEnvPath("RESEARCH_PATH") ?? path.join(getCortanaSourceRepo(), "research");
}

export function getKnowledgePath(): string {
  return readEnvPath("KNOWLEDGE_PATH") ?? path.join(getCortanaSourceRepo(), "knowledge");
}

export function getAgentModelsPath(): string {
  return readEnvPath("AGENT_MODELS_PATH") ?? path.join(getCortanaSourceRepo(), "config", "agent-models.json");
}

export function getHeartbeatStatePath(): string {
  return (
    readEnvPath("HEARTBEAT_STATE_PATH") ??
    path.join(getCortanaSourceRepo(), "memory", "heartbeat-state.json")
  );
}

export function getTelegramUsageHandlerPath(): string {
  return readEnvPath("TELEGRAM_USAGE_HANDLER_PATH") ?? path.join(getCortanaSourceRepo(), "skills", "telegram-usage", "handler.ts");
}
