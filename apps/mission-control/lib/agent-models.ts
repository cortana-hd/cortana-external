import { readFileSync, existsSync } from "node:fs";
import { getAgentModelsPath } from "@/lib/runtime-paths";

const formatModelDisplayName = (key: string) => {
  const suffix = key.split("/").pop() ?? key;
  if (!suffix) return key;

  return suffix
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => {
      if (/^gpt-\d/i.test(part)) return part.toUpperCase();
      if (part.toLowerCase() === "gpt") return "GPT";
      if (/^\d+(\.\d+)*$/.test(part)) return part;
      if (part.toLowerCase() === "codex") return "Codex";
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
};

export function getAgentModelMap(): Record<string, string> {
  try {
    const agentModelsPath = getAgentModelsPath();
    if (!existsSync(agentModelsPath)) return {};
    return JSON.parse(readFileSync(agentModelsPath, "utf8"));
  } catch {
    return {};
  }
}

/**
 * Returns the friendly display name for an agent's model.
 * Reads agent→model key from config/agent-models.json,
 * then resolves the human name from `openclaw models list --json`.
 */
export function getAgentModelDisplay(
  agentName: string,
  dbModel?: string | null
): { key: string | null; displayName: string | null } {
  const map = getAgentModelMap();
  const key = map[agentName] || dbModel || null;
  if (!key) return { key: null, displayName: null };

  return { key, displayName: formatModelDisplayName(key) };
}
