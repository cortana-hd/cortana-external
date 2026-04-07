import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/prisma";
import { getTaskPrisma, isPrimaryDatabaseCortana } from "@/lib/task-prisma";
import { getDecisionTraces } from "@/lib/decision-traces";

vi.mock("@/lib/task-prisma", () => ({
  getTaskPrisma: vi.fn(),
  isPrimaryDatabaseCortana: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    $queryRawUnsafe: vi.fn(),
  },
}));

describe("lib/decision-traces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getTaskPrisma).mockReturnValue(null);
    vi.mocked(isPrimaryDatabaseCortana).mockReturnValue(false);
  });

  it("warns when the Cortana DB is not configured", async () => {
    const createdAt = new Date("2026-02-26T12:00:00.000Z");

    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValueOnce([
      {
        id: 1,
        trace_id: "trace-1",
        event_id: 11,
        task_id: 22,
        run_id: "run-1",
        trigger_type: "schedule",
        action_type: "deploy",
        action_name: "deploy-prod",
        reasoning: "Scheduled release",
        confidence: 0.9,
        outcome: "success",
        data_inputs: { release: "2026.02.26" },
        metadata: { source: "scheduler" },
        created_at: createdAt,
        completed_at: createdAt,
        trigger_timestamp: createdAt,
        trigger_source: "cron",
        trigger_event_type: "release.window_open",
        trigger_severity: "info",
        trigger_message: "Window is open",
        trigger_metadata: { runbook: "deploy" },
      },
    ]);

    const result = await getDecisionTraces();

    expect(result.source).toBe("app");
    expect(result.warning).toContain("CORTANA_DATABASE_URL is not configured");
    expect(result.traces).toHaveLength(1);
    const query = vi.mocked(prisma.$queryRawUnsafe).mock.calls[0][0] as string;
    expect(query).toContain("INTERVAL '2160 hours'");
  });

  it("treats the primary Cortana DB as the canonical source without a warning", async () => {
    const createdAt = new Date("2026-03-05T18:05:55.451Z");
    vi.mocked(isPrimaryDatabaseCortana).mockReturnValue(true);
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValueOnce([
      {
        id: 3,
        trace_id: "trace-3",
        event_id: null,
        task_id: null,
        run_id: "run-3",
        trigger_type: "cron",
        action_type: "email_triage",
        action_name: "digest",
        reasoning: "Queued digest",
        confidence: 0.74,
        outcome: "success",
        data_inputs: {},
        metadata: {},
        created_at: createdAt,
        completed_at: createdAt,
        trigger_timestamp: null,
        trigger_source: null,
        trigger_event_type: null,
        trigger_severity: null,
        trigger_message: null,
        trigger_metadata: null,
      },
    ]);

    const result = await getDecisionTraces();

    expect(result.source).toBe("cortana");
    expect(result.warning).toBeUndefined();
    expect(result.traces[0]?.traceId).toBe("trace-3");
  });

  it("falls back to mission-control DB when Cortana query fails", async () => {
    const createdAt = new Date("2026-02-26T12:00:00.000Z");
    const taskClient = { $queryRawUnsafe: vi.fn().mockRejectedValueOnce(new Error("boom")) };
    vi.mocked(getTaskPrisma).mockReturnValue(taskClient as never);
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValueOnce([
      {
        id: 2,
        trace_id: "trace-2",
        event_id: null,
        task_id: null,
        run_id: null,
        trigger_type: "manual",
        action_type: "restart",
        action_name: "restart-service",
        reasoning: null,
        confidence: null,
        outcome: "unknown",
        data_inputs: {},
        metadata: {},
        created_at: createdAt,
        completed_at: null,
        trigger_timestamp: null,
        trigger_source: null,
        trigger_event_type: null,
        trigger_severity: null,
        trigger_message: null,
        trigger_metadata: null,
      },
    ]);

    const result = await getDecisionTraces({ rangeHours: 24 });

    expect(taskClient.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(result.source).toBe("app");
    expect(result.warning).toContain("fell back to the Mission Control database");
    expect(result.traces[0]?.traceId).toBe("trace-2");
  });
});
