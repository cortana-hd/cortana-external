/**
 * Shared formatting utilities for Mission Control.
 *
 * Consolidates duplicate formatters that were previously scattered
 * across 10+ files into one canonical source.
 */

const intFmt = new Intl.NumberFormat("en-US");

const currencyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** Format a number as a locale-separated integer (e.g. "1,234"). */
export function formatInt(value: number): string {
  return intFmt.format(Math.round(value));
}

/** Format a dollar amount for display (e.g. "$1,234"). Null-safe. */
export function formatCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "n/a";
  return currencyFmt.format(value);
}

/** Format a cost with 4 decimal places (e.g. "$1.6554"). */
export function formatCost(value: number): string {
  return `$${value.toFixed(4)}`;
}

/** Format a percentage (e.g. "85%"). Null-safe, returns "—" for missing. */
export function formatPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${Math.round(value)}%`;
}

/** Format a percentage with one decimal (e.g. "85.0%"). Null-safe. */
export function formatPercentDecimal(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "n/a";
  return `${value.toFixed(1)}%`;
}

/** Format seconds as "Xh Ym" or "Ym" for durations. Null-safe. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  if (hrs <= 0) return `${mins}m`;
  return `${hrs}h ${mins}m`;
}

/** Format a number with optional suffix (e.g. "72 bpm"). Null-safe. */
export function formatNumber(value: number | null, suffix = ""): string {
  if (value == null) return "—";
  return `${Math.round(value)}${suffix}`;
}

/** Format a number with one decimal place and optional suffix. Null-safe. */
export function formatDecimal(value: number | null, suffix = ""): string {
  if (value == null) return "—";
  return `${Math.round(value * 10) / 10}${suffix}`;
}

/** Format an ISO timestamp as a locale string. Null-safe. */
export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

/** Format an ISO timestamp as a relative age string (e.g. "5m ago"). */
export function formatRelativeAge(iso: string | null | undefined): string {
  if (!iso) return "unknown age";
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return "unknown age";
  const deltaMs = Date.now() - timestamp;
  if (deltaMs < 60_000) return "just now";
  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;
  if (hours < 48)
    return remainderMinutes === 0 ? `${hours}h ago` : `${hours}h ${remainderMinutes}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Format a short date (e.g. "Apr 6"). */
export function formatShortDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
