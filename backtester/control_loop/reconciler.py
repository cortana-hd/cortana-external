"""Desired-vs-actual reconciliation for the V4 trading control loop."""

from __future__ import annotations

import json
import hashlib
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Mapping

from evaluation.artifact_contracts import (
    ARTIFACT_FAMILY_TRADING_RECONCILIATION_ACTIONS,
    annotate_artifact,
)

DEFAULT_RECONCILIATION_ACTIONS_PATH = Path(__file__).resolve().parents[1] / ".cache" / "trade_lifecycle" / "reconciliation_actions.json"


def build_reconciliation_actions_artifact(
    *,
    generated_at: str,
    desired_state_artifact: Mapping[str, Any],
    actual_state_artifact: Mapping[str, Any],
    interventions_artifact: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    normalized_generated_at = _normalize_timestamp(generated_at)
    desired = dict(desired_state_artifact)
    actual = dict(actual_state_artifact)
    interventions = dict(interventions_artifact or {})
    actions: list[dict[str, Any]] = []

    desired_posture = str(((desired.get("summary") or {}).get("desired_posture_state") or "unknown")).strip().lower()
    actual_posture = str(((actual.get("summary") or {}).get("actual_posture_state") or "unknown")).strip().lower()
    if desired_posture != actual_posture:
        actions.append(
            _action(
                generated_at=normalized_generated_at,
                desired_state_ref=str(desired.get("desired_state_id") or ""),
                actual_state_ref=str(actual.get("actual_state_id") or ""),
                source_loop="portfolio",
                action_type="rebalance_posture",
                action_status="proposed",
                rationale={
                    "headline": f"Desired posture {desired_posture} differs from actual posture {actual_posture}.",
                },
            )
        )

    desired_autonomy = str(((desired.get("summary") or {}).get("desired_autonomy_mode") or "advisory")).strip().lower()
    actual_autonomy = str(((actual.get("summary") or {}).get("actual_autonomy_mode") or "advisory")).strip().lower()
    if desired_autonomy != actual_autonomy:
        actions.append(
            _action(
                generated_at=normalized_generated_at,
                desired_state_ref=str(desired.get("desired_state_id") or ""),
                actual_state_ref=str(actual.get("actual_state_id") or ""),
                source_loop="governance",
                action_type="align_authority",
                action_status="proposed",
                rationale={
                    "headline": f"Desired autonomy {desired_autonomy} differs from actual autonomy {actual_autonomy}.",
                },
            )
        )

    desired_cap = _optional_float(((desired.get("posture_target") or {}).get("gross_exposure_cap_pct")))
    actual_exposure = _optional_float(((actual.get("posture_actual") or {}).get("gross_exposure_pct")))
    if desired_cap is not None and actual_exposure is not None and actual_exposure > desired_cap:
        actions.append(
            _action(
                generated_at=normalized_generated_at,
                desired_state_ref=str(desired.get("desired_state_id") or ""),
                actual_state_ref=str(actual.get("actual_state_id") or ""),
                source_loop="portfolio",
                action_type="reduce_exposure",
                action_status="proposed",
                rationale={
                    "headline": f"Gross exposure {actual_exposure:.2f}% exceeds the desired cap of {desired_cap:.2f}%.",
                },
            )
        )

    drift_action = str(((actual.get("drift_actual") or {}).get("policy_action") or "monitor")).strip().lower()
    if drift_action == "hold_rollout":
        actions.append(
            _action(
                generated_at=normalized_generated_at,
                desired_state_ref=str(desired.get("desired_state_id") or ""),
                actual_state_ref=str(actual.get("actual_state_id") or ""),
                source_loop="release",
                action_type="hold_rollout",
                action_status="proposed",
                rationale={
                    "headline": str(((actual.get("drift_actual") or {}).get("headline") or "Rollout should be held.")),
                },
            )
        )
    elif drift_action == "reduce_authority":
        actions.append(
            _action(
                generated_at=normalized_generated_at,
                desired_state_ref=str(desired.get("desired_state_id") or ""),
                actual_state_ref=str(actual.get("actual_state_id") or ""),
                source_loop="governance",
                action_type="reduce_authority",
                action_status="proposed",
                rationale={
                    "headline": str(((actual.get("drift_actual") or {}).get("headline") or "Authority should be reduced.")),
                },
            )
        )

    for event in interventions.get("events") or []:
        if not isinstance(event, Mapping):
            continue
        event_type = str(event.get("event_type") or "").strip()
        if not event_type:
            continue
        actions.append(
            _action(
                generated_at=normalized_generated_at,
                desired_state_ref=str(desired.get("desired_state_id") or ""),
                actual_state_ref=str(actual.get("actual_state_id") or ""),
                source_loop=str(((event.get("scope") or {}).get("loop") or "operations")).strip(),
                action_type=f"respect_{event_type}",
                action_status="applied" if not event.get("cleared_at") else "rolled_back",
                rationale={"headline": str(((event.get("reason") or {}).get("headline") or event_type))},
            )
        )

    deduped: dict[str, dict[str, Any]] = {}
    for action in actions:
        deduped[str(action.get("action_id") or "")] = action
    action_rows = list(deduped.values())
    warnings = [str(action.get("action_type") or "").strip() for action in action_rows if str(action.get("action_type") or "").strip()]
    proposed_count = sum(1 for action in action_rows if action.get("action_status") == "proposed")
    applied_count = sum(1 for action in action_rows if action.get("action_status") == "applied")

    return annotate_artifact(
        {
            "reconciliation_id": _deterministic_key(
                "trading_reconciliation",
                str(desired.get("desired_state_id") or ""),
                str(actual.get("actual_state_id") or ""),
                normalized_generated_at,
            ),
            "desired_state_ref": str(desired.get("desired_state_id") or ""),
            "actual_state_ref": str(actual.get("actual_state_id") or ""),
            "actions": action_rows,
            "summary": {
                "action_count": len(action_rows),
                "proposed_count": proposed_count,
                "applied_count": applied_count,
                "top_action": str(action_rows[0].get("action_type") or "") if action_rows else None,
            },
            "warnings": warnings,
        },
        artifact_family=ARTIFACT_FAMILY_TRADING_RECONCILIATION_ACTIONS,
        producer="backtester.control_loop.reconciler",
        generated_at=normalized_generated_at,
        known_at=normalized_generated_at,
        status="ok" if not action_rows else "degraded",
        degraded_status="healthy" if not action_rows else "degraded_safe",
        outcome_class="run_completed",
    )


def save_reconciliation_actions_artifact(
    artifact: Mapping[str, Any],
    *,
    path: Path | None = None,
) -> Path:
    target = (path or DEFAULT_RECONCILIATION_ACTIONS_PATH).expanduser()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(dict(artifact), indent=2) + "\n", encoding="utf-8")
    return target


def load_reconciliation_actions_artifact(path: Path | None = None) -> dict[str, Any]:
    target = (path or DEFAULT_RECONCILIATION_ACTIONS_PATH).expanduser()
    if not target.exists():
        return {}
    payload = json.loads(target.read_text(encoding="utf-8"))
    return dict(payload) if isinstance(payload, dict) else {}


def _action(
    *,
    generated_at: str,
    desired_state_ref: str,
    actual_state_ref: str,
    source_loop: str,
    action_type: str,
    action_status: str,
    rationale: Mapping[str, Any],
) -> dict[str, Any]:
    return {
        "action_id": _deterministic_key(
            "trading_reconciliation_action",
            desired_state_ref,
            actual_state_ref,
            source_loop,
            action_type,
            action_status,
        ),
        "generated_at": generated_at,
        "source_loop": source_loop,
        "action_type": action_type,
        "action_status": action_status,
        "rationale": dict(rationale),
    }


def _deterministic_key(*parts: object) -> str:
    raw = "|".join(str(part or "").strip() for part in parts)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:20]


def _optional_float(value: object) -> float | None:
    try:
        if value is None or value == "":
            return None
        return round(float(value), 4)
    except (TypeError, ValueError):
        return None


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
