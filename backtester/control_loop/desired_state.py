"""Canonical desired-state artifact synthesis for the V4 trading control loop."""

from __future__ import annotations

import json
import hashlib
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Mapping

from evaluation.artifact_contracts import (
    ARTIFACT_FAMILY_TRADING_DESIRED_STATE,
    annotate_artifact,
)

DEFAULT_DESIRED_STATE_PATH = Path(__file__).resolve().parents[1] / ".cache" / "trade_lifecycle" / "desired_state.json"


def build_desired_state_artifact(
    *,
    snapshot_at: str,
    posture_artifact: Mapping[str, Any] | None = None,
    authority_artifact: Mapping[str, Any] | None = None,
    release_target: Mapping[str, Any] | None = None,
    policy_constraints: Mapping[str, Any] | None = None,
    operator_intent: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    posture = dict(posture_artifact or {})
    authority = dict(authority_artifact or {})
    release = dict(release_target or {})
    constraints = dict(policy_constraints or {})
    intent = dict(operator_intent or {})
    generated_at = _normalize_timestamp(snapshot_at)

    posture_target = {
        "posture_state": str(posture.get("posture_state") or "risk_on"),
        "gross_exposure_cap_pct": _optional_percent(
            ((posture.get("drawdown_state") or {}).get("allowed_gross_exposure_fraction"))
        ),
        "strategy_allocations": [
            dict(item)
            for item in posture.get("strategy_allocations") or []
            if isinstance(item, Mapping)
        ],
        "warnings": [str(item).strip() for item in posture.get("warnings") or [] if str(item).strip()],
    }
    authority_target = {
        "highest_autonomy_mode": str((authority.get("summary") or {}).get("highest_autonomy_mode") or "advisory"),
        "authority_counts": dict(authority.get("authority_counts") or {}),
        "families": [
            dict(item)
            for item in authority.get("families") or []
            if isinstance(item, Mapping)
        ],
    }
    release_target_payload = {
        "release_key": str(release.get("release_key") or "steady-state"),
        "mode": str(release.get("mode") or release.get("rollout_mode") or "steady"),
        "status": str(release.get("status") or "active"),
        "canary_status": str((release.get("canary_state") or {}).get("status") or "ok"),
    }
    if "drawdown_state" not in constraints and posture.get("drawdown_state"):
        constraints["drawdown_state"] = dict(posture.get("drawdown_state") or {})
    if "kill_switches" not in constraints:
        constraints["kill_switches"] = {
            "portfolio_pause": posture_target["posture_state"] == "paused",
            "trusted_family_count": int((authority_target["authority_counts"] or {}).get("trusted", 0) or 0),
        }

    warnings = []
    if not posture_target["strategy_allocations"]:
        warnings.append("desired_posture_missing_allocations")
    if not authority_target["families"]:
        warnings.append("desired_authority_missing_families")

    desired_state_id = _deterministic_key(
        "trading_desired_state",
        generated_at,
        posture_target["posture_state"],
        authority_target["highest_autonomy_mode"],
        release_target_payload["release_key"],
    )

    return annotate_artifact(
        {
            "desired_state_id": desired_state_id,
            "posture_target": posture_target,
            "authority_target": authority_target,
            "release_target": release_target_payload,
            "policy_constraints": constraints,
            "operator_intent": intent,
            "summary": {
                "desired_posture_state": posture_target["posture_state"],
                "desired_autonomy_mode": authority_target["highest_autonomy_mode"],
                "top_strategy_family": str((posture.get("summary") or {}).get("top_strategy_family") or "") or None,
                "release_mode": release_target_payload["mode"],
            },
            "warnings": warnings,
        },
        artifact_family=ARTIFACT_FAMILY_TRADING_DESIRED_STATE,
        producer="backtester.control_loop.desired_state",
        generated_at=generated_at,
        known_at=generated_at,
        status="ok" if not warnings else "degraded",
        degraded_status="healthy" if not warnings else "degraded_safe",
        outcome_class="run_completed",
    )


def save_desired_state_artifact(
    artifact: Mapping[str, Any],
    *,
    path: Path | None = None,
) -> Path:
    target = (path or DEFAULT_DESIRED_STATE_PATH).expanduser()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(dict(artifact), indent=2) + "\n", encoding="utf-8")
    return target


def load_desired_state_artifact(path: Path | None = None) -> dict[str, Any]:
    target = (path or DEFAULT_DESIRED_STATE_PATH).expanduser()
    if not target.exists():
        return {}
    payload = json.loads(target.read_text(encoding="utf-8"))
    return dict(payload) if isinstance(payload, dict) else {}


def _optional_percent(value: object) -> float | None:
    try:
        if value is None or value == "":
            return None
        return round(float(value) * 100.0, 2)
    except (TypeError, ValueError):
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
