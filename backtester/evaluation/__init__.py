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
from evaluation.failure_taxonomy import (
    OUTCOME_ANALYSIS_FAILED,
    OUTCOME_DEGRADED_RISKY,
    OUTCOME_DEGRADED_SAFE,
    OUTCOME_HEALTHY_CANDIDATES_FOUND,
    OUTCOME_HEALTHY_NO_CANDIDATES,
    OUTCOME_MARKET_GATE_BLOCKED,
    TaxonomyResult,
    classify_market_brief_outcome,
    classify_strategy_outcome,
)

__all__ = [
    "ARTIFACT_FAMILY_MARKET_BRIEF",
    "ARTIFACT_FAMILY_RUN_MANIFEST",
    "ARTIFACT_FAMILY_STRATEGY_ALERT",
    "ARTIFACT_SCHEMA_VERSION",
    "ModelFamily",
    "OUTCOME_ANALYSIS_FAILED",
    "OUTCOME_DEGRADED_RISKY",
    "OUTCOME_DEGRADED_SAFE",
    "OUTCOME_HEALTHY_CANDIDATES_FOUND",
    "OUTCOME_HEALTHY_NO_CANDIDATES",
    "OUTCOME_MARKET_GATE_BLOCKED",
    "TaxonomyResult",
    "annotate_artifact",
    "attach_model_family_scores",
    "build_artifact_metadata",
    "build_default_model_families",
    "classify_market_brief_outcome",
    "classify_strategy_outcome",
    "compare_model_families",
    "render_model_comparison_report",
    "score_enhanced_rank",
    "validate_artifact_payload",
]
