"""Intervention-event helpers for the V4 trading control loop."""

from __future__ import annotations

import json
import hashlib
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Mapping, Sequence

from evaluation.artifact_contracts import (
    ARTIFACT_FAMILY_TRADING_INTERVENTION_EVENTS,
    annotate_artifact,
)

DEFAULT_INTERVENTION_EVENTS_PATH = Path(__file__).resolve().parents[1] / ".cache" / "trade_lifecycle" / "intervention_events.json"


def build_intervention_event(
    *,
    generated_at: str,
    event_type: str,
    actor: str,
    scope: Mapping[str, Any] | None = None,
    reason: Mapping[str, Any] | None = None,
    cleared_at: str | None = None,
) -> dict[str, Any]:
    normalized_generated_at = _normalize_timestamp(generated_at)
    return {
        "event_id": _deterministic_key("trading_intervention_event", event_type, actor, normalized_generated_at),
        "created_at": normalized_generated_at,
        "event_type": str(event_type).strip(),
        "actor": str(actor).strip(),
        "scope": dict(scope or {}),
        "reason": dict(reason or {}),
        "cleared_at": _normalize_timestamp(cleared_at) if cleared_at else None,
    }


def derive_intervention_events(
    *,
    generated_at: str,
    actual_state_artifact: Mapping[str, Any] | None = None,
    drift_artifact: Mapping[str, Any] | None = None,
    release_unit_artifact: Mapping[str, Any] | None = None,
) -> list[dict[str, Any]]:
    actual = dict(actual_state_artifact or {})
    drift = dict(drift_artifact or {})
    release = dict(release_unit_artifact or {})
    events: list[dict[str, Any]] = []

    posture_state = str(((actual.get("posture_actual") or {}).get("posture_state") or "unknown")).strip().lower()
    if posture_state == "paused":
        events.append(
            build_intervention_event(
                generated_at=generated_at,
                event_type="manual_pause",
                actor="policy_engine",
                scope={"loop": "portfolio"},
                reason={"headline": "Portfolio posture is paused and must stay operator-visible."},
            )
        )

    drift_action = str(((drift.get("policy_outcome") or {}).get("action") or "monitor")).strip().lower()
    if drift_action == "hold_rollout":
        events.append(
            build_intervention_event(
                generated_at=generated_at,
                event_type="rollout_hold",
                actor="watchdog",
                scope={"loop": "release"},
                reason={"headline": str(((drift.get("summary") or {}).get("headline") or "Rollout is being held"))},
            )
        )
    elif drift_action == "reduce_authority":
        events.append(
            build_intervention_event(
                generated_at=generated_at,
                event_type="authority_reducer",
                actor="policy_engine",
                scope={"loop": "governance"},
                reason={"headline": str(((drift.get("summary") or {}).get("headline") or "Authority is being reduced"))},
            )
        )

    validation_ok = bool((release.get("validation") or {}).get("is_valid", False))
    if not validation_ok:
        events.append(
            build_intervention_event(
                generated_at=generated_at,
                event_type="rollout_hold",
                actor="policy_engine",
                scope={"loop": "release"},
                reason={"headline": "Release bundle is incomplete and cannot advance."},
            )
        )

    deduped: dict[str, dict[str, Any]] = {}
    for event in events:
        deduped[str(event.get("event_id") or "")] = event
    return list(deduped.values())


def build_intervention_events_artifact(
    *,
    generated_at: str,
    events: Sequence[Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    normalized_generated_at = _normalize_timestamp(generated_at)
    normalized_events = [dict(item) for item in events or [] if isinstance(item, Mapping)]
    active_event_count = sum(1 for event in normalized_events if not event.get("cleared_at"))
    warnings = [str(event.get("event_type") or "").strip() for event in normalized_events if str(event.get("event_type") or "").strip()]
    return annotate_artifact(
        {
            "intervention_set_id": _deterministic_key("trading_intervention_set", normalized_generated_at, active_event_count),
            "events": normalized_events,
            "active_event_count": active_event_count,
            "summary": {
                "active_event_count": active_event_count,
                "event_types": sorted(dict.fromkeys(warnings)),
            },
            "warnings": warnings,
        },
        artifact_family=ARTIFACT_FAMILY_TRADING_INTERVENTION_EVENTS,
        producer="backtester.control_loop.interventions",
        generated_at=normalized_generated_at,
        known_at=normalized_generated_at,
        status="ok" if active_event_count == 0 else "degraded",
        degraded_status="healthy" if active_event_count == 0 else "degraded_safe",
        outcome_class="run_completed",
    )


def save_intervention_events_artifact(
    artifact: Mapping[str, Any],
    *,
    path: Path | None = None,
) -> Path:
    target = (path or DEFAULT_INTERVENTION_EVENTS_PATH).expanduser()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(dict(artifact), indent=2) + "\n", encoding="utf-8")
    return target


def load_intervention_events_artifact(path: Path | None = None) -> dict[str, Any]:
    target = (path or DEFAULT_INTERVENTION_EVENTS_PATH).expanduser()
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
