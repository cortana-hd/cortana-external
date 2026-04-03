from __future__ import annotations

import pytest

from governance.benchmarks import (
    GovernanceBenchmarkError,
    build_benchmark_ladder_artifact,
    build_comparable_window_key,
    validate_comparable_inputs,
)


def test_comparable_window_key_is_stable_for_identical_inputs():
    key_a = build_comparable_window_key(
        dataset="prediction_accuracy",
        start_at="2026-03-01T00:00:00+00:00",
        end_at="2026-03-31T23:59:59+00:00",
        horizon_key="5d",
        assumptions={"fill_bps": 5, "fees_bps": 1},
        point_in_time_label="strict",
    )
    key_b = build_comparable_window_key(
        dataset="prediction_accuracy",
        start_at="2026-03-01T00:00:00+00:00",
        end_at="2026-03-31T23:59:59+00:00",
        horizon_key="5d",
        assumptions={"fees_bps": 1, "fill_bps": 5},
        point_in_time_label="strict",
    )

    assert key_a == key_b


def test_validate_comparable_inputs_rejects_assumption_mismatch():
    with pytest.raises(GovernanceBenchmarkError, match="not comparable"):
        validate_comparable_inputs(
            candidate_window={
                "dataset": "prediction_accuracy",
                "start_at": "2026-03-01T00:00:00+00:00",
                "end_at": "2026-03-31T23:59:59+00:00",
                "horizon_key": "5d",
                "assumptions": {"fill_bps": 5},
                "point_in_time_label": "strict",
            },
            benchmark_window={
                "dataset": "prediction_accuracy",
                "start_at": "2026-03-01T00:00:00+00:00",
                "end_at": "2026-03-31T23:59:59+00:00",
                "horizon_key": "5d",
                "assumptions": {"fill_bps": 10},
                "point_in_time_label": "strict",
            },
        )


def test_benchmark_ladder_artifact_preserves_comparable_window_and_rows():
    artifact = build_benchmark_ladder_artifact(
        experiment_key="dip_buyer_v2",
        candidate_window={
            "dataset": "prediction_accuracy",
            "start_at": "2026-03-01T00:00:00+00:00",
            "end_at": "2026-03-31T23:59:59+00:00",
            "horizon_key": "5d",
            "assumptions": {"fill_bps": 5, "fees_bps": 1},
            "point_in_time_label": "strict",
        },
        source_artifact={
            "artifact_family": "benchmark_comparison_summary",
            "generated_at": "2026-04-03T16:00:00+00:00",
            "comparisons": {
                "by_strategy_action": [{"strategy": "dip_buyer", "action": "BUY"}],
                "by_regime": [{"strategy": "dip_buyer", "market_regime": "correction"}],
                "by_confidence_bucket": [{"strategy": "dip_buyer", "confidence_bucket": "high"}],
            },
        },
    )

    assert artifact["artifact_family"] == "benchmark_ladder_summary"
    assert artifact["experiment_key"] == "dip_buyer_v2"
    assert len(artifact["benchmark_ladder"]) == 4
    assert artifact["benchmark_ladder"][0]["comparable_window_key"] == artifact["comparable_window_key"]
