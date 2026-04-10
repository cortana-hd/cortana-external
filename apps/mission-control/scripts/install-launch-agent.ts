import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildMissionControlLaunchAgentPlist,
  getMissionControlLaunchAgentEnvironment,
  getMissionControlLaunchAgentProgramArguments,
  MISSION_CONTROL_LAUNCH_AGENT_LABEL,
} from "../lib/launch-agent";

const appDir = path.resolve(__dirname, "..");
const launchAgentsDir = path.join(os.homedir(), "Library", "LaunchAgents");
const launchAgentPath = path.join(launchAgentsDir, `${MISSION_CONTROL_LAUNCH_AGENT_LABEL}.plist`);

fs.mkdirSync(launchAgentsDir, { recursive: true });

const environmentVariables = getMissionControlLaunchAgentEnvironment(appDir);
if (!environmentVariables.DATABASE_URL) {
  throw new Error(`Mission Control LaunchAgent install aborted: DATABASE_URL is missing from ${path.join(appDir, ".env.local")} and the current environment.`);
}

const plist = buildMissionControlLaunchAgentPlist({
  appDir,
  programArguments: getMissionControlLaunchAgentProgramArguments(appDir),
  environmentVariables,
});

fs.writeFileSync(launchAgentPath, plist, "utf8");
fs.chmodSync(launchAgentPath, 0o644);

process.stdout.write(`${launchAgentPath}\n`);
