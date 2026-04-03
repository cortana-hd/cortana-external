"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

type AutoRefreshProps = {
  intervalMs?: number;
  sourceUrl?: string;
  refreshEvents?: string[];
};

const DEFAULT_REFRESH_EVENTS = ["ready", "tick"];

export function AutoRefresh({
  intervalMs = 10_000,
  sourceUrl = "/api/live",
  refreshEvents = DEFAULT_REFRESH_EVENTS,
}: AutoRefreshProps) {
  const router = useRouter();

  useEffect(() => {
    let stopped = false;
    let source: EventSource | null = null;
    let fallbackInterval: number | null = null;

    const refresh = () => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    };

    const disconnect = () => {
      source?.close();
      source = null;
    };

    const startFallback = () => {
      if (fallbackInterval !== null || document.visibilityState !== "visible") return;
      fallbackInterval = window.setInterval(refresh, intervalMs);
    };

    const stopFallback = () => {
      if (fallbackInterval !== null) {
        window.clearInterval(fallbackInterval);
        fallbackInterval = null;
      }
    };

    const connect = () => {
      if (stopped || source || document.visibilityState !== "visible") return;
      try {
        source = new EventSource(sourceUrl);
        for (const eventName of refreshEvents) {
          source.addEventListener(eventName, refresh);
        }
        source.onerror = () => {
          disconnect();
          startFallback();
          window.setTimeout(() => {
            if (!stopped && document.visibilityState === "visible") {
              connect();
            }
          }, 1500);
        };
      } catch {
        startFallback();
      }
    };

    connect();

    const onFocus = () => refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        stopFallback();
        connect();
        refresh();
        return;
      }

      disconnect();
      stopFallback();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      disconnect();
      stopFallback();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs, refreshEvents, router, sourceUrl]);

  return null;
}
