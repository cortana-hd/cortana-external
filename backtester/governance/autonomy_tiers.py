"""Autonomy-tier policies and supervised-live gate artifacts."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Mapping, Sequence

from lifecycle.ledgers import default_lifecycle_root

AUTONOMY_SCHEMA_VERSION = 1
DEFAULT_REVIEW_WINDOW_PATH = default_lifecycle_root() / "supervised_live_review_window.json"
DEFAULT_AUTONOMY_GATE_PATH = default_lifecycle_root() / "autonomy_gate.json"
VALID_AUTONOMY_MODES = ("advisory", "paper", "supervised_live", "guarded_live")


def build_supervised_live_review_window(
    *,
    strategy_family: str,
    started_at: str,
    observed_mode: str = "supervised_live",
    policy_breaches: Sequence[Mapping[str, Any]] | None = None,
    unresolved_incidents: Sequence[Mapping[str, Any]] | None = None,
    operator_signoff: Mapping[str, Any] | None = None,
    outcome_summary: Mapping[str, Any] | None = None,
    ended_at: str | None = None,
    generated_at: str | None = None,
) -> dict[str, Any]:
    return {
        "artifact_family": "supervised_live_review_windows_v1",
        "schema_version": AUTONOMY_SCHEMA_VERSION,
        "generated_at": _normalize_timestamp(generated_at or ended_at or started_at),
        "review_windows": [
            {
                "strategy_family": str(strategy_family or "").strip().lower(),
                "started_at": _normalize_timestamp(started_at),
                "ended_at": _normalize_optional_timestamp(ended_at),
                "observed_mode": str(observed_mode or "supervised_live").strip().lower(),
                "policy_breaches": [dict(item) for item in policy_breaches or [] if isinstance(item, Mapping)],
                "unresolved_incidents": [dict(item) for item in unresolved_incidents or [] if isinstance(item, Mapping)],
                "operator_signoff": dict(operator_signoff or {}),
                "outcome_summary": dict(outcome_summary or {}),
            }
        ],
    }


def evaluate_autonomy_transition(
    *,
    authority_artifact: Mapping[str, Any],
    review_window_artifact: Mapping[str, Any] | None = None,
    requested_mode: str = "guarded_live",
    generated_at: str | None = None,
) -> dict[str, Any]:
    normalized_mode = str(requested_mode or "guarded_live").strip().lower()
    if normalized_mode not in VALID_AUTONOMY_MODES:
        normalized_mode = "guarded_live"

    authority_rows = [
        dict(item)
        for item in authority_artifact.get("families") or []
        if isinstance(item, Mapping)
    ]
    windows_by_family = {
        str(item.get("strategy_family") or "").strip().lower(): dict(item)
        for item in (review_window_artifact or {}).get("review_windows") or []
        if isinstance(item, Mapping)
    }

    blockers: list[str] = []
    rows: list[dict[str, Any]] = []
    eligible_families: list[str] = []
    for row in authority_rows:
        family = str(row.get("strategy_family") or "").strip().lower()
        family_blockers: list[str] = []
        authority_tier = str(row.get("authority_tier") or "exploratory").strip().lower()
        autonomy_mode = str(row.get("autonomy_mode") or "advisory").strip().lower()
        sample_depth = int(row.get("sample_depth", 0) or 0)
        regime_count = int(((row.get("regime_coverage") or {}).get("regime_count") or 0))
        benchmark_summary = dict(row.get("benchmark_summary") or {})
        avg_return_pct = _optional_float(benchmark_summary.get("avg_return_pct"))
        window = windows_by_family.get(family, {})
        unresolved_incidents = [dict(item) for item in window.get("unresolved_incidents") or [] if isinstance(item, Mapping)]
        policy_breaches = [dict(item) for item in window.get("policy_breaches") or [] if isinstance(item, Mapping)]
        signoff = dict(window.get("operator_signoff") or {})

        if authority_tier != "trusted":
            family_blockers.append("authority_not_trusted")
        if autonomy_mode != "supervised_live":
            family_blockers.append("not_currently_supervised_live")
        if sample_depth < 250:
            family_blockers.append("insufficient_sample_depth")
        if regime_count < 2:
            family_blockers.append("insufficient_regime_coverage")
        if avg_return_pct is not None and avg_return_pct < 0:
            family_blockers.append("benchmark_underperformance")
        if unresolved_incidents:
            family_blockers.append("unresolved_incidents")
        if policy_breaches:
            family_blockers.append("policy_breaches")
        if str(signoff.get("status") or "").strip().lower() not in {"approved", "approved_edited"}:
            family_blockers.append("missing_operator_signoff")

        rows.append(
            {
                "strategy_family": family,
                "requested_mode": normalized_mode,
                "eligible": not family_blockers,
                "blocking_factors": family_blockers,
                "sample_depth": sample_depth,
                "authority_tier": authority_tier,
                "autonomy_mode": autonomy_mode,
                "review_window": window,
            }
        )
        if family_blockers:
            blockers.extend(f"{family}:{reason}" for reason in family_blockers)
        else:
            eligible_families.append(family)

    return {
        "artifact_family": "autonomy_transition_gate_v1",
        "schema_version": AUTONOMY_SCHEMA_VERSION,
        "generated_at": _normalize_timestamp(generated_at),
        "requested_mode": normalized_mode,
        "state": "eligible" if eligible_families else "blocked",
        "eligible_families": eligible_families,
        "blocking_factors": blockers,
        "families": rows,
        "summary": {
            "reviewed_family_count": len(rows),
            "eligible_family_count": len(eligible_families),
        },
    }


def save_review_window_artifact(
    artifact: Mapping[str, Any],
    *,
    path: Path | None = None,
) -> Path:
    target = (path or DEFAULT_REVIEW_WINDOW_PATH).expanduser()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(dict(artifact), indent=2) + "\n", encoding="utf-8")
    return target


def save_autonomy_gate_artifact(
    artifact: Mapping[str, Any],
    *,
    path: Path | None = None,
) -> Path:
    target = (path or DEFAULT_AUTONOMY_GATE_PATH).expanduser()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(dict(artifact), indent=2) + "\n", encoding="utf-8")
    return target


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


def _normalize_optional_timestamp(value: object) -> str | None:
    if value is None or value == "":
        return None
    return _normalize_timestamp(value)


def _optional_float(value: object) -> float | None:
    try:
        if value is None or value == "":
            return None
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if numeric != numeric:
        return None
    return round(numeric, 4)
