import { describe, expect, it } from "vitest";
import { summarizeSessions } from "./page";

describe("summarizeSessions", () => {
  it("aggregates totals and system stats correctly", () => {
    const summary = summarizeSessions([
      {
        key: "a",
        sessionId: "s1",
        updatedAt: 100,
        totalTokens: 100,
        inputTokens: 40,
        outputTokens: 60,
        model: "gpt-5.3-codex",
        agentId: "main",
        systemSent: true,
        abortedLastRun: false,
        estimatedCost: 0.001,
      },
      {
        key: "b",
        sessionId: "s2",
        updatedAt: 250,
        totalTokens: 80,
        inputTokens: 20,
        outputTokens: 60,
        model: "gpt-5.3-codex",
        agentId: "researcher",
        systemSent: false,
        abortedLastRun: true,
        estimatedCost: 0.002,
      },
    ]);

    expect(summary).toMatchObject({
      total: 2,
      inputTokens: 60,
      outputTokens: 120,
      estimatedCost: 0.003,
      systemSent: 1,
      aborted: 1,
      latestUpdatedAt: 250,
    });
  });
});
