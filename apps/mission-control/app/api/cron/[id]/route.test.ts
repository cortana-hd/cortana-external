import { beforeEach, describe, expect, it, vi } from "vitest";

const childProcessMocks = vi.hoisted(() => ({
  execSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execSync: childProcessMocks.execSync,
  default: { execSync: childProcessMocks.execSync },
}));

import { DELETE, PATCH } from "@/app/api/cron/[id]/route";

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("/api/cron/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("DELETE calls openclaw cron rm --id <id> and returns success", async () => {
    childProcessMocks.execSync.mockReturnValueOnce('{"removed":true}');

    const response = await DELETE(new Request("http://localhost"), params("job-1"));
    const payload = await response.json();

    expect(childProcessMocks.execSync).toHaveBeenCalledWith(
      "openclaw cron rm --id 'job-1'",
      expect.objectContaining({ encoding: "utf8" })
    );
    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true, result: { removed: true } });
  });

  it("DELETE returns error when CLI fails", async () => {
    childProcessMocks.execSync.mockImplementationOnce(() => {
      throw Object.assign(new Error("rm failed"), { stderr: "not found" });
    });

    const response = await DELETE(new Request("http://localhost"), params("missing"));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: "rm failed", details: "not found" });
  });

  it("PATCH calls openclaw cron edit with correct flags", async () => {
    childProcessMocks.execSync.mockReturnValueOnce('{"ok":true}');

    const request = new Request("http://localhost", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Updated name",
        scheduleKind: "cron",
        scheduleExpr: "*/5 * * * *",
      }),
    });

    const response = await PATCH(request, params("job-2"));
    const payload = await response.json();

    expect(childProcessMocks.execSync).toHaveBeenCalledWith(
      "openclaw cron edit --id 'job-2' --name 'Updated name' --schedule-kind 'cron' --schedule-expr '*/5 * * * *'",
      expect.objectContaining({ encoding: "utf8" })
    );
    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ ok: true });
  });
});
