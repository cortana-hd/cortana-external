import path from "node:path";
import { loadMissionControlScriptEnv } from "./script-env";

export const MISSION_CONTROL_LAUNCH_AGENT_LABEL = "com.cortana.mission-control";
export const DEFAULT_MISSION_CONTROL_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";
export const DEFAULT_MISSION_CONTROL_HOST = "0.0.0.0";
export const DEFAULT_MISSION_CONTROL_PORT = "3000";
export const DEFAULT_MISSION_CONTROL_STDOUT = "/tmp/mission-control-stdout.log";
export const DEFAULT_MISSION_CONTROL_STDERR = "/tmp/mission-control-stderr.log";

export type MissionControlLaunchAgentConfig = {
  appDir: string;
  programArguments: string[];
  environmentVariables: Record<string, string>;
  stdoutPath?: string;
  stderrPath?: string;
};

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function buildMissionControlLaunchAgentPlist({
  appDir,
  programArguments,
  environmentVariables,
  stdoutPath = DEFAULT_MISSION_CONTROL_STDOUT,
  stderrPath = DEFAULT_MISSION_CONTROL_STDERR,
}: MissionControlLaunchAgentConfig): string {
  const envEntries = Object.entries(environmentVariables)
    .filter(([, value]) => value.trim().length > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `\t\t<key>${xmlEscape(key)}</key>\n\t\t<string>${xmlEscape(value)}</string>`)
    .join("\n");

  const args = programArguments
    .map((argument) => `\t\t<string>${xmlEscape(argument)}</string>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>EnvironmentVariables</key>
\t<dict>
${envEntries}
\t</dict>
\t<key>KeepAlive</key>
\t<true/>
\t<key>Label</key>
\t<string>${MISSION_CONTROL_LAUNCH_AGENT_LABEL}</string>
\t<key>ProgramArguments</key>
\t<array>
${args}
\t</array>
\t<key>RunAtLoad</key>
\t<true/>
\t<key>StandardErrorPath</key>
\t<string>${xmlEscape(stderrPath)}</string>
\t<key>StandardOutPath</key>
\t<string>${xmlEscape(stdoutPath)}</string>
\t<key>WorkingDirectory</key>
\t<string>${xmlEscape(appDir)}</string>
</dict>
</plist>
`;
}

export function getMissionControlLaunchAgentEnvironment(
  appDir: string,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const merged = loadMissionControlScriptEnv(appDir, { ...env });
  const environmentVariables: Record<string, string> = {
    DATABASE_URL: merged.DATABASE_URL?.trim() ?? "",
    HOST: merged.HOST?.trim() || DEFAULT_MISSION_CONTROL_HOST,
    NODE_ENV: merged.NODE_ENV?.trim() || "production",
    PATH: merged.MISSION_CONTROL_PATH?.trim() || DEFAULT_MISSION_CONTROL_PATH,
    PORT: merged.PORT?.trim() || DEFAULT_MISSION_CONTROL_PORT,
  };

  for (const key of ["CORTANA_SOURCE_REPO", "BACKTESTER_REPO_PATH", "DOCS_PATH", "RESEARCH_PATH", "KNOWLEDGE_PATH"]) {
    const value = merged[key]?.trim();
    if (value) {
      environmentVariables[key] = value;
    }
  }

  return environmentVariables;
}

export function getMissionControlLaunchAgentProgramArguments(appDir: string): string[] {
  return [path.join(appDir, "scripts", "start-mission-control.sh")];
}

export function launchAgentUsesLegacyPnpmWrapper(plistContent: string): boolean {
  return /<string>[^<]*pnpm<\/string>/.test(plistContent) && plistContent.includes("<string>start</string>");
}
