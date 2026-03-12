from types import SimpleNamespace

from data.confidence import (
    build_confidence_assessment,
    build_dip_confidence_assessment,
    build_trade_quality_score,
    churn_penalty_proxy,
    downside_risk_proxy,
    regime_quality_modifier,
    risk_adjusted_size_multiplier,
)
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

def test_trade_quality_score_penalizes_uncertainty_hostile_regime_and_churn_proxy():
    degraded = build_trade_quality_score(
        raw_setup_score=12,
        setup_scale=16,
        confidence_pct=86,
        uncertainty_pct=34,
        regime_modifier=regime_quality_modifier(
            regime=MarketRegime.UPTREND_UNDER_PRESSURE,
            position_sizing=0.5,
        ),
        cost_penalty=18,
        cost_penalty_reason='exit_risk_score proxy',
    )
    clean = build_trade_quality_score(
        raw_setup_score=10,
        setup_scale=16,
        confidence_pct=82,
        uncertainty_pct=8,
        regime_modifier=regime_quality_modifier(
            regime=MarketRegime.CONFIRMED_UPTREND,
            position_sizing=1.0,
        ),
        cost_penalty=6,
        cost_penalty_reason='exit_risk_score proxy',
    )

    assert degraded['score'] < clean['score']
    assert degraded['regime_modifier'] < clean['regime_modifier']
    assert degraded['cost_penalty_reason'] == 'exit_risk_score proxy'



def test_downside_risk_proxy_penalizes_uglier_left_tail():
    clean = downside_risk_proxy([100, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112])
    ugly = downside_risk_proxy([100, 98, 97, 96, 94, 93, 95, 92, 90, 91, 89, 88])

    assert ugly['penalty'] > clean['penalty']
    assert ugly['drawdown_pct'] > clean['drawdown_pct']


def test_churn_penalty_proxy_prefers_confirmed_recoveries():
    calm = churn_penalty_proxy(exit_risk_score=1)
    noisy = churn_penalty_proxy(exit_risk_score=4, recovery_ready=False, falling_knife=True)

    assert noisy['penalty'] > calm['penalty']
    assert 'falling_knife' in noisy['reason']


def test_risk_adjusted_size_multiplier_shrinks_for_downside_and_churn():
    clean = risk_adjusted_size_multiplier(downside_penalty=2, churn_penalty=1)
    risky = risk_adjusted_size_multiplier(downside_penalty=14, churn_penalty=10)

    assert risky < clean
    assert 0.45 <= risky <= 1.0


def test_trade_quality_score_penalizes_downside_and_churn_layers():
    stable = build_trade_quality_score(
        raw_setup_score=11,
        setup_scale=16,
        confidence_pct=84,
        uncertainty_pct=6,
        regime_modifier=1.0,
        cost_penalty=3,
        downside_penalty=2,
        downside_penalty_reason='63d_drawdown_tail_loss',
        churn_penalty=1,
        churn_penalty_reason='exit_risk_score',
    )
    fragile = build_trade_quality_score(
        raw_setup_score=12,
        setup_scale=16,
        confidence_pct=85,
        uncertainty_pct=6,
        regime_modifier=1.0,
        cost_penalty=3,
        downside_penalty=14,
        downside_penalty_reason='63d_drawdown_tail_loss',
        churn_penalty=8,
        churn_penalty_reason='falling_knife',
    )

    assert fragile['score'] < stable['score']
    assert fragile['downside_penalty_reason'] == '63d_drawdown_tail_loss'
    assert fragile['churn_penalty_reason'] == 'falling_knife'
