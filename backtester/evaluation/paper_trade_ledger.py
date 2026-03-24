"""Persistence helpers for the paper-trade lifecycle."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Optional


def default_paper_trade_root() -> Path:
    return Path(__file__).resolve().parents[1] / ".cache" / "paper_trades"


def open_positions_path(root: Optional[Path] = None) -> Path:
    return (root or default_paper_trade_root()) / "open_positions.json"


def closed_positions_path(root: Optional[Path] = None) -> Path:
    return (root or default_paper_trade_root()) / "closed_positions.json"


def latest_cycle_path(root: Optional[Path] = None) -> Path:
    return (root or default_paper_trade_root()) / "cycle-latest.json"


def performance_summary_path(root: Optional[Path] = None) -> Path:
    return (root or default_paper_trade_root()) / "performance-summary.json"


def load_open_positions(root: Optional[Path] = None) -> list[dict]:
    return _load_json_list(open_positions_path(root))


def load_closed_positions(root: Optional[Path] = None) -> list[dict]:
    return _load_json_list(closed_positions_path(root))


def save_open_positions(positions: Iterable[dict], root: Optional[Path] = None) -> Path:
    return _write_json(open_positions_path(root), list(positions))


def save_closed_positions(positions: Iterable[dict], root: Optional[Path] = None) -> Path:
    return _write_json(closed_positions_path(root), list(positions))


def save_latest_cycle(cycle: dict, root: Optional[Path] = None) -> Path:
    payload = dict(cycle)
    payload.setdefault("generated_at", datetime.now(timezone.utc).isoformat())
    return _write_json(latest_cycle_path(root), payload)


def load_latest_cycle(root: Optional[Path] = None) -> dict | None:
    path = latest_cycle_path(root)
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    return payload if isinstance(payload, dict) else None


def build_performance_summary(closed_positions: Iterable[dict]) -> dict:
    positions = [dict(item) for item in closed_positions]
    by_strategy: dict[str, list[dict]] = {}
    for item in positions:
        strategy = str(item.get("strategy") or "unknown")
        by_strategy.setdefault(strategy, []).append(item)
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "closed_trades": len(positions),
        "overall": _summarize_positions(positions),
        "by_strategy": {
            strategy: _summarize_positions(items)
            for strategy, items in sorted(by_strategy.items())
        },
    }


def save_performance_summary(summary: dict, root: Optional[Path] = None) -> Path:
    return _write_json(performance_summary_path(root), summary)


def load_performance_summary(root: Optional[Path] = None) -> dict | None:
    path = performance_summary_path(root)
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    return payload if isinstance(payload, dict) else None


def _summarize_positions(positions: list[dict]) -> dict:
    returns = [
        float(item.get("realized_return_pct"))
        for item in positions
        if isinstance(item.get("realized_return_pct"), (int, float))
    ]
    hold_days = [
        float(item.get("holding_days"))
        for item in positions
        if isinstance(item.get("holding_days"), (int, float))
    ]
    wins = [value for value in returns if value > 0]
    losses = [value for value in returns if value <= 0]
    profit_factor = None
    if losses:
        denominator = abs(sum(losses))
        if denominator > 0:
            profit_factor = round(sum(wins) / denominator, 3)
    elif wins:
        profit_factor = None
    return {
        "closed_trades": len(positions),
        "win_rate": round(len(wins) / len(returns), 3) if returns else 0.0,
        "avg_return_pct": round(sum(returns) / len(returns), 3) if returns else 0.0,
        "median_return_pct": round(_median(returns), 3) if returns else 0.0,
        "avg_holding_days": round(sum(hold_days) / len(hold_days), 2) if hold_days else 0.0,
        "profit_factor": profit_factor,
        "gross_wins_pct": round(sum(wins), 3) if wins else 0.0,
        "gross_losses_pct": round(sum(losses), 3) if losses else 0.0,
    }


def _median(values: list[float]) -> float:
    ordered = sorted(values)
    midpoint = len(ordered) // 2
    if len(ordered) % 2 == 0:
        return (ordered[midpoint - 1] + ordered[midpoint]) / 2
    return ordered[midpoint]


def _load_json_list(path: Path) -> list[dict]:
    if not path.exists():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    if not isinstance(payload, list):
        return []
    return [dict(item) for item in payload if isinstance(item, dict)]


def _write_json(path: Path, payload: object) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return path
