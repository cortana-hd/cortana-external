"""Compatibility guards for cross-repo consumers of operator artifacts."""

from __future__ import annotations

from typing import Mapping, Sequence

from evaluation.artifact_contracts import validate_artifact_payload


def assert_consumer_compatible(
    payload: Mapping[str, object],
    *,
    expected_family: str,
    supported_schema_versions: Sequence[int] = (1,),
) -> dict:
    normalized = validate_artifact_payload(dict(payload), expected_family=expected_family)
    schema_version = int(normalized.get("schema_version", 0) or 0)
    if schema_version not in {int(value) for value in supported_schema_versions}:
        raise ValueError(
            f"incompatible schema_version {schema_version} for {expected_family}; "
            f"supported: {', '.join(str(int(value)) for value in supported_schema_versions)}"
        )
    return normalized
