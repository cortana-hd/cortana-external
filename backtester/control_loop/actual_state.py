"""Actual-state artifact synthesis for the V4 trading control loop."""

from __future__ import annotations

import json
import hashlib
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Mapping

from evaluation.artifact_contracts import (
    ARTIFACT_FAMILY_TRADING_ACTUAL_STATE,
    annotate_artifact,
)

DEFAULT_ACTUAL_STATE_PATH = Path(__file__).resolve().parents[1] / ".cache" / "trade_lifecycle" / "actual_state.json"


def build_actual_state_artifact(
    *,
    snapshot_at: str,
    posture_artifact: Mapping[str, Any] | None = None,
    portfolio_snapshot: Mapping[str, Any] | None = None,
    authority_artifact: Mapping[str, Any] | None = None,
    runtime_health_artifact: Mapping[str, Any] | None = None,
    runtime_inventory_artifact: Mapping[str, Any] | None = None,
    drift_artifact: Mapping[str, Any] | None = None,
    release_unit_artifact: Mapping[str, Any] | None = None,
    known_at: str | None = None,
) -> dict[str, Any]:
    posture = dict(posture_artifact or {})
    portfolio = dict(portfolio_snapshot or {})
    authority = dict(authority_artifact or {})
    runtime_health = dict(runtime_health_artifact or {})
    runtime_inventory = dict(runtime_inventory_artifact or {})
    drift = dict(drift_artifact or {})
    release = dict(release_unit_artifact or {})
    generated_at = _normalize_timestamp(snapshot_at)
    effective_known_at = _normalize_timestamp(known_at or generated_at)

    posture_actual = {
        "posture_state": str(posture.get("posture_state") or "unknown"),
        "gross_exposure_pct": _exposure_pct(portfolio, posture),
        "open_count": int((portfolio.get("summary") or {}).get("open_count") or portfolio.get("open_count") or 0),
        "closed_count": int((portfolio.get("summary") or {}).get("closed_total_count") or portfolio.get("closed_count") or 0),
        "warnings": [str(item).strip() for item in posture.get("warnings") or [] if str(item).strip()],
    }
    authority_actual = {
        "highest_autonomy_mode": str(
            (posture.get("summary") or {}).get("highest_autonomy_mode")
            or (authority.get("summary") or {}).get("highest_autonomy_mode")
            or "advisory"
        ),
        "authority_counts": dict(authority.get("authority_counts") or {}),
        "trusted_family_count": int((authority.get("authority_counts") or {}).get("trusted", 0) or 0),
    }
    runtime_actual = {
        "runtime_status": str(runtime_health.get("status") or "unknown"),
        "incident_count": len(runtime_health.get("incident_markers") or []),
        "pre_open_gate_status": str(runtime_health.get("pre_open_gate_status") or "unknown"),
        "inventory_component_count": len(runtime_inventory.get("components") or []),
        "warnings": [str(item).strip() for item in runtime_health.get("warnings") or [] if str(item).strip()],
    }
    drift_actual = {
        "drift_status": str((drift.get("summary") or {}).get("drift_status") or drift.get("status") or "unknown"),
        "policy_action": str((drift.get("policy_outcome") or {}).get("action") or "monitor"),
        "headline": str((drift.get("summary") or {}).get("headline") or "") or None,
        "warnings": [str(item).strip() for item in drift.get("warnings") or [] if str(item).strip()],
    }
    release_actual = {
        "release_key": str(release.get("release_key") or "steady-state"),
        "validation_ok": bool((release.get("validation") or {}).get("is_valid", False)),
        "canary_status": str((release.get("canary_state") or {}).get("status") or "unknown"),
        "rollback_ready": bool((release.get("rollback_state") or {}).get("rollback_ready", False)),
    }

    warnings = [
        *posture_actual["warnings"],
        *runtime_actual["warnings"],
        *drift_actual["warnings"],
    ]
    state = "ok"
    degraded_status = "healthy"
    if posture_actual["posture_state"] == "paused" or drift_actual["policy_action"] in {"reduce_authority", "hold_rollout"}:
        state = "degraded"
        degraded_status = "degraded_risky"
    elif runtime_actual["runtime_status"] != "ok" or not release_actual["validation_ok"]:
        state = "degraded"
        degraded_status = "degraded_safe"

    actual_state_id = _deterministic_key(
        "trading_actual_state",
        generated_at,
        posture_actual["posture_state"],
        authority_actual["highest_autonomy_mode"],
        release_actual["release_key"],
    )

    return annotate_artifact(
        {
            "actual_state_id": actual_state_id,
            "posture_actual": posture_actual,
            "authority_actual": authority_actual,
            "runtime_actual": runtime_actual,
            "drift_actual": drift_actual,
            "release_actual": release_actual,
            "summary": {
                "actual_posture_state": posture_actual["posture_state"],
                "actual_autonomy_mode": authority_actual["highest_autonomy_mode"],
                "runtime_status": runtime_actual["runtime_status"],
                "drift_status": drift_actual["drift_status"],
                "release_status": release_actual["canary_status"],
            },
            "warnings": list(dict.fromkeys(warnings)),
        },
        artifact_family=ARTIFACT_FAMILY_TRADING_ACTUAL_STATE,
        producer="backtester.control_loop.actual_state",
        generated_at=generated_at,
        known_at=effective_known_at,
        status=state,
        degraded_status=degraded_status,
        outcome_class="run_completed",
    )


def save_actual_state_artifact(
    artifact: Mapping[str, Any],
    *,
    path: Path | None = None,
) -> Path:
    target = (path or DEFAULT_ACTUAL_STATE_PATH).expanduser()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(dict(artifact), indent=2) + "\n", encoding="utf-8")
    return target


def load_actual_state_artifact(path: Path | None = None) -> dict[str, Any]:
    target = (path or DEFAULT_ACTUAL_STATE_PATH).expanduser()
    if not target.exists():
        return {}
    payload = json.loads(target.read_text(encoding="utf-8"))
    return dict(payload) if isinstance(payload, dict) else {}


def _exposure_pct(portfolio_snapshot: Mapping[str, Any], posture_artifact: Mapping[str, Any]) -> float | None:
    for value in (
        (portfolio_snapshot.get("portfolio_snapshot") or {}).get("gross_exposure_pct"),
        portfolio_snapshot.get("gross_exposure_pct"),
        posture_artifact.get("gross_exposure"),
    ):
        try:
            if value is not None and value != "":
                numeric = float(value)
                return round(numeric * 100.0 if numeric <= 1.0 else numeric, 2)
        except (TypeError, ValueError):
            continue
    return None


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
