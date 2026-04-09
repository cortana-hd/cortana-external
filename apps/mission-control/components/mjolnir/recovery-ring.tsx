"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

const statusColor = (status: string) => {
  if (status === "green") return "text-emerald-600 dark:text-emerald-400";
  if (status === "yellow") return "text-amber-500 dark:text-amber-400";
  if (status === "red") return "text-red-500 dark:text-red-400";
  return "text-muted-foreground";
};

const statusBadgeVariant = (status: string) => {
  if (status === "green") return "success" as const;
  if (status === "yellow") return "warning" as const;
  if (status === "red") return "destructive" as const;
  return "outline" as const;
};

const statusStrokeClass = (status: string) => {
  if (status === "green") return "stroke-emerald-500 dark:stroke-emerald-400";
  if (status === "yellow") return "stroke-amber-500 dark:stroke-amber-400";
  if (status === "red") return "stroke-red-500 dark:stroke-red-400";
  return "stroke-muted-foreground";
};

export function RecoveryRingAnimated({ score, status }: { score: number | null; status: string }) {
  const [displayScore, setDisplayScore] = useState(0);
  const [displayOffset, setDisplayOffset] = useState<number | null>(null);
  const rafRef = useRef(0);

  const r = 42;
  const circumference = 2 * Math.PI * r;
  const targetPct = score != null ? Math.max(0, Math.min(100, score)) : 0;
  const targetOffset = circumference - (targetPct / 100) * circumference;

  useEffect(() => {
    if (score == null) {
      setDisplayScore(0);
      setDisplayOffset(circumference);
      return;
    }

    const start = performance.now();
    const duration = 1400;

    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      // Ease-out cubic
      const eased = 1 - (1 - t) ** 3;
      setDisplayScore(Math.round(targetPct * eased));
      setDisplayOffset(circumference - (targetPct * eased / 100) * circumference);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [score, targetPct, circumference]);

  return (
    <div className="relative flex-shrink-0" style={{ width: "7rem", height: "7rem" }}>
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        {/* Track */}
        <circle
          cx="50" cy="50" r={r}
          fill="none"
          strokeWidth="6"
          className="stroke-muted/20"
        />
        {/* Fill */}
        <circle
          cx="50" cy="50" r={r}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={displayOffset ?? circumference}
          className={cn("transition-colors", statusStrokeClass(status))}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn("text-2xl font-bold font-mono tabular-nums", statusColor(status))}>
          {score != null ? displayScore : "\u2014"}
        </span>
        <Badge variant={statusBadgeVariant(status)} className="mt-0.5 text-[9px]">
          {status}
        </Badge>
      </div>
    </div>
  );
}
