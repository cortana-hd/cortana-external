"""Shared operator decision contract and renderers."""

from operator_surfaces.decision_contract import (
    OPERATOR_PAYLOAD_SCHEMA_VERSION,
    build_lifecycle_operator_payload,
    build_market_brief_operator_payload,
    build_operator_payload,
    validate_operator_payload,
)
from operator_surfaces.renderers import (
    describe_operator_outcome,
    render_operator_payload,
)

__all__ = [
    "OPERATOR_PAYLOAD_SCHEMA_VERSION",
    "build_lifecycle_operator_payload",
    "build_market_brief_operator_payload",
    "build_operator_payload",
    "describe_operator_outcome",
    "render_operator_payload",
    "validate_operator_payload",
]
