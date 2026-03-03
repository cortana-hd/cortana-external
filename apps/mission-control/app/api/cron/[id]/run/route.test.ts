import { beforeEach, describe, expect, it, vi } from "vitest";

const childProcessMocks = vi.hoisted(() => ({
  execSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execSync: childProcessMocks.execSync,
  default: { execSync: childProcessMocks.execSync },
}));

import { POST } from "@/app/api/cron/[id]/run/route";

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("POST /api/cron/[id]/run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("POST calls openclaw cron run --id <id>", async () => {
    childProcessMocks.execSync.mockReturnValueOnce('{"started":true}');

    await POST(new Request("http://localhost", { method: "POST" }), params("job-run"));

    expect(childProcessMocks.execSync).toHaveBeenCalledWith(
      "openclaw cron run --id 'job-run'",
      expect.objectContaining({ encoding: "utf8" })
    );
  });

  it("returns success response", async () => {
    childProcessMocks.execSync.mockReturnValueOnce('{"started":true}');

    const response = await POST(new Request("http://localhost", { method: "POST" }), params("job-run"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true, result: { started: true } });
  });

  it("returns error on CLI failure", async () => {
    childProcessMocks.execSync.mockImplementationOnce(() => {
      throw Object.assign(new Error("run failed"), { stderr: "down" });
    });

    const response = await POST(new Request("http://localhost", { method: "POST" }), params("job-run"));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: "run failed", details: "down" });
  });
});
