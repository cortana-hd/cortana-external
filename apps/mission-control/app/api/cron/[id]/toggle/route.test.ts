import { beforeEach, describe, expect, it, vi } from "vitest";

const childProcessMocks = vi.hoisted(() => ({
  execSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execSync: childProcessMocks.execSync,
  default: { execSync: childProcessMocks.execSync },
}));

import { POST } from "@/app/api/cron/[id]/toggle/route";

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("POST /api/cron/[id]/toggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("POST with { enabled: true } calls openclaw cron enable --id <id>", async () => {
    childProcessMocks.execSync.mockReturnValueOnce('{"ok":true}');

    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });

    const response = await POST(request, params("job-enable"));
    const payload = await response.json();

    expect(childProcessMocks.execSync).toHaveBeenCalledWith(
      "openclaw cron enable --id 'job-enable'",
      expect.objectContaining({ encoding: "utf8" })
    );
    expect(payload).toMatchObject({ ok: true, enabled: true });
  });

  it("POST with { enabled: false } calls openclaw cron disable --id <id>", async () => {
    childProcessMocks.execSync.mockReturnValueOnce('{"ok":true}');

    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });

    await POST(request, params("job-disable"));

    expect(childProcessMocks.execSync).toHaveBeenCalledWith(
      "openclaw cron disable --id 'job-disable'",
      expect.objectContaining({ encoding: "utf8" })
    );
  });

  it("returns error on CLI failure", async () => {
    childProcessMocks.execSync.mockImplementationOnce(() => {
      throw Object.assign(new Error("toggle failed"), { stderr: "denied" });
    });

    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });

    const response = await POST(request, params("job-error"));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: "toggle failed", details: "denied" });
  });
});
