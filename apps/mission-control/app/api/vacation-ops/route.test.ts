import { beforeEach, describe, expect, it, vi } from "vitest";

const getVacationOpsSnapshotMock = vi.fn();

vi.mock("@/lib/vacation-ops", () => ({
  getVacationOpsSnapshot: getVacationOpsSnapshotMock,
}));

describe("GET /api/vacation-ops", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns vacation ops data for remote browser reads without a token", async () => {
    getVacationOpsSnapshotMock.mockResolvedValueOnce({
      generatedAt: "2026-04-12T00:00:00.000Z",
      mode: "inactive",
      config: { timezone: "America/New_York", summaryTimes: { morning: "08:00", evening: "20:00" } },
      currentWindow: null,
      latestWindow: null,
      latestRun: null,
      latestSummary: null,
      checks: [],
      recentIncidents: [],
      recentActions: [],
      tierRollup: [],
      counts: { activeIncidents: 0, humanRequiredIncidents: 0, resolvedIncidents: 0, pausedJobs: 0, selfHeals: 0 },
      enableReadyWindowId: null,
      pausedJobs: [],
    });

    const { GET } = await import("@/app/api/vacation-ops/route");
    const response = await GET(
      new Request("http://remote.test/api/vacation-ops", {
        headers: { host: "100.120.198.12:3000" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "ok" });
    expect(getVacationOpsSnapshotMock).toHaveBeenCalledTimes(1);
  });
});
