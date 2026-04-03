from __future__ import annotations

from evaluation.failure_taxonomy import (
    OUTCOME_ANALYSIS_FAILED,
    OUTCOME_DEGRADED_RISKY,
    OUTCOME_DEGRADED_SAFE,
    OUTCOME_HEALTHY_CANDIDATES_FOUND,
    OUTCOME_HEALTHY_NO_CANDIDATES,
    OUTCOME_MARKET_GATE_BLOCKED,
    classify_market_brief_outcome,
    classify_strategy_outcome,
)


def test_classify_strategy_outcome_marks_market_gate_blocked_when_healthy():
    outcome = classify_strategy_outcome(
        market_status="ok",
        gate_active=True,
        evaluated=0,
        threshold_passed=0,
        analysis_error_count=0,
    )

    assert outcome.outcome_class == OUTCOME_MARKET_GATE_BLOCKED
    assert outcome.status == "ok"
    assert outcome.degraded_status == "healthy"


def test_classify_strategy_outcome_marks_healthy_no_candidates():
    outcome = classify_strategy_outcome(
        market_status="ok",
        gate_active=False,
        evaluated=3,
        threshold_passed=0,
        analysis_error_count=0,
    )

    assert outcome.outcome_class == OUTCOME_HEALTHY_NO_CANDIDATES
    assert outcome.status == "ok"


def test_classify_strategy_outcome_marks_analysis_failed():
    outcome = classify_strategy_outcome(
        market_status="ok",
        gate_active=False,
        evaluated=0,
        threshold_passed=0,
        analysis_error_count=4,
    )

    assert outcome.outcome_class == OUTCOME_ANALYSIS_FAILED
    assert outcome.status == "error"
    assert outcome.degraded_status == "degraded_risky"


def test_classify_market_brief_outcome_distinguishes_safe_and_risky_degradation():
    safe = classify_market_brief_outcome(
        posture_action="NO_BUY",
        regime_status="degraded",
        regime_data_source="cache",
        tape_status="degraded",
        tape_primary_source="cache",
    )
    risky = classify_market_brief_outcome(
        posture_action="NO_BUY",
        regime_status="degraded",
        regime_data_source="unknown",
        tape_status="error",
        tape_primary_source="unavailable",
    )
    healthy = classify_market_brief_outcome(
        posture_action="WATCH",
        regime_status="ok",
        regime_data_source="schwab",
        tape_status="ok",
        tape_primary_source="schwab",
    )

    assert safe.outcome_class == OUTCOME_DEGRADED_SAFE
    assert safe.degraded_status == "degraded_safe"
    assert risky.outcome_class == OUTCOME_DEGRADED_RISKY
    assert risky.degraded_status == "degraded_risky"
    assert healthy.outcome_class == OUTCOME_HEALTHY_CANDIDATES_FOUND
