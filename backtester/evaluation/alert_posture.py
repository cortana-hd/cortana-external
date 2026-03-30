"""Shared operator-facing alert posture and calibration helpers."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Mapping


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def calibration_artifact_path() -> Path:
    override = __import__("os").getenv("BUY_DECISION_CALIBRATION_PATH")
    if override:
        return Path(override).expanduser().resolve()
    return _repo_root() / ".cache" / "experimental_alpha" / "calibration" / "buy-decision-calibration-latest.json"


def load_buy_decision_calibration_summary() -> dict | None:
    path = calibration_artifact_path()
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    freshness = payload.get("freshness") if isinstance(payload.get("freshness"), dict) else {}
    summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
    return {
        "generated_at": payload.get("generated_at"),
        "is_stale": bool(freshness.get("is_stale")),
        "reason": str(freshness.get("reason") or "").strip().lower() or None,
        "settled_candidates": int(summary.get("settled_candidates", 0) or 0),
    }


def describe_calibration_note(summary: Mapping[str, object] | None) -> str:
    if not summary:
        return ""
    settled = int(summary.get("settled_candidates", 0) or 0)
    reason = str(summary.get("reason") or "").strip().lower()
    is_stale = bool(summary.get("is_stale"))
    if reason == "no_settled_records" or settled <= 0:
        return (
            "Calibration note: uncalibrated — no settled outcomes yet, "
            "so confidence is still model-estimated rather than proven."
        )
    if is_stale:
        return (
            f"Calibration note: stale — learning is based on {settled} settled outcomes, "
            "so treat confidence as provisional."
        )
    return f"Calibration note: learning on {settled} settled outcomes."


def describe_alert_posture(
    *,
    market_regime: str,
    buy_count: int,
    watch_count: int,
) -> str:
    regime = (market_regime or "").strip().lower()
    if regime == "correction":
        if watch_count > 0:
            return (
                "Alert posture: review only — correction regime. "
                "Treat surfaced names as a watchlist, not a buy-now alert."
            )
        return (
            "Alert posture: stand aside — correction regime. "
            "This is a status update, not a buy-now alert."
        )
    return ""
