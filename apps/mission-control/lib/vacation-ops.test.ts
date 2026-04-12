import { describe, expect, it } from "vitest";
import {
  computeNextSummaryAt,
  deriveVacationDisplayMode,
  formatVacationSystemLabel,
  formatVacationWindowLabel,
} from "@/lib/vacation-ops";

describe("vacation ops helpers", () => {
  it("formats system keys into readable labels", () => {
    expect(formatVacationSystemLabel("tailscale_remote_access")).toBe("Tailscale Remote Access");
    expect(formatVacationSystemLabel("green_baseline")).toBe("Green Baseline");
  });

  it("formats vacation window labels into operator dates", () => {
    expect(formatVacationWindowLabel("vacation-2026-04-13")).toBe("04-13-2026");
    expect(formatVacationWindowLabel("custom-label")).toBe("custom-label");
  });

  it("treats completed windows as inactive display state", () => {
    expect(deriveVacationDisplayMode(null, { status: "completed" })).toBe("inactive");
    expect(deriveVacationDisplayMode(null, { status: "ready" })).toBe("ready");
    expect(deriveVacationDisplayMode({ status: "active" }, { status: "ready" })).toBe("active");
  });

  it("computes the next summary time from the active window timezone", () => {
    const next = computeNextSummaryAt(
      { morning: "08:00", evening: "20:00" },
      {
        id: 1,
        label: "vacation-2026-04-13",
        status: "active",
        timezone: "America/New_York",
        startAt: "2026-04-13T12:00:00.000Z",
        endAt: "2026-04-20T12:00:00.000Z",
        prepRecommendedAt: null,
        prepStartedAt: null,
        prepCompletedAt: null,
        enabledAt: null,
        disabledAt: null,
        disableReason: null,
        triggerSource: "manual_command",
        createdBy: "hamel",
        configSnapshot: {},
        stateSnapshot: {},
        createdAt: "2026-04-12T12:00:00.000Z",
        updatedAt: "2026-04-12T12:00:00.000Z",
      },
      new Date("2026-04-12T14:00:00.000Z"),
    );

    expect(next).toBe("2026-04-13T00:00:00.000Z");
  });
});
