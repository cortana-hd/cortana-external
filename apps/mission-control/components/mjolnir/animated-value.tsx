"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const FORMAT_PRESETS = {
  integer: (v: number) => Math.round(v).toString(),
  decimal: (v: number) => v.toFixed(1),
  percent: (v: number) => `${v.toFixed(1)}%`,
} as const;

type FormatPreset = keyof typeof FORMAT_PRESETS;

/**
 * Animates a number from 0 to `value` on mount with ease-out easing.
 * Inspired by healthmetrics ProgressSummary.
 */
export function AnimatedValue({
  value,
  formatPreset = "integer",
  duration = 1200,
  className,
}: {
  value: number | null;
  formatPreset?: FormatPreset;
  duration?: number;
  className?: string;
}) {
  const format = FORMAT_PRESETS[formatPreset];
  const [display, setDisplay] = useState<string>(value != null ? "0" : "\u2014");
  const rafRef = useRef(0);

  useEffect(() => {
    if (value == null || Number.isNaN(value)) {
      setDisplay("\u2014");
      return;
    }

    const start = performance.now();

    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      // Ease-out quad
      const eased = 1 - (1 - t) * (1 - t);
      setDisplay(format(value * eased));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration, format]);

  return <span className={cn("tabular-nums", className)}>{display}</span>;
}
