"""Drift and rollout-health synthesis for the V4 control loop."""

from __future__ import annotations

import json
import hashlib
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Mapping

from evaluation.artifact_contracts import (
    ARTIFACT_FAMILY_TRADING_DRIFT_SUMMARY,
    annotate_artifact,
)

DEFAULT_DRIFT_SUMMARY_PATH = Path(__file__).resolve().parents[1] / ".cache" / "trade_lifecycle" / "drift_monitor.json"


def build_drift_monitor_artifact(
    *,
    generated_at: str,
    runtime_health_artifact: Mapping[str, Any] | None = None,
    prediction_artifact: Mapping[str, Any] | None = None,
    strategy_scorecard_artifact: Mapping[str, Any] | None = None,
    release_unit_artifact: Mapping[str, Any] | None = None,
    posture_artifact: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    normalized_generated_at = _normalize_timestamp(generated_at)
    runtime = dict(runtime_health_artifact or {})
    prediction = dict(prediction_artifact or {})
    scorecard = dict(strategy_scorecard_artifact or {})
    release = dict(release_unit_artifact or {})
    posture = dict(posture_artifact or {})

    prediction_state = str(scorecard.get("overall_state") or prediction.get("trust_state") or "unknown").strip().lower()
    release_canary_status = str((release.get("canary_state") or {}).get("status") or "unknown").strip().lower()
    runtime_status = str(runtime.get("status") or "unknown").strip().lower()
    posture_state = str(posture.get("posture_state") or "unknown").strip().lower()
    release_valid = bool((release.get("validation") or {}).get("is_valid", False))

    warnings: list[str] = []
    policy_action = "monitor"
    drift_status = "ok"
    degraded_status = "healthy"

    if release_canary_status in {"warn", "degraded", "failed", "error"} or not release_valid:
        drift_status = "degraded"
        degraded_status = "degraded_risky"
        policy_action = "hold_rollout"
        warnings.append("release_rollout_degraded")
    elif runtime_status not in {"ok", "healthy"} or posture_state == "paused":
        drift_status = "degraded"
        degraded_status = "degraded_risky" if posture_state == "paused" else "degraded_safe"
        policy_action = "reduce_authority"
        warnings.append("runtime_or_posture_degraded")
    elif prediction_state in {"degraded", "stale", "warming"}:
        drift_status = "degraded"
        degraded_status = "degraded_safe"
        policy_action = "reduce_authority"
        warnings.append("prediction_quality_softened")

    headline = {
        "hold_rollout": "Release health drift requires a rollout hold before more authority is granted.",
        "reduce_authority": "Observed drift requires a temporary authority reduction.",
        "monitor": "Runtime, rollout, and trust signals are aligned enough to continue monitoring.",
    }[policy_action]

    return annotate_artifact(
        {
            "drift_id": _deterministic_key(
                "trading_drift_summary",
                normalized_generated_at,
                runtime_status,
                prediction_state,
                release_canary_status,
            ),
            "summary": {
                "drift_status": drift_status,
                "headline": headline,
            },
            "signals": {
                "runtime_status": runtime_status,
                "prediction_state": prediction_state,
                "release_canary_status": release_canary_status,
                "posture_state": posture_state,
            },
            "policy_outcome": {
                "action": policy_action,
                "reason": headline,
            },
            "warnings": warnings,
        },
        artifact_family=ARTIFACT_FAMILY_TRADING_DRIFT_SUMMARY,
        producer="backtester.release.drift_monitor",
        generated_at=normalized_generated_at,
        known_at=normalized_generated_at,
        status="ok" if drift_status == "ok" else "degraded",
        degraded_status=degraded_status,
        outcome_class="run_completed",
    )


def save_drift_monitor_artifact(
    artifact: Mapping[str, Any],
    *,
    path: Path | None = None,
) -> Path:
    target = (path or DEFAULT_DRIFT_SUMMARY_PATH).expanduser()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(dict(artifact), indent=2) + "\n", encoding="utf-8")
    return target


def load_drift_monitor_artifact(path: Path | None = None) -> dict[str, Any]:
    target = (path or DEFAULT_DRIFT_SUMMARY_PATH).expanduser()
    if not target.exists():
        return {}
    payload = json.loads(target.read_text(encoding="utf-8"))
    return dict(payload) if isinstance(payload, dict) else {}


def _deterministic_key(*parts: object) -> str:
    raw = "|".join(str(part or "").strip() for part in parts)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:20]


def _normalize_timestamp(value: object) -> str:
    if isinstance(value, str) and value.strip():
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            parsed = datetime.now(UTC)
    else:
        parsed = datetime.now(UTC)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC).isoformat()
