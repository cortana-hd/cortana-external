"""Normalized outcome and degradation taxonomy for backtester artifacts."""

from __future__ import annotations

from dataclasses import dataclass

from evaluation.artifact_contracts import (
    ARTIFACT_STATUS_DEGRADED,
    ARTIFACT_STATUS_ERROR,
    ARTIFACT_STATUS_OK,
)

OUTCOME_HEALTHY_CANDIDATES_FOUND = "healthy_candidates_found"
OUTCOME_HEALTHY_NO_CANDIDATES = "healthy_no_candidates"
OUTCOME_MARKET_GATE_BLOCKED = "market_gate_blocked"
OUTCOME_DEGRADED_SAFE = "degraded_safe"
OUTCOME_DEGRADED_RISKY = "degraded_risky"
OUTCOME_ANALYSIS_FAILED = "analysis_failed"
OUTCOME_ARTIFACT_FAILED = "artifact_failed"
OUTCOME_NOTIFY_FAILED = "notify_failed"

DEGRADED_STATUS_HEALTHY = "healthy"
DEGRADED_STATUS_SAFE = "degraded_safe"
DEGRADED_STATUS_RISKY = "degraded_risky"


@dataclass(frozen=True)
class TaxonomyResult:
    status: str
    degraded_status: str
    outcome_class: str


def classify_strategy_outcome(
    *,
    market_status: str,
    gate_active: bool,
    evaluated: int,
    threshold_passed: int,
    analysis_error_count: int,
    risky_degraded: bool = False,
) -> TaxonomyResult:
    normalized_market_status = str(market_status or "ok").strip().lower()
    if analysis_error_count > 0 and evaluated == 0 and threshold_passed == 0:
        return TaxonomyResult(
            status=ARTIFACT_STATUS_ERROR,
            degraded_status=DEGRADED_STATUS_RISKY,
            outcome_class=OUTCOME_ANALYSIS_FAILED,
        )

    if normalized_market_status != ARTIFACT_STATUS_OK:
        return TaxonomyResult(
            status=ARTIFACT_STATUS_DEGRADED,
            degraded_status=DEGRADED_STATUS_RISKY if risky_degraded else DEGRADED_STATUS_SAFE,
            outcome_class=OUTCOME_DEGRADED_RISKY if risky_degraded else OUTCOME_DEGRADED_SAFE,
        )

    if gate_active:
        return TaxonomyResult(
            status=ARTIFACT_STATUS_OK,
            degraded_status=DEGRADED_STATUS_HEALTHY,
            outcome_class=OUTCOME_MARKET_GATE_BLOCKED,
        )

    if threshold_passed > 0:
        return TaxonomyResult(
            status=ARTIFACT_STATUS_OK,
            degraded_status=DEGRADED_STATUS_HEALTHY,
            outcome_class=OUTCOME_HEALTHY_CANDIDATES_FOUND,
        )

    return TaxonomyResult(
        status=ARTIFACT_STATUS_OK,
        degraded_status=DEGRADED_STATUS_HEALTHY,
        outcome_class=OUTCOME_HEALTHY_NO_CANDIDATES,
    )


def classify_market_brief_outcome(
    *,
    posture_action: str,
    regime_status: str,
    regime_data_source: str,
    tape_status: str,
    tape_primary_source: str,
) -> TaxonomyResult:
    normalized_regime_status = str(regime_status or "ok").strip().lower()
    normalized_regime_source = str(regime_data_source or "unknown").strip().lower()
    normalized_tape_status = str(tape_status or "ok").strip().lower()
    normalized_tape_source = str(tape_primary_source or "unknown").strip().lower()
    posture = str(posture_action or "").strip().upper()

    risky_degraded = (
        normalized_regime_status != ARTIFACT_STATUS_OK
        and normalized_regime_source in {"unknown", "unavailable"}
    ) or normalized_tape_source == "unavailable" or normalized_tape_status == ARTIFACT_STATUS_ERROR

    if normalized_regime_status != ARTIFACT_STATUS_OK or normalized_tape_status != ARTIFACT_STATUS_OK:
        return TaxonomyResult(
            status=ARTIFACT_STATUS_DEGRADED,
            degraded_status=DEGRADED_STATUS_RISKY if risky_degraded else DEGRADED_STATUS_SAFE,
            outcome_class=OUTCOME_DEGRADED_RISKY if risky_degraded else OUTCOME_DEGRADED_SAFE,
        )

    if posture == "NO_BUY":
        return TaxonomyResult(
            status=ARTIFACT_STATUS_OK,
            degraded_status=DEGRADED_STATUS_HEALTHY,
            outcome_class=OUTCOME_MARKET_GATE_BLOCKED,
        )

    return TaxonomyResult(
        status=ARTIFACT_STATUS_OK,
        degraded_status=DEGRADED_STATUS_HEALTHY,
        outcome_class=OUTCOME_HEALTHY_CANDIDATES_FOUND,
    )
