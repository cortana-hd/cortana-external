"""Evaluation helpers for comparing practical scoring models."""

from evaluation.artifact_contracts import (
    ARTIFACT_FAMILY_MARKET_BRIEF,
    ARTIFACT_FAMILY_RUN_MANIFEST,
    ARTIFACT_FAMILY_STRATEGY_ALERT,
    ARTIFACT_SCHEMA_VERSION,
    annotate_artifact,
    build_artifact_metadata,
    validate_artifact_payload,
)
from evaluation.comparison import (
    ModelFamily,
    attach_model_family_scores,
    build_default_model_families,
    compare_model_families,
    render_model_comparison_report,
    score_enhanced_rank,
)

__all__ = [
    "ARTIFACT_FAMILY_MARKET_BRIEF",
    "ARTIFACT_FAMILY_RUN_MANIFEST",
    "ARTIFACT_FAMILY_STRATEGY_ALERT",
    "ARTIFACT_SCHEMA_VERSION",
    "ModelFamily",
    "annotate_artifact",
    "attach_model_family_scores",
    "build_artifact_metadata",
    "build_default_model_families",
    "compare_model_families",
    "render_model_comparison_report",
    "score_enhanced_rank",
    "validate_artifact_payload",
]
