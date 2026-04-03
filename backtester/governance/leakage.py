"""Point-in-time and leakage audits for governance promotion blockers."""

from __future__ import annotations

from collections import Counter
from datetime import UTC, datetime
from typing import Any, Iterable, Mapping


def build_point_in_time_audit_artifact(
    *,
    experiment_key: str,
    records: Iterable[Mapping[str, Any]],
    generated_at: str | None = None,
) -> dict[str, Any]:
    normalized = [dict(record) for record in records]
    known_at_order_audit = _build_known_at_order_audit(normalized)
    provenance_audit = _build_provenance_audit(normalized)
    source_mix_audit = _build_source_mix_audit(normalized)
    survivorship_audit = _build_survivorship_audit(normalized)
    corporate_actions_audit = _build_corporate_actions_audit(normalized)
    pass_fail_summary = {
        "passed": all(
            bool(section.get("passed", False))
            for section in (
                known_at_order_audit,
                provenance_audit,
                source_mix_audit,
            )
        ),
        "blocking_findings": [
            section["name"]
            for section in (known_at_order_audit, provenance_audit, source_mix_audit)
            if not bool(section.get("passed", False))
        ],
    }
    return {
        "artifact_family": "point_in_time_audit_summary",
        "schema_version": 1,
        "experiment_key": str(experiment_key or "").strip().lower(),
        "generated_at": _normalize_timestamp(generated_at or datetime.now(UTC).isoformat()),
        "known_at_order_audit": known_at_order_audit,
        "provenance_integrity_audit": provenance_audit,
        "live_vs_cache_mixing_audit": source_mix_audit,
        "universe_membership_audit": survivorship_audit,
        "corporate_actions_audit": corporate_actions_audit,
        "leakage_findings": pass_fail_summary["blocking_findings"],
        "pass_fail_summary": pass_fail_summary,
    }


def _build_known_at_order_audit(records: list[dict[str, Any]]) -> dict[str, Any]:
    violations = 0
    missing = 0
    for record in records:
        generated_at = _parse_timestamp(record.get("generated_at"))
        known_at = _parse_timestamp(record.get("known_at"))
        if generated_at is None or known_at is None:
            missing += 1
            continue
        if known_at > generated_at:
            violations += 1
    return {
        "name": "known_at_order",
        "passed": violations == 0 and missing == 0,
        "violations": violations,
        "missing_timestamps": missing,
    }


def _build_provenance_audit(records: list[dict[str, Any]]) -> dict[str, Any]:
    missing_producer = 0
    missing_source = 0
    for record in records:
        if not str(record.get("producer") or "").strip():
            missing_producer += 1
        source = record.get("input_provenance") or record.get("source_provenance") or {}
        if not isinstance(source, Mapping) or not source:
            missing_source += 1
    return {
        "name": "provenance_integrity",
        "passed": missing_producer == 0 and missing_source == 0,
        "missing_producer": missing_producer,
        "missing_source_provenance": missing_source,
    }


def _build_source_mix_audit(records: list[dict[str, Any]]) -> dict[str, Any]:
    sources = Counter()
    for record in records:
        status = str(record.get("data_status") or "").strip().lower()
        source = str(record.get("data_source") or "").strip().lower()
        if source:
            sources[source] += 1
        if status:
            sources[f"status:{status}"] += 1
    has_live = any(key.startswith("status:ok") or key in {"schwab", "service"} for key in sources)
    has_cache = any("cache" in key or key.startswith("status:degraded") for key in sources)
    passed = not (has_live and has_cache)
    return {
        "name": "live_vs_cache_mixing",
        "passed": passed,
        "source_counts": dict(sources),
        "mixed_live_and_cache": has_live and has_cache,
    }


def _build_survivorship_audit(records: list[dict[str, Any]]) -> dict[str, Any]:
    missing = sum(1 for record in records if not record.get("universe_membership"))
    return {
        "name": "universe_membership",
        "passed": missing == 0 if records else True,
        "status": "pass" if missing == 0 else "limited",
        "missing_membership_records": missing,
    }


def _build_corporate_actions_audit(records: list[dict[str, Any]]) -> dict[str, Any]:
    missing = sum(1 for record in records if record.get("asset_class") == "stock" and record.get("corporate_actions_applied") is None)
    return {
        "name": "corporate_actions",
        "passed": missing == 0 if records else True,
        "status": "pass" if missing == 0 else "not_available",
        "missing_corporate_action_flags": missing,
    }


def _parse_timestamp(value: object) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _normalize_timestamp(value: object) -> str:
    parsed = _parse_timestamp(value)
    if parsed is None:
        parsed = datetime.now(UTC)
    return parsed.isoformat()
