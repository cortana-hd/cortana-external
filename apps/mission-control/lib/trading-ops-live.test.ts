import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearTradingOpsLiveRetainedQuotesForTests,
  getTradingOpsLiveRetainedQuoteKeysForTests,
  loadTradingOpsLiveData,
} from "@/lib/trading-ops-live";

async function writeJson(filePath: string, payload: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(payload, null, 2));
}

describe("trading ops live loader", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    clearTradingOpsLiveRetainedQuotesForTests();
    await Promise.all(tempDirs.map(async (dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("builds live tape, derived indexes, and watchlist prices from streamer-backed quotes", async () => {
    const cortanaRepoPath = await mkdtemp(path.join(os.tmpdir(), "trading-ops-live-"));
    tempDirs.push(cortanaRepoPath);

    await writeJson(path.join(cortanaRepoPath, "var", "backtests", "runs", "20260408-163130", "summary.json"), {
      runId: "20260408-163130",
      status: "success",
      completedAt: "2026-04-08T16:31:30.000Z",
    });
    await writeJson(path.join(cortanaRepoPath, "var", "backtests", "runs", "20260408-163130", "watchlist-full.json"), {
      decision: "WATCH",
      focus: { ticker: "ABBV" },
      summary: { buy: 1, watch: 3, noBuy: 0 },
      strategies: {
        dipBuyer: {
          buy: [{ ticker: "ABBV" }],
          watch: [{ ticker: "ACHV" }, { ticker: "ADM" }],
          noBuy: [],
        },
        canslim: {
          buy: [{ ticker: "NVDA" }],
          watch: [{ ticker: "MSFT" }],
          noBuy: [],
        },
      },
    });

    const fetchImpl: typeof fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/market-data/ops")) {
        return new Response(
          JSON.stringify({
            data: {
              serviceOperatorState: "healthy",
              providerMetrics: {
                schwabCooldownUntil: null,
              },
              health: {
                providers: {
                  schwabStreamerMeta: {
                    connected: true,
                    lastLoginAt: "2026-04-08T20:55:00.000Z",
                    operatorState: "healthy",
                    activeSubscriptions: {
                      LEVELONE_EQUITIES: 7,
                      ACCT_ACTIVITY: 1,
                    },
                  },
                },
              },
            },
          }),
        );
      }

      if (url.includes("/market-data/quote/batch")) {
        return new Response(
          JSON.stringify({
            providerMode: "schwab_primary",
            fallbackEngaged: false,
            providerModeReason: "Quotes stayed on the Schwab primary lane.",
            data: {
              items: [
                item("SPY", 510.12, 1.25, "schwab_streamer"),
                item("QQQ", 441.18, 2.1, "schwab_streamer"),
                item("IWM", 206.45, 1.05, "schwab_streamer"),
                item("DIA", 389.45, 2.55, "schwab_streamer"),
                item("GLD", 232.2, -0.33, "schwab_streamer"),
                item("ABBV", 179.11, 0.42, "schwab_streamer"),
                item("ACHV", 6.18, 4.5, "schwab_streamer"),
                item("ADM", 63.77, 0.65, "schwab_streamer"),
                item("NVDA", 122.5, 3.22, "schwab_streamer"),
                item("MSFT", 427.9, 1.98, "schwab_streamer"),
              ],
            },
          }),
        );
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const data = await loadTradingOpsLiveData({
      baseUrl: "http://127.0.0.1:3033",
      cortanaRepoPath,
      fetchImpl,
    });

    expect(data.streamer.connected).toBe(true);
    expect(data.tape.freshnessMessage).toContain("quieter after-hours names are waiting");
    expect(data.tape.providerMode).toBe("schwab_primary");
    expect(data.tape.rows.find((row) => row.symbol === "DOW")?.sourceSymbol).toBe("DIA");
    expect(data.tape.rows.find((row) => row.symbol === "DOW")?.changePercent).toBe(2.55);
    expect(data.tape.rows.find((row) => row.symbol === "NASDAQ")?.sourceSymbol).toBe("QQQ");
    expect(data.watchlists.dipBuyer.watch.map((row) => row.symbol)).toEqual(["ACHV", "ADM"]);
    expect(data.watchlists.canslim.buy.map((row) => row.symbol)).toEqual(["NVDA"]);
    expect(data.meta.runId).toBe("20260408-163130");
    expect(data.meta.runLabel).toBe("Apr 8, 12:31 PM");
    expect(
      (fetchImpl as ReturnType<typeof vi.fn>).mock.calls.some(([input]) =>
        String(input).includes("subsystem=live_watchlists"),
      ),
    ).toBe(true);
  });

  it("keeps symbols visible and marks them degraded when streamer is down or quotes are missing", async () => {
    const cortanaRepoPath = await mkdtemp(path.join(os.tmpdir(), "trading-ops-live-degraded-"));
    tempDirs.push(cortanaRepoPath);

    await writeJson(path.join(cortanaRepoPath, "var", "backtests", "runs", "20260408-193126", "summary.json"), {
      runId: "20260408-193126",
      status: "success",
      completedAt: "2026-04-08T19:31:26.000Z",
    });
    await writeJson(path.join(cortanaRepoPath, "var", "backtests", "runs", "20260408-193126", "watchlist-full.json"), {
      decision: "NO_TRADE",
      summary: { buy: 0, watch: 1, noBuy: 0 },
      strategies: {
        dipBuyer: {
          buy: [],
          watch: [{ ticker: "ABBV" }],
          noBuy: [],
        },
        canslim: {
          buy: [],
          watch: [],
          noBuy: [],
        },
      },
    });

    const fetchImpl: typeof fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/market-data/ops")) {
        return new Response(
          JSON.stringify({
            data: {
              serviceOperatorState: "provider_cooldown",
              providerMetrics: {
                schwabCooldownUntil: "2026-04-08T20:40:00.000Z",
              },
              health: {
                providers: {
                  schwabStreamerMeta: {
                    connected: false,
                    operatorState: "reconnecting",
                    activeSubscriptions: {
                      LEVELONE_EQUITIES: 0,
                      ACCT_ACTIVITY: 0,
                    },
                  },
                },
              },
            },
          }),
        );
      }

      if (url.includes("/market-data/quote/batch")) {
        return new Response(
          JSON.stringify({
            providerMode: "multi_mode",
            fallbackEngaged: false,
            providerModeReason: "Batch response contains more than one provider mode across its items.",
            data: {
              items: [
                {
                  ...item("SPY", 500.1, -1.2, "schwab_streamer_shared"),
                  status: "degraded",
                  degradedReason: "Using last-known Schwab quote for live_watchlists from the after-hours stale window (4m old).",
                  stalenessSeconds: 240,
                },
                {
                  ...item("QQQ", 430.4, -1.8, "schwab_streamer_shared"),
                  status: "degraded",
                  degradedReason: "Using last-known Schwab quote for live_watchlists from the after-hours stale window (4m old).",
                  stalenessSeconds: 240,
                },
                {
                  symbol: "IWM",
                  source: "service",
                  status: "error",
                  degradedReason: "No live Schwab quote available for IWM",
                  providerMode: "unavailable",
                  data: { symbol: "IWM" },
                },
                {
                  symbol: "DIA",
                  source: "service",
                  status: "error",
                  degradedReason: "No live Schwab quote available for DIA",
                  providerMode: "unavailable",
                  data: { symbol: "DIA" },
                },
                {
                  ...item("GLD", 231.8, 0.2, "schwab_streamer_shared"),
                  status: "degraded",
                  degradedReason: "Using last-known Schwab quote for live_watchlists from the after-hours stale window (4m old).",
                  stalenessSeconds: 240,
                },
                {
                  ...item("ABBV", 178.2, -0.45, "schwab_streamer_shared"),
                  status: "degraded",
                  degradedReason: "Using last-known Schwab quote for live_watchlists from the after-hours stale window (4m old).",
                  stalenessSeconds: 240,
                },
              ],
            },
          }),
        );
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const data = await loadTradingOpsLiveData({
      baseUrl: "http://127.0.0.1:3033",
      cortanaRepoPath,
      fetchImpl,
    });

    expect(data.streamer.connected).toBe(false);
    expect(data.streamer.cooldownSummary).toContain("REST cooldown");
    expect(data.tape.freshnessMessage).toContain("Using last-known Schwab quotes while the streamer reconnects");
    expect(data.tape.providerMode).toBe("multi_mode");
    expect(data.tape.rows.find((row) => row.symbol === "DOW")?.state).toBe("error");
    expect(data.watchlists.dipBuyer.watch[0]).toMatchObject({
      symbol: "ABBV",
      state: "degraded",
      stalenessSeconds: 240,
    });
    expect(data.meta.runLabel).toBe("Apr 8, 3:31 PM");
  });

  it("keeps after-hours Schwab quotes visible as stale rows with age markers", async () => {
    const cortanaRepoPath = await mkdtemp(path.join(os.tmpdir(), "trading-ops-live-after-hours-"));
    tempDirs.push(cortanaRepoPath);

    await writeJson(path.join(cortanaRepoPath, "var", "backtests", "runs", "20260410-170400", "summary.json"), {
      runId: "20260410-170400",
      status: "success",
      completedAt: "2026-04-10T21:04:00.000Z",
    });
    await writeJson(path.join(cortanaRepoPath, "var", "backtests", "runs", "20260410-170400", "watchlist-full.json"), {
      decision: "WATCH",
      summary: { buy: 0, watch: 1, noBuy: 0 },
      strategies: {
        dipBuyer: {
          buy: [],
          watch: [{ ticker: "ABBV" }],
          noBuy: [],
        },
        canslim: {
          buy: [],
          watch: [],
          noBuy: [],
        },
      },
    });

    const fetchImpl: typeof fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/market-data/ops")) {
        return new Response(
          JSON.stringify({
            data: {
              serviceOperatorState: "healthy",
              providerMetrics: {
                schwabCooldownUntil: null,
              },
              health: {
                providers: {
                  schwabStreamerMeta: {
                    connected: true,
                    lastLoginAt: "2026-04-10T21:00:00.000Z",
                    operatorState: "healthy",
                    activeSubscriptions: {
                      LEVELONE_EQUITIES: 4,
                      ACCT_ACTIVITY: 0,
                    },
                  },
                },
              },
            },
          }),
        );
      }

      if (url.includes("/market-data/quote/batch")) {
        return new Response(
          JSON.stringify({
            providerMode: "schwab_primary",
            fallbackEngaged: false,
            providerModeReason: "Quote stayed on the Schwab after-hours stale lane for live_watchlists.",
            data: {
              items: [
                item("SPY", 679.97, 0.01, "schwab_streamer"),
                {
                  ...item("QQQ", 611.97, 0.29, "schwab_streamer_shared"),
                  status: "degraded",
                  degradedReason: "Using last-known Schwab quote for live_watchlists from the after-hours stale window (5m old).",
                  stalenessSeconds: 300,
                },
                {
                  ...item("ABBV", 177.12, -0.12, "schwab_streamer_shared"),
                  status: "degraded",
                  degradedReason: "Using last-known Schwab quote for live_watchlists from the after-hours stale window (5m old).",
                  stalenessSeconds: 300,
                },
              ],
            },
          }),
        );
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const data = await loadTradingOpsLiveData({
      baseUrl: "http://127.0.0.1:3033",
      cortanaRepoPath,
      fetchImpl,
    });

    expect(data.tape.freshnessMessage).toContain("holding their last Schwab after-hours update");
    expect(data.tape.rows.find((row) => row.symbol === "QQQ")).toMatchObject({
      state: "degraded",
      stalenessSeconds: 300,
    });
    expect(data.watchlists.dipBuyer.watch[0]).toMatchObject({
      symbol: "ABBV",
      state: "degraded",
      stalenessSeconds: 300,
    });
  });

  it("retains last-known Schwab rows across an after-hours reload and keeps DOW tied to DIA", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-10T22:00:00.000Z"));
    try {
      const cortanaRepoPath = await mkdtemp(path.join(os.tmpdir(), "trading-ops-live-retained-"));
      tempDirs.push(cortanaRepoPath);

      await writeJson(path.join(cortanaRepoPath, "var", "backtests", "runs", "20260410-204400", "summary.json"), {
        runId: "20260410-204400",
        status: "success",
        completedAt: "2026-04-10T20:44:00.000Z",
      });
      await writeJson(path.join(cortanaRepoPath, "var", "backtests", "runs", "20260410-204400", "watchlist-full.json"), {
        decision: "WATCH",
        summary: { buy: 0, watch: 0, noBuy: 0 },
        strategies: {
          dipBuyer: { buy: [], watch: [], noBuy: [] },
          canslim: { buy: [], watch: [], noBuy: [] },
        },
      });

      let phase = 0;
      const fetchImpl: typeof fetch = vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/market-data/ops")) {
          return new Response(
            JSON.stringify({
              data: {
                serviceOperatorState: "healthy",
                providerMetrics: {
                  schwabCooldownUntil: null,
                },
                health: {
                  providers: {
                    schwabStreamerMeta: {
                      connected: true,
                      lastLoginAt: "2026-04-10T21:58:00.000Z",
                      operatorState: "healthy",
                      activeSubscriptions: {
                        LEVELONE_EQUITIES: 4,
                        ACCT_ACTIVITY: 0,
                      },
                    },
                  },
                },
              },
            }),
          );
        }

        if (url.includes("/market-data/quote/batch")) {
          const firstPhaseItems =
            phase === 0
              ? [
                  itemAt("SPY", 679.97, 0.01, "schwab_streamer", "2026-04-10T22:00:00.000Z"),
                  itemAt("QQQ", 611.97, 0.29, "schwab_streamer", "2026-04-10T22:00:00.000Z"),
                  itemAt("IWM", 261.41, -0.21, "schwab_streamer", "2026-04-10T22:00:00.000Z"),
                  itemAt("DIA", 479.05, -0.59, "schwab_streamer", "2026-04-10T22:00:00.000Z"),
                  itemAt("GLD", 436.1, -0.41, "schwab_streamer", "2026-04-10T22:00:00.000Z"),
                ]
              : [
                item("SPY", 680.01, 0.02, "schwab_streamer"),
              ];

          return new Response(
            JSON.stringify({
              providerMode: phase === 0 ? "schwab_primary" : "multi_mode",
              fallbackEngaged: false,
              providerModeReason:
                phase === 0
                  ? "Quotes stayed on the Schwab primary lane."
                  : "Batch response contains more than one provider mode across its items.",
              data: {
                items: firstPhaseItems,
              },
            }),
          );
        }

        throw new Error(`Unexpected URL: ${url}`);
      });

      const firstLoad = await loadTradingOpsLiveData({
        baseUrl: "http://127.0.0.1:3033",
        cortanaRepoPath,
        fetchImpl,
      });
      expect(getTradingOpsLiveRetainedQuoteKeysForTests()).toEqual(expect.arrayContaining(["QQQ", "IWM", "DIA"]));
      expect(firstLoad.tape.rows.find((row) => row.symbol === "DOW")).toMatchObject({
        state: "ok",
        sourceSymbol: "DIA",
        price: 479.05,
      });

      phase = 1;
      vi.setSystemTime(new Date("2026-04-10T22:05:00.000Z"));

      const secondLoad = await loadTradingOpsLiveData({
        baseUrl: "http://127.0.0.1:3033",
        cortanaRepoPath,
        fetchImpl,
      });

      expect(secondLoad.streamer.connected).toBe(true);
      expect(secondLoad.tape.rows.find((row) => row.symbol === "IWM")).toMatchObject({
        state: "degraded",
        price: 261.41,
        warning: expect.stringContaining("last known Schwab quote"),
      });
      expect(secondLoad.tape.rows.find((row) => row.symbol === "QQQ")).toMatchObject({
        state: "degraded",
        price: 611.97,
      });
      expect(secondLoad.tape.rows.find((row) => row.symbol === "DOW")).toMatchObject({
        state: "degraded",
        sourceSymbol: "DIA",
        price: 479.05,
        warning: expect.stringContaining("last known Schwab quote"),
      });
      expect(secondLoad.tape.freshnessMessage).toContain("holding their last Schwab after-hours update");
    } finally {
      vi.useRealTimers();
    }
  });

  it("expires retained Schwab rows after the bounded after-hours window and marks them unavailable", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-10T22:00:00.000Z"));
    try {
      const cortanaRepoPath = await mkdtemp(path.join(os.tmpdir(), "trading-ops-live-expired-"));
      tempDirs.push(cortanaRepoPath);

      await writeJson(path.join(cortanaRepoPath, "var", "backtests", "runs", "20260410-204400", "summary.json"), {
        runId: "20260410-204400",
        status: "success",
        completedAt: "2026-04-10T20:44:00.000Z",
      });
      await writeJson(path.join(cortanaRepoPath, "var", "backtests", "runs", "20260410-204400", "watchlist-full.json"), {
        decision: "WATCH",
        summary: { buy: 0, watch: 0, noBuy: 0 },
        strategies: {
          dipBuyer: { buy: [], watch: [], noBuy: [] },
          canslim: { buy: [], watch: [], noBuy: [] },
        },
      });

      let phase = 0;
      const fetchImpl: typeof fetch = vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/market-data/ops")) {
          return new Response(
            JSON.stringify({
              data: {
                serviceOperatorState: "healthy",
                providerMetrics: {
                  schwabCooldownUntil: null,
                },
                health: {
                  providers: {
                    schwabStreamerMeta: {
                      connected: true,
                      lastLoginAt: "2026-04-10T21:58:00.000Z",
                      operatorState: "healthy",
                      activeSubscriptions: {
                        LEVELONE_EQUITIES: 4,
                        ACCT_ACTIVITY: 0,
                      },
                    },
                  },
                },
              },
            }),
          );
        }

        if (url.includes("/market-data/quote/batch")) {
          const items =
            phase === 0
              ? [
                  itemAt("SPY", 679.97, 0.01, "schwab_streamer", "2026-04-10T22:00:00.000Z"),
                  itemAt("QQQ", 611.97, 0.29, "schwab_streamer", "2026-04-10T22:00:00.000Z"),
                  itemAt("IWM", 261.41, -0.21, "schwab_streamer", "2026-04-10T22:00:00.000Z"),
                  itemAt("DIA", 479.05, -0.59, "schwab_streamer", "2026-04-10T22:00:00.000Z"),
                ]
              : [];

          return new Response(
            JSON.stringify({
              providerMode: phase === 0 ? "schwab_primary" : "multi_mode",
              fallbackEngaged: false,
              providerModeReason:
                phase === 0
                  ? "Quotes stayed on the Schwab primary lane."
                  : "Batch response contains more than one provider mode across its items.",
              data: { items },
            }),
          );
        }

        throw new Error(`Unexpected URL: ${url}`);
      });

      await loadTradingOpsLiveData({
        baseUrl: "http://127.0.0.1:3033",
        cortanaRepoPath,
        fetchImpl,
      });

      phase = 1;
      vi.setSystemTime(new Date("2026-04-10T22:18:00.000Z"));

      const firstQuietGap = await loadTradingOpsLiveData({
        baseUrl: "http://127.0.0.1:3033",
        cortanaRepoPath,
        fetchImpl,
      });

      expect(firstQuietGap.tape.rows.find((row) => row.symbol === "IWM")).toMatchObject({
        state: "degraded",
        price: null,
        warning: "No after-hours Schwab quote has arrived for this symbol yet.",
      });
      expect(firstQuietGap.tape.rows.find((row) => row.symbol === "DOW")).toMatchObject({
        state: "degraded",
        price: null,
        warning: "No after-hours Schwab quote has arrived for this symbol yet.",
      });
      expect(firstQuietGap.tape.freshnessMessage).toBe(
        "Streamer is connected, but no followed symbols have printed a fresh after-hours Schwab quote yet.",
      );

      vi.setSystemTime(new Date("2026-04-10T22:21:00.000Z"));

      const secondQuietGap = await loadTradingOpsLiveData({
        baseUrl: "http://127.0.0.1:3033",
        cortanaRepoPath,
        fetchImpl,
      });

      expect(secondQuietGap.tape.rows.find((row) => row.symbol === "IWM")).toMatchObject({
        state: "degraded",
        price: null,
        warning: "No after-hours Schwab quote has arrived for this symbol yet.",
      });
      expect(secondQuietGap.tape.freshnessMessage).toBe(
        "Streamer is connected, but no followed symbols have printed a fresh after-hours Schwab quote yet.",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("describes partial live batch failures without claiming the streamer is reconnecting", async () => {
    const cortanaRepoPath = await mkdtemp(path.join(os.tmpdir(), "trading-ops-live-partial-"));
    tempDirs.push(cortanaRepoPath);

    await writeJson(path.join(cortanaRepoPath, "var", "backtests", "runs", "20260410-154400", "summary.json"), {
      runId: "20260410-154400",
      status: "success",
      completedAt: "2026-04-10T19:44:00.000Z",
    });
    await writeJson(path.join(cortanaRepoPath, "var", "backtests", "runs", "20260410-154400", "watchlist-full.json"), {
      decision: "WATCH",
      summary: { buy: 0, watch: 0, noBuy: 0 },
      strategies: {
        dipBuyer: { buy: [], watch: [], noBuy: [] },
        canslim: { buy: [], watch: [], noBuy: [] },
      },
    });

    const fetchImpl: typeof fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/market-data/ops")) {
        return new Response(
          JSON.stringify({
            data: {
              serviceOperatorState: "provider_cooldown",
              providerMetrics: {
                schwabCooldownUntil: "2026-04-10T21:09:36.771Z",
              },
              health: {
                providers: {
                  schwabStreamerMeta: {
                    connected: true,
                    lastLoginAt: "2026-04-10T21:04:00.000Z",
                    operatorState: "healthy",
                    activeSubscriptions: {
                      LEVELONE_EQUITIES: 5,
                      ACCT_ACTIVITY: 0,
                    },
                  },
                },
              },
            },
          }),
        );
      }

      if (url.includes("/market-data/quote/batch")) {
        return new Response(
          JSON.stringify({
            providerMode: "multi_mode",
            fallbackEngaged: false,
            providerModeReason: "Batch response contains more than one provider mode across its items.",
            data: {
              items: [
                item("SPY", 679.97, 0.01, "schwab_streamer"),
                item("QQQ", 611.97, 0.29, "schwab_streamer"),
                {
                  symbol: "IWM",
                  source: "service",
                  status: "error",
                  degradedReason: "HTTP 401",
                  providerMode: "unavailable",
                  data: { symbol: "IWM" },
                },
                {
                  symbol: "DIA",
                  source: "service",
                  status: "error",
                  degradedReason: "HTTP 401",
                  providerMode: "unavailable",
                  data: { symbol: "DIA" },
                },
                {
                  symbol: "GLD",
                  source: "service",
                  status: "error",
                  degradedReason: "HTTP 401",
                  providerMode: "unavailable",
                  data: { symbol: "GLD" },
                },
              ],
            },
          }),
        );
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const data = await loadTradingOpsLiveData({
      baseUrl: "http://127.0.0.1:3033",
      cortanaRepoPath,
      referenceTime: new Date("2026-04-10T19:44:00.000Z"),
      fetchImpl,
    });

    expect(data.streamer.connected).toBe(true);
    expect(data.tape.providerMode).toBe("multi_mode");
    expect(data.tape.freshnessMessage).toContain("Streamer is connected and some quotes are fresh");
    expect(data.tape.freshnessMessage).not.toContain("reconnecting");
    expect(data.tape.rows.find((row) => row.symbol === "SPY")?.state).toBe("ok");
    expect(data.tape.rows.find((row) => row.symbol === "DOW")?.state).toBe("error");
  });
});

function item(symbol: string, price: number, changePercent: number, source: string) {
  return itemAt(symbol, price, changePercent, source, "2026-04-08T19:31:28.000Z");
}

function itemAt(symbol: string, price: number, changePercent: number, source: string, timestamp: string) {
  return {
    symbol,
    source,
    status: "ok",
    degradedReason: null,
    stalenessSeconds: 0,
    data: {
      symbol,
      price,
      changePercent,
      timestamp,
    },
  };
}
