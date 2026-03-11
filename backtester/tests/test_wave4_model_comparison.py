from unittest.mock import MagicMock

import pandas as pd

from advisor import TradingAdvisor
from evaluation.comparison import (
    attach_model_family_scores,
    build_default_model_families,
    compare_model_families,
    render_model_comparison_report,
    score_enhanced_rank,
)


def test_attach_model_family_scores_builds_wave4_comparison_columns():
    frame = pd.DataFrame(
        [
            {
                "symbol": "NVDA",
                "total_score": 8,
                "breakout_score": 4,
                "sentiment_score": 1,
                "exit_risk_score": 1,
                "sector_score": 1,
                "catalyst_score": 0,
            }
        ]
    )

    scored = attach_model_family_scores(frame)

    assert scored.loc[0, "baseline_score"] == 8.0
    assert scored.loc[0, "tactical_score"] == 10.25
    assert scored.loc[0, "enhanced_score"] == score_enhanced_rank(8, 4, 1, 1, sector_score=1, catalyst_score=0)


def test_compare_model_families_reports_selection_overlap_and_outcomes():
    candidates = pd.DataFrame(
        [
            {
                "symbol": "AAA",
                "total_score": 9,
                "breakout_score": 4,
                "sentiment_score": 0,
                "exit_risk_score": 0,
                "sector_score": 1,
                "catalyst_score": 0,
                "confidence": 72,
                "action": "BUY",
                "future_return_pct": 5.0,
                "outcome_bucket": "win",
            },
            {
                "symbol": "BBB",
                "total_score": 8,
                "breakout_score": 5,
                "sentiment_score": 0,
                "exit_risk_score": 2,
                "sector_score": 0,
                "catalyst_score": 0,
                "confidence": 65,
                "action": "BUY",
                "future_return_pct": 1.0,
                "outcome_bucket": "win",
            },
            {
                "symbol": "CCC",
                "total_score": 7,
                "breakout_score": 4,
                "sentiment_score": 2,
                "exit_risk_score": 0,
                "sector_score": 1,
                "catalyst_score": 1,
                "confidence": 80,
                "action": "WATCH",
                "future_return_pct": 8.0,
                "outcome_bucket": "win",
            },
            {
                "symbol": "DDD",
                "total_score": 7,
                "breakout_score": 1,
                "sentiment_score": -2,
                "exit_risk_score": 3,
                "sector_score": 0,
                "catalyst_score": 0,
                "confidence": 55,
                "action": "WATCH",
                "future_return_pct": -4.0,
                "outcome_bucket": "loss",
            },
            {
                "symbol": "EEE",
                "total_score": 6,
                "breakout_score": 5,
                "sentiment_score": 2,
                "exit_risk_score": 0,
                "sector_score": 1,
                "catalyst_score": 1,
                "confidence": 84,
                "action": "BUY",
                "future_return_pct": 12.0,
                "outcome_bucket": "win",
            },
        ]
    )

    families = build_default_model_families(top_n=2, baseline_min_score=7)
    summary, selections = compare_model_families(candidates, families, baseline_name="baseline_total")

    assert list(summary["model"]) == ["baseline_total", "tactical_overlay", "enhanced_rank"]
    baseline = summary[summary["model"] == "baseline_total"].iloc[0]
    enhanced = summary[summary["model"] == "enhanced_rank"].iloc[0]

    assert list(selections["baseline_total"]["symbol"]) == ["AAA", "BBB"]
    assert list(selections["enhanced_rank"]["symbol"]) == ["AAA", "CCC"]
    assert baseline["selected_count"] == 2
    assert enhanced["overlap_with_baseline"] == 1
    assert enhanced["model_only_count"] == 1
    assert enhanced["baseline_only_count"] == 1
    assert enhanced["avg_future_return_pct"] > baseline["avg_future_return_pct"]
    assert enhanced["hit_rate_pct"] == 100.0
    assert enhanced["win_rate_pct"] == 100.0


def test_render_model_comparison_report_lists_unique_picks():
    candidates = pd.DataFrame(
        [
            {
                "symbol": "AAA",
                "total_score": 9,
                "breakout_score": 4,
                "sentiment_score": 0,
                "exit_risk_score": 0,
                "sector_score": 1,
                "catalyst_score": 0,
                "confidence": 72,
                "action": "BUY",
                "future_return_pct": 5.0,
                "outcome_bucket": "win",
            },
            {
                "symbol": "BBB",
                "total_score": 8,
                "breakout_score": 5,
                "sentiment_score": 0,
                "exit_risk_score": 2,
                "sector_score": 0,
                "catalyst_score": 0,
                "confidence": 65,
                "action": "BUY",
                "future_return_pct": 1.0,
                "outcome_bucket": "win",
            },
            {
                "symbol": "CCC",
                "total_score": 7,
                "breakout_score": 4,
                "sentiment_score": 2,
                "exit_risk_score": 0,
                "sector_score": 1,
                "catalyst_score": 1,
                "confidence": 80,
                "action": "WATCH",
                "future_return_pct": 8.0,
                "outcome_bucket": "win",
            },
        ]
    )
    families = build_default_model_families(top_n=2, baseline_min_score=7)
    summary, selections = compare_model_families(candidates, families, baseline_name="baseline_total")

    report = render_model_comparison_report(summary, selections, baseline_name="baseline_total")

    assert "Wave 4 Model Comparison" in report
    assert "baseline_total: picked 2" in report
    assert "enhanced_rank: picked 2" in report
    assert "overlap vs baseline_total" in report
    assert "picks: AAA, CCC" in report


def test_advisor_compare_model_families_reuses_scan_output():
    advisor = TradingAdvisor()
    advisor.scan_for_opportunities = MagicMock(
        return_value=pd.DataFrame(
            [
                {
                    "symbol": "AAA",
                    "total_score": 8,
                    "breakout_score": 3,
                    "sentiment_score": 1,
                    "exit_risk_score": 1,
                    "sector_score": 1,
                    "catalyst_score": 0,
                    "rank_score": 10.0,
                    "confidence": 78,
                    "action": "BUY",
                },
                {
                    "symbol": "BBB",
                    "total_score": 7,
                    "breakout_score": 5,
                    "sentiment_score": 2,
                    "exit_risk_score": 0,
                    "sector_score": 1,
                    "catalyst_score": 1,
                    "rank_score": 12.0,
                    "confidence": 83,
                    "action": "WATCH",
                },
            ]
        )
    )

    result = advisor.compare_model_families(quick=True, min_score=6, top_n=2)

    assert list(result["summary"]["model"]) == ["baseline_total", "tactical_overlay", "enhanced_rank"]
    assert "enhanced_rank" in result["report"]
    assert "BBB" in result["report"]
