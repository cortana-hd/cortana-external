"""Canonical operator-surface payload contract."""

from __future__ import annotations

from typing import Any, Mapping

from evaluation.artifact_contracts import (
    ARTIFACT_FAMILY_OPERATOR_PAYLOAD,
    annotate_artifact,
    validate_artifact_payload,
)

OPERATOR_PAYLOAD_SCHEMA_VERSION = 1
VALID_SURFACE_TYPES = {
    "brief",
    "daytime",
    "nighttime",
    "trading_cron",
    "lifecycle_review",
    "runtime_health",
}


def build_operator_payload(
    *,
    payload_key: str,
    producer: str,
    surface_type: str,
    generated_at: str,
    status: str,
    degraded_status: str,
    outcome_class: str,
    summary: Mapping[str, Any],
    decision_contract_ref: Mapping[str, Any],
    source_refs: Mapping[str, Mapping[str, Any] | None],
    health: Mapping[str, Any],
    known_at: str | None = None,
    warnings: list[str] | None = None,
    posture_action: str | None = None,
    focus_symbols: list[str] | None = None,
    lifecycle_state: Mapping[str, Any] | None = None,
    governance_state: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    payload = annotate_artifact(
        {
            "payload_key": str(payload_key or "").strip(),
            "surface_type": str(surface_type or "").strip(),
            "summary": dict(summary or {}),
            "decision_contract_ref": dict(decision_contract_ref or {}),
            "source_refs": {
                str(key): (dict(value) if isinstance(value, Mapping) else None)
                for key, value in dict(source_refs or {}).items()
            },
            "health": dict(health or {}),
            "posture_action": str(posture_action or "").strip().upper() or None,
            "focus_symbols": [str(symbol).strip().upper() for symbol in (focus_symbols or []) if str(symbol).strip()],
            "lifecycle_state": dict(lifecycle_state or {}),
            "governance_state": dict(governance_state or {}),
            "warnings": [str(item) for item in (warnings or []) if str(item)],
        },
        artifact_family=ARTIFACT_FAMILY_OPERATOR_PAYLOAD,
        producer=producer,
        generated_at=generated_at,
        known_at=known_at,
        status=status,
        degraded_status=degraded_status,
        outcome_class=outcome_class,
    )
    payload["schema_version"] = OPERATOR_PAYLOAD_SCHEMA_VERSION
    return validate_operator_payload(payload)


def validate_operator_payload(payload: Mapping[str, Any]) -> dict[str, Any]:
    validated = validate_artifact_payload(dict(payload), expected_family=ARTIFACT_FAMILY_OPERATOR_PAYLOAD)
    surface_type = str(validated.get("surface_type") or "").strip()
    if surface_type not in VALID_SURFACE_TYPES:
        raise ValueError(f"unsupported operator surface_type: {surface_type or 'missing'}")

    payload_key = str(validated.get("payload_key") or "").strip()
    if not payload_key:
        raise ValueError("operator payload requires payload_key")

    summary = validated.get("summary")
    if not isinstance(summary, Mapping):
        raise ValueError("operator payload summary must be an object")
    for required in ("headline", "what_this_means"):
        if not str(summary.get(required) or "").strip():
            raise ValueError(f"operator payload summary requires {required}")

    decision_ref = validated.get("decision_contract_ref")
    _validate_source_ref(decision_ref, label="decision_contract_ref")

    source_refs = validated.get("source_refs")
    if not isinstance(source_refs, Mapping) or not source_refs:
        raise ValueError("operator payload source_refs must be a non-empty object")
    for label, ref in source_refs.items():
        if ref is None:
            continue
        _validate_source_ref(ref, label=f"source_refs.{label}")

    health = validated.get("health")
    if not isinstance(health, Mapping):
        raise ValueError("operator payload health must be an object")
    if not str(health.get("status") or "").strip():
        raise ValueError("operator payload health requires status")
    if "warnings" in health and not isinstance(health.get("warnings"), list):
        raise ValueError("operator payload health warnings must be a list")

    return dict(validated)


def build_market_brief_operator_payload(snapshot: Mapping[str, Any]) -> dict[str, Any]:
    generated_at = str(snapshot.get("generated_at") or "").strip()
    producer = str(snapshot.get("producer") or "backtester.market_brief_snapshot")
    summary = dict(snapshot.get("operator_summary") or {})
    decision_state = dict(snapshot.get("decision_state") or {})
    adaptive_weights = dict(snapshot.get("adaptive_weights") or {})
    narrative_overlay = dict(snapshot.get("narrative_overlay") or {})
    research_runtime = dict(snapshot.get("research_runtime") or {})
    shadow_review = dict(snapshot.get("shadow_review") or {})
    focus = dict(snapshot.get("focus") or {})
    freshness = dict(snapshot.get("freshness") or {})
    source_refs = {
        "market_brief": {
            "artifact_family": str(snapshot.get("artifact_family") or "market_brief"),
            "producer": producer,
            "generated_at": generated_at,
            "known_at": str(snapshot.get("known_at") or generated_at),
        },
        "adaptive_weights": _artifact_ref(adaptive_weights),
        "narrative_overlay": _artifact_ref(narrative_overlay),
        "research_runtime": _artifact_ref(research_runtime),
        "shadow_review": _artifact_ref(shadow_review),
    }
    return build_operator_payload(
        payload_key=f"market_brief:{generated_at}",
        producer=producer,
        surface_type="brief",
        generated_at=generated_at,
        known_at=str(snapshot.get("known_at") or generated_at),
        status=str(snapshot.get("status") or "ok"),
        degraded_status=str(snapshot.get("degraded_status") or "healthy"),
        outcome_class=str(snapshot.get("outcome_class") or ""),
        summary={
            "headline": str(summary.get("headline") or "Market snapshot unavailable"),
            "what_this_means": str(summary.get("what_this_means") or ""),
            "read_this_as": dict(summary.get("read_this_as") or {}),
        },
        decision_contract_ref=_artifact_ref(decision_state),
        source_refs=source_refs,
        health={
            "status": str(snapshot.get("status") or "ok"),
            "degraded_status": str(snapshot.get("degraded_status") or "healthy"),
            "outcome_class": str(snapshot.get("outcome_class") or ""),
            "freshness": freshness,
            "warnings": list(snapshot.get("warnings") or []),
        },
        posture_action=str((snapshot.get("posture") or {}).get("action") or ""),
        focus_symbols=list(focus.get("symbols") or []),
        governance_state={},
        warnings=list(snapshot.get("warnings") or []),
    )


def build_lifecycle_operator_payload(report: Mapping[str, Any], *, generated_at: str) -> dict[str, Any]:
    summary = dict(report.get("summary") or {})
    open_count = int(summary.get("open_count", 0) or 0)
    closed_count = int(summary.get("closed_count", 0) or 0)
    blocked_count = int(summary.get("portfolio_blocked_count", 0) or 0)
    portfolio_snapshot = dict(report.get("portfolio_snapshot") or {})
    recent_open = list(report.get("open_positions") or [])
    recent_exits = list(report.get("closed_positions") or [])
    posture_action = "WATCH" if open_count or blocked_count else "NO_BUY"
    what_this_means = (
        f"Open positions {open_count}, closed this run {closed_count}, blocked this run {blocked_count}."
    )
    focus_symbols = [str(item.get("symbol") or "").strip().upper() for item in recent_open[:3] if str(item.get("symbol") or "").strip()]
    return build_operator_payload(
        payload_key=f"trade_lifecycle:{generated_at}",
        producer="backtester.trade_lifecycle_report",
        surface_type="lifecycle_review",
        generated_at=generated_at,
        known_at=generated_at,
        status="ok",
        degraded_status="healthy",
        outcome_class="run_completed",
        summary={
            "headline": f"LIFECYCLE_REVIEW: {posture_action} | open {open_count} | closed {closed_count}",
            "what_this_means": what_this_means,
            "read_this_as": {
                "session": "This is a lifecycle review snapshot.",
                "regime": "Lifecycle review does not rescore market regime; it reports realized position state.",
                "tape": "Lifecycle review is based on paper-position ledgers, not live tape.",
                "focus": (
                    f"{', '.join(focus_symbols)}. Recent open positions."
                    if focus_symbols
                    else "None yet. No open positions are active."
                ),
            },
        },
        decision_contract_ref={
            "artifact_family": "trade_lifecycle_report",
            "producer": "backtester.trade_lifecycle_report",
            "generated_at": generated_at,
        },
        source_refs={
            "portfolio_snapshot": {
                "artifact_family": "portfolio_state_snapshot",
                "producer": "backtester.trade_lifecycle_cycle",
                "generated_at": generated_at,
            },
            "trade_lifecycle_report": {
                "artifact_family": "trade_lifecycle_report",
                "producer": "backtester.trade_lifecycle_report",
                "generated_at": generated_at,
            },
        },
        health={
            "status": "ok",
            "degraded_status": "healthy",
            "outcome_class": "run_completed",
            "freshness": {"portfolio_pending_entry_count": int(portfolio_snapshot.get("pending_entry_count", 0) or 0)},
            "warnings": [],
        },
        posture_action=posture_action,
        focus_symbols=focus_symbols,
        lifecycle_state={
            "open_count": open_count,
            "closed_count": closed_count,
            "blocked_count": blocked_count,
            "recent_exit_count": len(recent_exits),
        },
        governance_state={},
        warnings=[],
    )


def _artifact_ref(payload: Mapping[str, Any] | None) -> dict[str, Any]:
    if not isinstance(payload, Mapping) or not payload:
        return {}
    return {
        "artifact_family": str(payload.get("artifact_family") or "unknown"),
        "producer": str(payload.get("producer") or "unknown"),
        "generated_at": str(payload.get("generated_at") or "unknown"),
        "known_at": str(payload.get("known_at") or payload.get("generated_at") or "unknown"),
    }


def _validate_source_ref(value: object, *, label: str) -> None:
    if not isinstance(value, Mapping):
        raise ValueError(f"{label} must be an object")
    missing = [
        field
        for field in ("artifact_family", "producer", "generated_at")
        if not str(value.get(field) or "").strip()
    ]
    if missing:
        raise ValueError(f"{label} missing required fields: {', '.join(missing)}")
