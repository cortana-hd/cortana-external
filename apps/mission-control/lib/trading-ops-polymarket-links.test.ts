import { describe, expect, it } from "vitest";

import { getPolymarketLiveEventLink } from "@/lib/trading-ops-polymarket-links";

describe("getPolymarketLiveEventLink", () => {
  it("links current rate-cut, hike, and CPI bucket titles to symbol themes", () => {
    expect(getPolymarketLiveEventLink("Cut 25bps", "Fed Decision in April")?.theme).toBe("rates");
    expect(getPolymarketLiveEventLink("Hike >25bps", "Fed Decision in April")?.theme).toBe("rates");
    expect(getPolymarketLiveEventLink("Exactly 3.9", "CPI year-over-year in April")?.theme).toBe("inflation");
  });

  it("ignores titles that do not match a live Polymarket signal mapping", () => {
    expect(getPolymarketLiveEventLink("Local weather", "City update")).toBeNull();
  });
});
