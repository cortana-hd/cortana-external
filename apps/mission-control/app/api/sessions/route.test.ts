import { beforeEach, describe, expect, it, vi } from "vitest";

const openClawMocks = vi.hoisted(() => ({
  runOpenclaw: vi.fn(),
}));

vi.mock("@/lib/openclaw-cli", () => ({
  runOpenclaw: openClawMocks.runOpenclaw,
}));

import { GET } from "@/app/api/sessions/route";

const makeRequest = (query = "") => new Request(`http://localhost/api/sessions${query}`);

describe("GET /api/sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns normalized sessions with default minutes", async () => {
    openClawMocks.runOpenclaw.mockResolvedValueOnce(
      JSON.stringify({
        sessions: [
          {
            key: "agent:main:main",
            sessionId: "abc",
            updatedAt: 123,
            totalTokens: 100,
            inputTokens: 10,
            outputTokens: 90,
            model: "gpt-5.3-codex",
            agentId: "main",
            systemSent: true,
            abortedLastRun: false,
          },
        ],
      })
    );

    const response = await GET(makeRequest());
    const payload = await response.json();

    expect(openClawMocks.runOpenclaw).toHaveBeenCalledWith(["sessions", "--json", "--all-agents", "--active", "1440"]);
    expect(response.status).toBe(200);
    expect(payload.sessions).toHaveLength(1);
    expect(payload.sessions[0]).toMatchObject({
      key: "agent:main:main",
      sessionId: "abc",
      updatedAt: 123,
      totalTokens: 100,
      inputTokens: 10,
      outputTokens: 90,
      model: "gpt-5.3-codex",
      agentId: "main",
      systemSent: true,
      abortedLastRun: false,
    });
    expect(payload.sessions[0].estimatedCost).toBeCloseTo(0.00074, 6);
  });

  it("uses minutes param when provided", async () => {
    openClawMocks.runOpenclaw.mockResolvedValueOnce(JSON.stringify({ sessions: [] }));

    const response = await GET(makeRequest("?minutes=60"));
    const payload = await response.json();

    expect(openClawMocks.runOpenclaw).toHaveBeenCalledWith(["sessions", "--json", "--all-agents", "--active", "60"]);
    expect(response.status).toBe(200);
    expect(payload.sessions).toEqual([]);
  });

  it("returns proper JSON shape", async () => {
    openClawMocks.runOpenclaw.mockResolvedValueOnce(JSON.stringify({ sessions: [{ key: "a" }] }));

    const response = await GET(makeRequest());
    const payload = await response.json();

    expect(payload).toHaveProperty("sessions");
    expect(Array.isArray(payload.sessions)).toBe(true);
    expect(payload.sessions[0]).toMatchObject({ key: "a" });
  });
});
