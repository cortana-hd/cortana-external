import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadTradingOpsLiveData } from "@/lib/trading-ops-live";

async function writeJson(filePath: string, payload: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(payload, null, 2));
}

describe("trading ops live loader", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
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
    expect(data.tape.freshnessMessage).toContain("Schwab streamer");
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
            providerMode: "alpaca_fallback",
            fallbackEngaged: true,
            providerModeReason: "Quotes entered the declared Alpaca fallback lane for live watchlists.",
            data: {
              items: [
                item("SPY", 500.1, -1.2, "schwab"),
                item("QQQ", 430.4, -1.8, "schwab"),
                item("IWM", 201.2, -0.7, "schwab"),
                {
                  symbol: "DIA",
                  source: "service",
                  status: "error",
                  degradedReason: "HTTP 503",
                  data: { symbol: "DIA" },
                },
                item("GLD", 231.8, 0.2, "schwab"),
                {
                  symbol: "ABBV",
                  source: "schwab",
                  status: "degraded",
                  degradedReason: "using fallback quote",
                  data: {
                    symbol: "ABBV",
                    price: 178.2,
                    changePercent: -0.45,
                    timestamp: "2026-04-08T19:31:28.000Z",
                  },
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
    expect(data.tape.freshnessMessage).toContain("declared Alpaca fallback lane");
    expect(data.tape.providerMode).toBe("alpaca_fallback");
    expect(data.tape.rows.find((row) => row.symbol === "DOW")?.state).toBe("error");
    expect(data.watchlists.dipBuyer.watch[0]).toMatchObject({
      symbol: "ABBV",
      state: "degraded",
    });
    expect(data.meta.runLabel).toBe("Apr 8, 3:31 PM");
  });
});

function item(symbol: string, price: number, changePercent: number, source: string) {
  return {
    symbol,
    source,
    status: "ok",
    degradedReason: null,
    data: {
      symbol,
      price,
      changePercent,
      timestamp: "2026-04-08T19:31:28.000Z",
    },
  };
}
