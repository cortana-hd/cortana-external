import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { WhoopService } from "../whoop/service.js";

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "whoop-service-test-"));
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

describe("whoop service", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.map(async (dir) => {
        await fs.rm(dir, { recursive: true, force: true });
      }),
    );
    dirs.length = 0;
  });

  it("dedupes workout records by normalized record id and reports quality metadata", async () => {
    const dir = await makeTempDir();
    dirs.push(dir);
    const tokenPath = path.join(dir, "tokens.json");
    const dataPath = path.join(dir, "whoop.json");

    await writeJson(tokenPath, {
      access_token: "valid",
      refresh_token: "refresh",
      expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
    });

    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/v2/user/profile/basic")) return json({ id: "user-1" });
      if (url.includes("/v2/user/measurement/body")) return json({});
      if (url.includes("/v2/cycle")) return json([]);
      if (url.includes("/v2/recovery")) return json([]);
      if (url.includes("/v2/activity/sleep")) return json([]);
      if (url.includes("/v2/activity/workout") && !url.includes("next_token=")) {
        return json({
          records: [
            { id: 123, sport_name: "lift", score: { strain: 7.2 } },
            { id: "456", sport_name: "run", score: { strain: 6.1 } },
          ],
          next_token: "token-2",
        });
      }
      if (url.includes("/v2/activity/workout") && url.includes("next_token=token-2")) {
        return json({
          records: [
            { record_id: "123", sport_name: "lift", score: { strain: 7.2 } },
            { workout_id: "789", sport_name: "bike", score: { strain: 5.5 } },
          ],
          next_token: "",
        });
      }
      return new Response("not found", { status: 404 });
    };

    const service = new WhoopService({
      clientId: "abc",
      clientSecret: "secret",
      redirectUrl: "http://localhost/callback",
      tokenPath,
      dataPath,
      fetchImpl,
    });

    const result = await service.getWhoopData(true);

    expect(result.servedStale).toBe(false);
    expect(result.data.workouts).toHaveLength(3);
    expect(result.data.workouts.map((row) => String((row as { id?: unknown }).id ?? (row as { record_id?: unknown }).record_id ?? ""))).toContain("123");
    expect(result.data.quality).toMatchObject({
      page_count: 2,
      repeated_next_token_detected: false,
      workout_record_count: 4,
      unique_workout_count: 3,
      duplicate_workout_ids_removed: 1,
    });
  });

  it("stops when Whoop repeats next_token and records the loop in quality metadata", async () => {
    const dir = await makeTempDir();
    dirs.push(dir);
    const tokenPath = path.join(dir, "tokens.json");
    const dataPath = path.join(dir, "whoop.json");

    await writeJson(tokenPath, {
      access_token: "valid",
      refresh_token: "refresh",
      expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
    });

    let workoutCalls = 0;
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/v2/user/profile/basic")) return json({ id: "user-1" });
      if (url.includes("/v2/user/measurement/body")) return json({});
      if (url.includes("/v2/cycle")) return json([]);
      if (url.includes("/v2/recovery")) return json([]);
      if (url.includes("/v2/activity/sleep")) return json([]);
      if (url.includes("/v2/activity/workout")) {
        workoutCalls += 1;
        if (workoutCalls === 1) {
          return json({
            records: [{ id: "a", sport_name: "lift", score: { strain: 5.1 } }],
            next_token: "repeat-me",
          });
        }
        if (workoutCalls === 2) {
          return json({
            records: [{ id: "b", sport_name: "run", score: { strain: 6.2 } }],
            next_token: "repeat-me",
          });
        }
        throw new Error("unexpected third workout page");
      }
      return new Response("not found", { status: 404 });
    };

    const service = new WhoopService({
      clientId: "abc",
      clientSecret: "secret",
      redirectUrl: "http://localhost/callback",
      tokenPath,
      dataPath,
      fetchImpl,
    });

    const result = await service.getWhoopData(true);

    expect(workoutCalls).toBe(2);
    expect(result.data.workouts).toHaveLength(2);
    expect(result.data.quality).toMatchObject({
      page_count: 2,
      repeated_next_token_detected: true,
      workout_record_count: 2,
      unique_workout_count: 2,
      duplicate_workout_ids_removed: 0,
      next_tokens: ["repeat-me"],
    });
  });
});

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
