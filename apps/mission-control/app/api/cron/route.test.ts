import { beforeEach, describe, expect, it, vi } from "vitest";

const childProcessMocks = vi.hoisted(() => ({
  execSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execSync: childProcessMocks.execSync,
  default: { execSync: childProcessMocks.execSync },
}));

import { GET } from "@/app/api/cron/route";

describe("GET /api/cron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns jobs array from openclaw cron list --json", async () => {
    childProcessMocks.execSync.mockReturnValueOnce(
      JSON.stringify({ jobs: [{ id: "job-1", name: "Daily" }] })
    );

    const response = await GET();
    const payload = await response.json();

    expect(childProcessMocks.execSync).toHaveBeenCalledWith(
      "openclaw cron list --json",
      expect.objectContaining({ encoding: "utf8" })
    );
    expect(response.status).toBe(200);
    expect(payload).toEqual({ jobs: [{ id: "job-1", name: "Daily" }] });
  });

  it("returns error response when CLI command fails", async () => {
    const error = Object.assign(new Error("boom"), {
      stderr: Buffer.from("permission denied"),
    });
    childProcessMocks.execSync.mockImplementationOnce(() => {
      throw error;
    });

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: "boom", details: "permission denied" });
  });

  it("returns proper JSON shape", async () => {
    childProcessMocks.execSync.mockReturnValueOnce(JSON.stringify([{ id: "a" }, { id: "b" }]));

    const response = await GET();
    const payload = await response.json();

    expect(payload).toHaveProperty("jobs");
    expect(Array.isArray(payload.jobs)).toBe(true);
    expect(payload.jobs[0]).toMatchObject({ id: "a" });
  });
});
