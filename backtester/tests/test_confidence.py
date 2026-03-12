from types import SimpleNamespace

from data.confidence import build_confidence_assessment, build_dip_confidence_assessment
from data.market_regime import MarketRegime


def _market(
    regime: MarketRegime = MarketRegime.CONFIRMED_UPTREND,
    *,
    status: str = "ok",
    snapshot_age_seconds: float = 0.0,
):
    return SimpleNamespace(
        regime=regime,
        position_sizing=1.0,
        status=status,
        snapshot_age_seconds=snapshot_age_seconds,
    )


def test_build_confidence_assessment_returns_shared_contract_for_clean_setup():
    assessment = build_confidence_assessment(
        market=_market(),
        total_score=8,
        breakout={"score": 4},
        sentiment_overlay={"score": 1, "confidence_delta": 6, "source": "news+x", "reason": "confirmed sentiment"},
        exit_risk={"score": 1},
        sector_context={"score": 1, "confidence_delta": 5, "status": "supportive"},
        catalyst_weighting={"score": 1, "confidence_delta": 5, "label": "SUPPORTIVE"},
        data_status="ok",
        data_staleness_seconds=0.0,
        history_bars=252,
        symbol="NVDA",
    )

    assert assessment["symbol"] == "NVDA"
    assert assessment["effective_confidence_pct"] >= 75
    assert assessment["uncertainty_pct"] == 0
    assert assessment["abstain"] is False
    assert assessment["confidence_bucket"] == "high"


def test_build_confidence_assessment_abstains_when_inputs_are_degraded_and_conflicted():
    assessment = build_confidence_assessment(
        market=_market(status="degraded", snapshot_age_seconds=4000.0),
        total_score=8,
        breakout={"score": 1},
        sentiment_overlay={"score": 1, "confidence_delta": 0, "source": "news+x", "reason": "News and X sentiment disagree; overlay neutralized."},
        exit_risk={"score": 4},
        sector_context={"score": -1, "confidence_delta": -5, "status": "unavailable"},
        catalyst_weighting={"score": -2, "confidence_delta": -10, "label": "RISK"},
        data_status="degraded",
        data_staleness_seconds=7200.0,
        history_bars=40,
        symbol="TSLA",
    )

    assert assessment["abstain"] is True
    assert assessment["uncertainty_pct"] >= 35
    assert "market_regime_degraded" in assessment["abstain_reason_codes"]
    assert "symbol_data_stale" in assessment["abstain_reason_codes"]
    assert "insufficient_history" in assessment["abstain_reason_codes"]


def test_build_dip_confidence_assessment_marks_credit_veto_and_falling_knife():
    assessment = build_dip_confidence_assessment(
        symbol="META",
        market=_market(MarketRegime.CORRECTION),
        total_score=7,
        q_score=3,
        v_score=2,
        c_score=2,
        market_active=True,
        credit_veto=True,
        recovery_ready=False,
        falling_knife=True,
        risk_inputs={"vix": 25.0, "put_call": 1.0, "hy_spread": 700.0, "fear_greed": 30.0},
        history_bars=30,
    )

    assert assessment["abstain"] is True
    assert "credit_veto" in assessment["abstain_reason_codes"]
    assert "falling_knife" in assessment["abstain_reason_codes"]
