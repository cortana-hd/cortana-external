import fs from "node:fs";
import path from "node:path";

export function parseEnvFile(content: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    const value = rawValue.trim().replace(/^['"]|['"]$/g, "");
    parsed[key] = value;
  }
  return parsed;
}

export function resolveMissionControlAppRoot(startDir = process.cwd()): string {
  let current = path.resolve(startDir);
  while (true) {
    const packagePath = path.join(current, "package.json");
    if (fs.existsSync(packagePath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(packagePath, "utf8")) as { name?: string };
        if (parsed.name === "mission-control") return current;
      } catch {
        // ignore invalid package and keep walking
      }
    }

    const parent = path.dirname(current);
    if (parent === current) return startDir;
    current = parent;
  }
}

export function loadMissionControlScriptEnv(
  startDir = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const appRoot = resolveMissionControlAppRoot(startDir);
  const envPath = path.join(appRoot, ".env.local");

  if (!fs.existsSync(envPath)) return env;

  const parsed = parseEnvFile(fs.readFileSync(envPath, "utf8"));
  for (const key of ["DATABASE_URL", "CORTANA_DATABASE_URL"]) {
    if (!env[key] && parsed[key]) {
      env[key] = parsed[key];
    }
  }
  return env;
}
