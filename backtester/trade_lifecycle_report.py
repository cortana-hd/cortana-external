#!/usr/bin/env python3
"""Render compact lifecycle status from paper ledgers."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from lifecycle.ledgers import LifecycleLedgerStore


def build_report(*, root: Path | None = None) -> dict[str, Any]:
    store = LifecycleLedgerStore(root=root)
    cycle = store.load_artifact("cycle_summary.json")
    reviews_payload = store.load_artifact("position_reviews.json")
    open_positions = store.load_open_positions()
    closed_positions = store.load_closed_positions()
    reviews = list(reviews_payload.get("reviews", []) or [])
    summary = dict(cycle.get("summary", {}) or {})
    return {
        "artifact_family": "trade_lifecycle_report",
        "summary": {
            "opened_count": int(summary.get("opened_count", 0) or 0),
            "closed_count": int(summary.get("closed_count", 0) or 0),
            "open_count": len(open_positions),
            "closed_total_count": len(closed_positions),
        },
        "open_positions": [position.to_dict() for position in open_positions],
        "closed_positions": [position.to_dict() for position in closed_positions[-5:]],
        "reviews": reviews[-5:],
    }


def render_report(report: dict[str, Any]) -> str:
    summary = dict(report.get("summary", {}) or {})
    lines = [
        "Trade lifecycle",
        "",
        "Takeaway",
        (
            f"- Open {summary.get('open_count', 0)} | "
            f"Opened this run {summary.get('opened_count', 0)} | "
            f"Closed this run {summary.get('closed_count', 0)} | "
            f"Closed total {summary.get('closed_total_count', 0)}"
        ),
    ]

    open_positions = list(report.get("open_positions", []) or [])
    lines.extend(["", "Open positions"])
    if not open_positions:
        lines.append("- none")
    else:
        for position in open_positions[:5]:
            unrealized = position.get("unrealized_return_pct")
            unrealized_text = (
                f"{float(unrealized):+.1f}%"
                if isinstance(unrealized, (int, float))
                else "pending"
            )
            lines.append(
                f"- {position.get('symbol')} | {position.get('strategy')} | "
                f"{position.get('size_tier') or 'unsized'} | {unrealized_text}"
            )

    closed_positions = list(report.get("closed_positions", []) or [])
    lines.extend(["", "Recent exits"])
    if not closed_positions:
        lines.append("- none")
    else:
        for position in closed_positions[:5]:
            realized = position.get("realized_return_pct")
            realized_text = (
                f"{float(realized):+.1f}%"
                if isinstance(realized, (int, float))
                else "n/a"
            )
            lines.append(
                f"- {position.get('symbol')} | {position.get('exit_reason') or 'closed'} | {realized_text}"
            )

    reviews = list(report.get("reviews", []) or [])
    lines.extend(["", "Recent reviews"])
    if not reviews:
        lines.append("- none")
    else:
        for review in reviews[:5]:
            lines.append(
                f"- {review.get('symbol')} | {review.get('exit_reason')} | "
                f"hold {review.get('hold_days')}d | runup {review.get('max_runup_pct')}% | "
                f"drawdown {review.get('max_drawdown_pct')}%"
            )
    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Render trade lifecycle report")
    parser.add_argument("--root", default=None)
    parser.add_argument("--json", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    report = build_report(root=Path(args.root).expanduser() if args.root else None)
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(render_report(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
