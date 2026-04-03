"""Shared machine-readable artifact contracts for backtester producers."""

from __future__ import annotations

from typing import Any

ARTIFACT_SCHEMA_VERSION = 1

ARTIFACT_FAMILY_MARKET_BRIEF = "market_brief"
ARTIFACT_FAMILY_STRATEGY_ALERT = "strategy_alert"
ARTIFACT_FAMILY_RUN_MANIFEST = "run_manifest"

ARTIFACT_STATUS_OK = "ok"
ARTIFACT_STATUS_DEGRADED = "degraded"
ARTIFACT_STATUS_ERROR = "error"

DEGRADED_STATUS_HEALTHY = "healthy"
DEGRADED_STATUS_DEGRADED = "degraded"

REQUIRED_ARTIFACT_METADATA_FIELDS = (
    "artifact_family",
    "schema_version",
    "producer",
    "status",
    "generated_at",
)

OPTIONAL_ARTIFACT_METADATA_FIELDS = (
    "outcome_class",
    "degraded_status",
    "known_at",
    "freshness",
)

ARTIFACT_FAMILY_MINIMUM_FIELDS: dict[str, tuple[str, ...]] = {
    ARTIFACT_FAMILY_MARKET_BRIEF: REQUIRED_ARTIFACT_METADATA_FIELDS
    + (
        "session",
        "regime",
        "posture",
        "tape",
        "macro",
        "intraday_breadth",
        "focus",
        "warnings",
    ),
    ARTIFACT_FAMILY_STRATEGY_ALERT: REQUIRED_ARTIFACT_METADATA_FIELDS
    + (
        "strategy",
        "signals",
        "summary",
    ),
    ARTIFACT_FAMILY_RUN_MANIFEST: REQUIRED_ARTIFACT_METADATA_FIELDS
    + (
        "run_id",
        "stages",
        "artifacts",
    ),
}

VALID_ARTIFACT_STATUSES = {
    ARTIFACT_STATUS_OK,
    ARTIFACT_STATUS_DEGRADED,
    ARTIFACT_STATUS_ERROR,
}

VALID_DEGRADED_STATUSES = {
    DEGRADED_STATUS_HEALTHY,
    DEGRADED_STATUS_DEGRADED,
}


def build_artifact_metadata(
    *,
    artifact_family: str,
    producer: str,
    generated_at: str,
    status: str,
    outcome_class: str | None = None,
    freshness: dict[str, Any] | None = None,
    known_at: str | None = None,
    degraded_status: str | None = None,
) -> dict[str, Any]:
    """Build baseline machine-readable artifact metadata."""

    normalized_status = str(status).strip().lower()
    if normalized_status not in VALID_ARTIFACT_STATUSES:
        raise ValueError(f"unsupported artifact status: {status}")

    normalized_family = str(artifact_family).strip()
    if normalized_family not in ARTIFACT_FAMILY_MINIMUM_FIELDS:
        raise ValueError(f"unsupported artifact family: {artifact_family}")

    metadata = {
        "artifact_family": normalized_family,
        "schema_version": ARTIFACT_SCHEMA_VERSION,
        "producer": str(producer).strip(),
        "status": normalized_status,
        "generated_at": str(generated_at).strip(),
        "known_at": str(known_at or generated_at).strip(),
        "degraded_status": (
            str(degraded_status).strip().lower()
            if degraded_status is not None
            else (DEGRADED_STATUS_HEALTHY if normalized_status == ARTIFACT_STATUS_OK else DEGRADED_STATUS_DEGRADED)
        ),
    }
    if metadata["degraded_status"] not in VALID_DEGRADED_STATUSES:
        raise ValueError(f"unsupported degraded status: {metadata['degraded_status']}")
    if outcome_class:
        metadata["outcome_class"] = str(outcome_class).strip()
    if freshness is not None:
        metadata["freshness"] = dict(freshness)
    return metadata


def annotate_artifact(
    payload: dict[str, Any],
    *,
    artifact_family: str,
    producer: str,
    generated_at: str,
    status: str,
    outcome_class: str | None = None,
    freshness: dict[str, Any] | None = None,
    known_at: str | None = None,
    degraded_status: str | None = None,
) -> dict[str, Any]:
    """Attach baseline artifact metadata and validate required fields."""

    annotated = dict(payload)
    annotated.update(
        build_artifact_metadata(
            artifact_family=artifact_family,
            producer=producer,
            generated_at=generated_at,
            status=status,
            outcome_class=outcome_class,
            freshness=freshness,
            known_at=known_at,
            degraded_status=degraded_status,
        )
    )
    validate_artifact_payload(annotated, expected_family=artifact_family)
    return annotated


def validate_artifact_payload(payload: dict[str, Any], *, expected_family: str | None = None) -> dict[str, Any]:
    """Validate baseline required fields for a machine-readable artifact."""

    family = str(expected_family or payload.get("artifact_family") or "").strip()
    if family not in ARTIFACT_FAMILY_MINIMUM_FIELDS:
        raise ValueError(f"unsupported artifact family: {family or 'missing'}")

    missing = [field for field in ARTIFACT_FAMILY_MINIMUM_FIELDS[family] if field not in payload]
    if missing:
        raise ValueError(f"artifact {family} missing required fields: {', '.join(missing)}")

    status = str(payload.get("status") or "").strip().lower()
    if status not in VALID_ARTIFACT_STATUSES:
        raise ValueError(f"unsupported artifact status: {status or 'missing'}")

    degraded_status = str(payload.get("degraded_status") or "").strip().lower()
    if degraded_status not in VALID_DEGRADED_STATUSES:
        raise ValueError(f"unsupported degraded status: {degraded_status or 'missing'}")

    freshness = payload.get("freshness")
    if freshness is not None and not isinstance(freshness, dict):
        raise ValueError("artifact freshness must be a dict when present")

    return payload
