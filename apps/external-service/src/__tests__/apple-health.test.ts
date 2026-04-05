import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";

import { createAppleHealthRouter } from "../apple-health/routes.js";
import { AppleHealthService } from "../apple-health/service.js";

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "apple-health-service-test-"));
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

describe("apple health service", () => {
  const dirs: string[] = [];
  const fixedNow = new Date("2026-04-05T12:00:00.000Z");

  afterEach(async () => {
    await Promise.all(
      dirs.map(async (dir) => {
        await fs.rm(dir, { recursive: true, force: true });
      }),
    );
    dirs.length = 0;
  });

  it("serves the latest export and reports healthy health for a fresh file", async () => {
    const dir = await makeTempDir();
    dirs.push(dir);
    const dataPath = path.join(dir, "latest.json");
    const generatedAt = new Date("2026-04-05T11:30:00.000Z");

    await writeJson(dataPath, {
      schema_version: 1,
      generated_at: generatedAt.toISOString(),
      freshness: {
        generated_at: generatedAt.toISOString(),
        max_age_seconds: 7_200,
        is_stale: false,
      },
      summary: { steps: 8123, sleep_hours: 7.4 },
    });

    const service = new AppleHealthService({
      dataPath,
      maxAgeMs: 12 * 60 * 60 * 1000,
      now: () => fixedNow,
    });
    const app = new Hono();
    app.route("/", createAppleHealthRouter(service));

    const dataResponse = await app.request("/apple-health/data");
    const dataBody = (await dataResponse.json()) as { summary: { steps: number; sleep_hours: number } };
    expect(dataResponse.status).toBe(200);
    expect(dataBody.summary).toEqual({ steps: 8123, sleep_hours: 7.4 });

    const healthResponse = await app.request("/apple-health/health");
    const healthBody = (await healthResponse.json()) as { status: string; age_seconds: number };
    expect(healthResponse.status).toBe(200);
    expect(healthBody.status).toBe("healthy");
    expect(healthBody.age_seconds).toBe(1800);
  });

  it("warns on stale exports and degrades health", async () => {
    const dir = await makeTempDir();
    dirs.push(dir);
    const dataPath = path.join(dir, "latest.json");
    const generatedAt = new Date("2026-04-03T12:00:00.000Z");

    await writeJson(dataPath, {
      schema_version: 1,
      generated_at: generatedAt.toISOString(),
      freshness: {
        generated_at: generatedAt.toISOString(),
        max_age_seconds: 7_200,
        is_stale: true,
      },
      summary: { steps: 1000 },
    });

    const service = new AppleHealthService({
      dataPath,
      maxAgeMs: 12 * 60 * 60 * 1000,
      now: () => fixedNow,
    });
    const app = new Hono();
    app.route("/", createAppleHealthRouter(service));

    const dataResponse = await app.request("/apple-health/data");
    expect(dataResponse.status).toBe(200);
    expect(dataResponse.headers.get("Warning")).toBe('110 - "Serving stale Apple Health export"');

    const healthResponse = await app.request("/apple-health/health");
    const healthBody = (await healthResponse.json()) as { status: string; is_stale: boolean };
    expect(healthResponse.status).toBe(200);
    expect(healthBody.status).toBe("degraded");
    expect(healthBody.is_stale).toBe(true);
  });

  it("returns unhealthy when the export schema is invalid", async () => {
    const dir = await makeTempDir();
    dirs.push(dir);
    const dataPath = path.join(dir, "latest.json");

    await writeJson(dataPath, {
      generated_at: fixedNow.toISOString(),
      freshness: {
        generated_at: fixedNow.toISOString(),
        max_age_seconds: 7_200,
        is_stale: false,
      },
    });

    const service = new AppleHealthService({
      dataPath,
      maxAgeMs: 12 * 60 * 60 * 1000,
      now: () => fixedNow,
    });
    const app = new Hono();
    app.route("/", createAppleHealthRouter(service));

    const dataResponse = await app.request("/apple-health/data");
    const dataBody = (await dataResponse.json()) as { error: string };
    expect(dataResponse.status).toBe(422);
    expect(dataBody.error).toContain("invalid apple health export schema");

    const healthResponse = await app.request("/apple-health/health");
    const healthBody = (await healthResponse.json()) as { status: string; error: string };
    expect(healthResponse.status).toBe(503);
    expect(healthBody.status).toBe("unhealthy");
    expect(healthBody.error).toContain("invalid apple health export schema");
  });
});
