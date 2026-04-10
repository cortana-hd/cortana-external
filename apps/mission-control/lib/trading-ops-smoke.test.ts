import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadLatestArtifactRun, shouldTolerateInFlightRunAheadOfArtifact } from "./trading-ops-smoke";

const tempDirs: string[] = [];

describe("loadLatestArtifactRun", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Test cleanup should never fail the suite.
      }
    }
  });

  it("skips incomplete newer run directories and returns the latest complete run", async () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "trading-ops-smoke-"));
    tempDirs.push(repoRoot);
    const runsRoot = path.join(repoRoot, "var", "backtests", "runs");
    mkdirSync(runsRoot, { recursive: true });

    mkdirSync(path.join(runsRoot, "20260407-193148"), { recursive: true });

    const completeRun = path.join(runsRoot, "20260407-192452");
    mkdirSync(completeRun, { recursive: true });
    writeFileSync(
      path.join(completeRun, "summary.json"),
      JSON.stringify({
        runId: "20260407-192452",
        status: "success",
        completedAt: "2026-04-07T19:34:08.972Z",
        notifiedAt: "2026-04-07T19:34:17.849Z",
        metrics: { decision: "NO_TRADE", buy: 0, watch: 0, noBuy: 96 },
      }),
    );
    writeFileSync(
      path.join(completeRun, "watchlist-full.json"),
      JSON.stringify({
        decision: "NO_TRADE",
        summary: { buy: 0, watch: 0, noBuy: 96 },
      }),
    );

    const latest = await loadLatestArtifactRun(repoRoot);

    expect(latest).toMatchObject({
      runId: "20260407-192452",
      status: "success",
      decision: "NO_TRADE",
      buyCount: 0,
      watchCount: 0,
      noBuyCount: 96,
      completedAt: "2026-04-07T19:34:08.972Z",
      notifiedAt: "2026-04-07T19:34:17.849Z",
    });
  });
});

describe("shouldTolerateInFlightRunAheadOfArtifact", () => {
  it("allows a newer running DB run to lead the latest completed artifact", () => {
    expect(
      shouldTolerateInFlightRunAheadOfArtifact(
        {
          runId: "20260410-163223",
          status: "running",
          completedAt: null,
          notifiedAt: null,
        },
        { runId: "20260410-133146" },
      ),
    ).toBe(true);
  });

  it("does not allow completed or older runs to bypass artifact parity", () => {
    expect(
      shouldTolerateInFlightRunAheadOfArtifact(
        {
          runId: "20260410-133146",
          status: "running",
          completedAt: null,
          notifiedAt: null,
        },
        { runId: "20260410-163223" },
      ),
    ).toBe(false);

    expect(
      shouldTolerateInFlightRunAheadOfArtifact(
        {
          runId: "20260410-163223",
          status: "success",
          completedAt: "2026-04-10T16:45:00.000Z",
          notifiedAt: null,
        },
        { runId: "20260410-133146" },
      ),
    ).toBe(false);
  });
});
