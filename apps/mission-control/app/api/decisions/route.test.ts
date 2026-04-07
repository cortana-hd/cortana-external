import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/decisions/route";
import { createDecisionTrace, getDecisionTraces } from "@/lib/decision-traces";

vi.mock("@/lib/decision-traces", () => ({
  getDecisionTraces: vi.fn(),
  createDecisionTrace: vi.fn(),
}));

describe("/api/decisions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns decision traces with parsed filters", async () => {
    vi.mocked(getDecisionTraces).mockResolvedValueOnce({
      traces: [{ id: 1, traceId: "trace-1" }],
      facets: { actionTypes: ["deploy"], triggerTypes: ["schedule"], outcomes: ["success"] },
      source: "cortana",
    } as never);

    const response = await GET(new Request(
      "http://localhost/api/decisions?rangeHours=24&actionType=deploy&triggerType=schedule&outcome=success&confidenceMin=0.5&confidenceMax=0.9&limit=5",
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.traces).toEqual([{ id: 1, traceId: "trace-1" }]);
    expect(getDecisionTraces).toHaveBeenCalledWith({
      rangeHours: 24,
      actionType: "deploy",
      triggerType: "schedule",
      outcome: "success",
      confidenceMin: 0.5,
      confidenceMax: 0.9,
      limit: 5,
    });
  });

  it("uses a 90 day default range", async () => {
    vi.mocked(getDecisionTraces).mockResolvedValueOnce({
      traces: [],
      facets: { actionTypes: [], triggerTypes: [], outcomes: [] },
      source: "app",
      warning: "fallback",
    } as never);

    await GET(new Request("http://localhost/api/decisions"));

    expect(getDecisionTraces).toHaveBeenCalledWith({
      rangeHours: 24 * 90,
      actionType: undefined,
      triggerType: undefined,
      outcome: "all",
      confidenceMin: undefined,
      confidenceMax: undefined,
      limit: 120,
    });
  });

  it("POST writes a decision trace", async () => {
    const request = new Request("http://localhost/api/decisions", {
      method: "POST",
      body: JSON.stringify({
        trace_id: "trace-1",
        trigger_type: "market_brief",
        action_type: "market_posture",
        action_name: "WATCH",
        reasoning: "Breadth is mixed.",
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(createDecisionTrace).toHaveBeenCalledWith({
      traceId: "trace-1",
      eventId: null,
      taskId: null,
      runId: null,
      triggerType: "market_brief",
      actionType: "market_posture",
      actionName: "WATCH",
      reasoning: "Breadth is mixed.",
      confidence: null,
      outcome: null,
      dataInputs: {},
      metadata: {},
      createdAt: null,
      completedAt: null,
    });
    expect(body).toEqual({ ok: true });
  });
});
