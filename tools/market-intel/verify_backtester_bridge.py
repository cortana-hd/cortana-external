#!/usr/bin/env python3
"""Runtime check that Python can consume the latest market-intel artifacts."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
BACKTESTER_DIR = ROOT / "backtester"
sys.path.insert(0, str(BACKTESTER_DIR))

from data.polymarket_context import load_compact_context, load_watchlist_entries  # noqa: E402


def main() -> int:
    report_path = Path(
        os.getenv(
            "POLYMARKET_REPORT_JSON_PATH",
            str(ROOT / "var" / "market-intel" / "polymarket" / "latest-report.json"),
        )
    )

    context = load_compact_context(max_age_hours=float(os.getenv("MAX_ARTIFACT_AGE_HOURS", "8")))
    if not context:
        print("bridge check failed: compact Polymarket context is unavailable", file=sys.stderr)
        return 1

    watchlist_entries = load_watchlist_entries(
        max_age_hours=float(os.getenv("MAX_ARTIFACT_AGE_HOURS", "8"))
    )
    if not watchlist_entries:
        print("bridge check failed: fresh Polymarket watchlist entries are unavailable", file=sys.stderr)
        return 1

    try:
        payload = json.loads(report_path.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"bridge check failed: unable to read latest report JSON ({exc})", file=sys.stderr)
        return 1

    overlay = str(payload.get("overlay", {}).get("alignment", "")).strip()
    print(
        json.dumps(
            {
                "ok": True,
                "overlay": overlay or None,
                "watchlist_count": len(watchlist_entries),
                "context_lines": len(context.splitlines()),
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
