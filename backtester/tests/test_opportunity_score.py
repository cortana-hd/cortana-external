from __future__ import annotations

from scoring.opportunity_score import build_opportunity_score_payload, map_score_to_action


def test_opportunity_score_maps_strong_signal_to_buy():
    payload = build_opportunity_score_payload(
        symbol="NVDA",
        strategy_family="canslim",
        feature_record={
            "prefilter_score": 88,
            "relative_strength_score": 0.92,
            "trend_quality_score": 0.84,
            "pullback_shape_score": 0.72,
            "liquidity_score": 0.91,
            "volatility_sanity_score": 0.66,
            "regime_alignment_score": 0.93,
            "adverse_regime_score": 8,
            "feature_summary": {"prefilter_score": 88},
        },
        market_regime="confirmed_uptrend",
        calibrated_confidence=0.71,
        downside_risk=0.22,
    )

    assert payload["action_label"] == "BUY"
    assert payload["opportunity_score"] >= 70


def test_opportunity_score_respects_correction_gate_for_non_dip_family():
    action = map_score_to_action(
        opportunity_score=81,
        calibrated_confidence=0.68,
        downside_risk=0.20,
        market_regime="correction",
        strategy_family="canslim",
    )
    assert action == "WATCH"

