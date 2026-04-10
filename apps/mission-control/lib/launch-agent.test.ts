import { describe, expect, it } from "vitest";
import {
  buildMissionControlLaunchAgentPlist,
  getMissionControlLaunchAgentEnvironment,
  getMissionControlLaunchAgentProgramArguments,
  launchAgentUsesLegacyPnpmWrapper,
} from "@/lib/launch-agent";

describe("launch agent helpers", () => {
  it("builds a direct Mission Control launch agent plist", () => {
    const plist = buildMissionControlLaunchAgentPlist({
      appDir: "/tmp/apps/mission-control",
      programArguments: ["/tmp/apps/mission-control/scripts/start-mission-control.sh"],
      environmentVariables: {
        DATABASE_URL: "postgresql://hd@localhost:5432/cortana?connection_limit=10&pool_timeout=20",
        HOST: "0.0.0.0",
        NODE_ENV: "production",
        PATH: "/opt/homebrew/bin:/usr/bin:/bin",
        PORT: "3000",
      },
    });

    expect(plist).toContain("<string>/tmp/apps/mission-control/scripts/start-mission-control.sh</string>");
    expect(plist).toContain("connection_limit=10&amp;pool_timeout=20");
    expect(plist).not.toContain("<string>/opt/homebrew/bin/pnpm</string>");
  });

  it("builds the standard direct start program arguments", () => {
    expect(getMissionControlLaunchAgentProgramArguments("/tmp/apps/mission-control")).toEqual([
      "/tmp/apps/mission-control/scripts/start-mission-control.sh",
    ]);
  });

  it("merges env defaults without losing explicit overrides", () => {
    const env = getMissionControlLaunchAgentEnvironment("/tmp/missing-app", {
      DATABASE_URL: "postgresql://override",
      HOST: "127.0.0.1",
      MISSION_CONTROL_PATH: "/custom/bin:/usr/bin:/bin",
      NODE_ENV: "production",
      PORT: "4100",
      CORTANA_SOURCE_REPO: "/srv/cortana",
    });

    expect(env).toEqual({
      CORTANA_SOURCE_REPO: "/srv/cortana",
      DATABASE_URL: "postgresql://override",
      HOST: "127.0.0.1",
      NODE_ENV: "production",
      PATH: "/custom/bin:/usr/bin:/bin",
      PORT: "4100",
    });
  });

  it("detects the legacy pnpm launch wrapper", () => {
    expect(
      launchAgentUsesLegacyPnpmWrapper(`
        <array>
          <string>/opt/homebrew/bin/pnpm</string>
          <string>start</string>
        </array>
      `),
    ).toBe(true);
    expect(
      launchAgentUsesLegacyPnpmWrapper(`
        <array>
          <string>/tmp/apps/mission-control/scripts/start-mission-control.sh</string>
        </array>
      `),
    ).toBe(false);
  });
});
