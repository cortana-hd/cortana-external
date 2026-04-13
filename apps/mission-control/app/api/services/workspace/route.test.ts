import { beforeEach, describe, expect, it, vi } from "vitest";

const getServicesWorkspaceDataMock = vi.fn();
const updateServicesWorkspaceDataMock = vi.fn();

class ServicesWorkspaceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServicesWorkspaceValidationError";
  }
}

vi.mock("@/lib/service-workspace", () => ({
  ServicesWorkspaceValidationError,
  getServicesWorkspaceData: getServicesWorkspaceDataMock,
  updateServicesWorkspaceData: updateServicesWorkspaceDataMock,
}));

describe("GET /api/services/workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns workspace data for remote browser reads without a token", async () => {
    getServicesWorkspaceDataMock.mockResolvedValueOnce({
      generatedAt: "2026-04-03T00:00:00.000Z",
      files: [],
      sections: [],
      health: [],
      openclawDocsPath: "/tmp/docs/mission-control.md",
    });
    const { GET } = await import("@/app/api/services/workspace/route");
    const response = await GET(
      new Request("http://remote.test/api/services/workspace", {
        headers: { host: "100.120.198.12:3000" },
      }),
    );

    expect(response.status).toBe(200);
    expect(getServicesWorkspaceDataMock).toHaveBeenCalledTimes(1);
  });
});

describe("PATCH /api/services/workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a 400 for validation errors", async () => {
    updateServicesWorkspaceDataMock.mockRejectedValueOnce(
      new ServicesWorkspaceValidationError("Unknown workspace field: external:BAD_KEY"),
    );

    const { PATCH } = await import("@/app/api/services/workspace/route");
    const response = await PATCH(
      new Request("http://localhost/api/services/workspace", {
        method: "PATCH",
        headers: {
          authorization: "Bearer secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          updates: [{ fileId: "external", key: "BAD_KEY", value: "oops" }],
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      status: "error",
      message: "Unknown workspace field: external:BAD_KEY",
    });
  });
});
