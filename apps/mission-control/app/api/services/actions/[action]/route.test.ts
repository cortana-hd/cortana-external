import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const existsSyncMock = vi.fn();
const readFileSyncMock = vi.fn();

vi.mock("node:fs", () => ({
  default: {
    existsSync: existsSyncMock,
    readFileSync: readFileSyncMock,
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/services/actions/[action]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    existsSyncMock.mockImplementation((target: string) => target.endsWith(".git") || target.endsWith(".env"));
    readFileSyncMock.mockReturnValue("PORT=4040\n");
  });

  it("returns the OAuth URL for remote browser reads without a token", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ url: "https://whoop.test/oauth" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock as typeof fetch);
    const { GET } = await import("@/app/api/services/actions/[action]/route");
    const response = await GET(
      new Request("http://remote.test/api/services/actions/whoop-auth-url", {
        headers: { host: "100.120.198.12:3000" },
      }),
      { params: Promise.resolve({ action: "whoop-auth-url" }) },
    );

    expect(response.status).toBe(200);
  });
});
