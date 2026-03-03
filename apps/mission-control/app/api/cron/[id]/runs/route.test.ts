import { beforeEach, describe, expect, it, vi } from "vitest";

const childProcessMocks = vi.hoisted(() => ({
  execSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execSync: childProcessMocks.execSync,
  default: { execSync: childProcessMocks.execSync },
}));

import { GET } from "@/app/api/cron/[id]/runs/route";

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET /api/cron/[id]/runs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls openclaw cron runs --id <id> --limit 20", async () => {
    childProcessMocks.execSync.mockReturnValueOnce('{"runs":[]}');

    await GET(new Request("http://localhost"), params("job-runs"));

    expect(childProcessMocks.execSync).toHaveBeenCalledWith(
      "openclaw cron runs --id 'job-runs' --limit 20",
      expect.objectContaining({ encoding: "utf8" })
    );
  });

  it("returns runs array", async () => {
    childProcessMocks.execSync.mockReturnValueOnce(
      JSON.stringify({ runs: [{ id: "r1", status: "done" }] })
    );

    const response = await GET(new Request("http://localhost"), params("job-runs"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ runs: [{ id: "r1", status: "done" }] });
  });

  it("returns error on CLI failure", async () => {
    childProcessMocks.execSync.mockImplementationOnce(() => {
      throw Object.assign(new Error("runs failed"), { stderr: "oops" });
    });

    const response = await GET(new Request("http://localhost"), params("job-runs"));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: "runs failed", details: "oops" });
  });
});
