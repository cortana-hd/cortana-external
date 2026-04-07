import { describe, expect, it } from "vitest";
import {
  formatInt,
  formatCurrency,
  formatCost,
  formatPercent,
  formatPercentDecimal,
  formatDuration,
  formatNumber,
  formatDecimal,
  formatTimestamp,
  formatRelativeAge,
  formatShortDate,
} from "./format-utils";

describe("format-utils", () => {
  describe("formatInt", () => {
    it("formats integers with locale separators", () => {
      expect(formatInt(1234567)).toBe("1,234,567");
      expect(formatInt(0)).toBe("0");
      expect(formatInt(42.7)).toBe("43");
    });
  });

  describe("formatCurrency", () => {
    it("formats as USD currency without decimals", () => {
      expect(formatCurrency(1234)).toBe("$1,234");
      expect(formatCurrency(0)).toBe("$0");
    });

    it("returns n/a for null/undefined/NaN", () => {
      expect(formatCurrency(null)).toBe("n/a");
      expect(formatCurrency(undefined)).toBe("n/a");
      expect(formatCurrency(NaN)).toBe("n/a");
    });
  });

  describe("formatCost", () => {
    it("formats with 4 decimal places", () => {
      expect(formatCost(1.6554)).toBe("$1.6554");
      expect(formatCost(0)).toBe("$0.0000");
    });
  });

  describe("formatPercent", () => {
    it("formats as rounded percentage", () => {
      expect(formatPercent(85.4)).toBe("85%");
      expect(formatPercent(0)).toBe("0%");
      expect(formatPercent(100)).toBe("100%");
    });

    it("returns — for null/undefined/NaN", () => {
      expect(formatPercent(null)).toBe("—");
      expect(formatPercent(undefined)).toBe("—");
      expect(formatPercent(NaN)).toBe("—");
    });
  });

  describe("formatPercentDecimal", () => {
    it("formats with one decimal", () => {
      expect(formatPercentDecimal(85.43)).toBe("85.4%");
      expect(formatPercentDecimal(0)).toBe("0.0%");
    });

    it("returns n/a for null", () => {
      expect(formatPercentDecimal(null)).toBe("n/a");
    });
  });

  describe("formatDuration", () => {
    it("formats seconds as hours and minutes", () => {
      expect(formatDuration(3600)).toBe("1h 0m");
      expect(formatDuration(5400)).toBe("1h 30m");
      expect(formatDuration(1800)).toBe("30m");
      expect(formatDuration(0)).toBe("0m");
    });

    it("returns — for null", () => {
      expect(formatDuration(null)).toBe("—");
      expect(formatDuration(undefined)).toBe("—");
    });
  });

  describe("formatNumber", () => {
    it("formats with optional suffix", () => {
      expect(formatNumber(72, " bpm")).toBe("72 bpm");
      expect(formatNumber(0)).toBe("0");
    });

    it("returns — for null", () => {
      expect(formatNumber(null)).toBe("—");
    });
  });

  describe("formatDecimal", () => {
    it("formats with one decimal and suffix", () => {
      expect(formatDecimal(14.56, " ms")).toBe("14.6 ms");
      expect(formatDecimal(7, " strain")).toBe("7 strain");
    });

    it("returns — for null", () => {
      expect(formatDecimal(null)).toBe("—");
    });
  });

  describe("formatTimestamp", () => {
    it("formats valid ISO strings", () => {
      const result = formatTimestamp("2026-04-06T20:00:00.000Z");
      expect(result).not.toBe("—");
      expect(result.length).toBeGreaterThan(5);
    });

    it("returns — for null/invalid", () => {
      expect(formatTimestamp(null)).toBe("—");
      expect(formatTimestamp(undefined)).toBe("—");
      expect(formatTimestamp("not-a-date")).toBe("—");
    });
  });

  describe("formatRelativeAge", () => {
    it("returns just now for recent timestamps", () => {
      expect(formatRelativeAge(new Date().toISOString())).toBe("just now");
    });

    it("returns unknown age for null", () => {
      expect(formatRelativeAge(null)).toBe("unknown age");
      expect(formatRelativeAge(undefined)).toBe("unknown age");
    });

    it("formats minutes ago", () => {
      const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
      expect(formatRelativeAge(fiveMinAgo)).toBe("5m ago");
    });

    it("formats hours ago", () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString();
      expect(formatRelativeAge(twoHoursAgo)).toBe("2h ago");
    });

    it("formats days ago", () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 86400_000).toISOString();
      expect(formatRelativeAge(threeDaysAgo)).toBe("3d ago");
    });
  });

  describe("formatShortDate", () => {
    it("formats as short month + day", () => {
      const result = formatShortDate("2026-04-06T20:00:00.000Z");
      expect(result).toContain("Apr");
      expect(result).toContain("6");
    });

    it("returns input for invalid date", () => {
      expect(formatShortDate("not-a-date")).toBe("not-a-date");
    });
  });
});
