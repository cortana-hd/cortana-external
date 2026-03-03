import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/logs/route";
import { getLogEntries } from "@/lib/logs";

vi.mock("@/lib/logs", () => ({
  getLogEntries: vi.fn(),
}));

describe("/api/logs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET returns log entries with parsed filters", async () => {
    vi.mocked(getLogEntries).mockResolvedValueOnce({
      logs: [],
      facets: { severities: [], sources: [], eventTypes: [] },
      source: "cortana",
    });

    const request = new Request(
      "http://localhost/api/logs?rangeHours=6&limit=20&severity=error&source=core&eventType=deploy_failure&query=Deploy",
    );
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      logs: [],
      facets: { severities: [], sources: [], eventTypes: [] },
      source: "cortana",
    });
    expect(getLogEntries).toHaveBeenCalledWith({
      rangeHours: 6,
      limit: 20,
      severity: "error",
      source: "core",
      eventType: "deploy_failure",
      query: "Deploy",
    });
  });
});
