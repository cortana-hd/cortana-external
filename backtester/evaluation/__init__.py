"""Evaluation helpers for comparing practical scoring models."""

from evaluation.comparison import (
    ModelFamily,
    attach_model_family_scores,
    build_default_model_families,
    compare_model_families,
    render_model_comparison_report,
    score_enhanced_rank,
)

__all__ = [
    "ModelFamily",
    "attach_model_family_scores",
    "build_default_model_families",
    "compare_model_families",
    "render_model_comparison_report",
    "score_enhanced_rank",
]
