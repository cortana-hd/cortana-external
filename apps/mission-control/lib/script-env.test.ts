import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadMissionControlScriptEnv, parseEnvFile, resolveMissionControlAppRoot } from "@/lib/script-env";

describe("script env helpers", () => {
  it("parses simple env files", () => {
    expect(parseEnvFile("DATABASE_URL='postgres://a'\nCORTANA_DATABASE_URL=postgres://b\n# comment\n")).toEqual({
      DATABASE_URL: "postgres://a",
      CORTANA_DATABASE_URL: "postgres://b",
    });
  });

  it("finds the mission-control app root from nested paths", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mission-control-root-"));
    const appRoot = path.join(root, "apps", "mission-control");
    fs.mkdirSync(path.join(appRoot, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(appRoot, "package.json"), JSON.stringify({ name: "mission-control" }));

    expect(resolveMissionControlAppRoot(path.join(appRoot, "scripts"))).toBe(appRoot);
  });

  it("loads DATABASE_URL from .env.local without overriding explicit env", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mission-control-env-"));
    fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "mission-control" }));
    fs.writeFileSync(
      path.join(root, ".env.local"),
      "DATABASE_URL=postgresql://loaded\nCORTANA_DATABASE_URL=postgresql://cortana\n",
    );

    const env = loadMissionControlScriptEnv(root, { ...process.env, DATABASE_URL: "postgresql://explicit" });

    expect(env.DATABASE_URL).toBe("postgresql://explicit");
    expect(env.CORTANA_DATABASE_URL).toBe("postgresql://cortana");
  });
});
