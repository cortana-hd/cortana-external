import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SystemStatsClient from "@/app/system-stats/system-stats-client";

const jsonResponse = (payload: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }) as Response;

describe("SystemStatsClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows loading state initially", () => {
    vi.spyOn(global, "fetch").mockImplementation(() => new Promise(() => {}));

    render(<SystemStatsClient />);
    expect(screen.getByText("Loading system stats...")).toBeInTheDocument();
  });

  it("renders host, gateway, and session health cards", async () => {
    const now = Date.now();
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          lastHeartbeat: now,
          status: "healthy",
          ageMs: 60_000,
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          idle: false,
          current: "Monitoring 2 active sub-agents...",
          items: ["Monitoring 2 active sub-agents..."],
          updatedAt: new Date(now).toISOString(),
          metrics: { activeSubagents: 2, inProgressTasks: 3, completedRecently: 1 },
          heartbeat: { status: "healthy", ageMs: 60_000, lastHeartbeat: now },
        })
      )
      .mockResolvedValueOnce(jsonResponse({ postgres: true, lancedb: false }))
      .mockResolvedValueOnce(
        jsonResponse({
          sessions: [
            { updatedAt: now - 5 * 60 * 1000, abortedLastRun: false, agentId: "a", sessionId: "s1" },
          ],
        })
      );

    render(<SystemStatsClient />);

    expect(await screen.findByText("Host health")).toBeInTheDocument();
    expect(screen.getByText("Gateway health")).toBeInTheDocument();
    expect(screen.getByText("Session health")).toBeInTheDocument();
    expect(await screen.findByText("Offline")).toBeInTheDocument();
  });
});
