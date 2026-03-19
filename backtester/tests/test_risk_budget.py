from __future__ import annotations

from types import SimpleNamespace

from data.market_regime import MarketRegime
from data.risk_budget import RiskBudgetOverlay, build_risk_budget_overlay


def _market(
    *,
    regime: MarketRegime,
    position_sizing: float,
    status: str = "ok",
) -> SimpleNamespace:
    return SimpleNamespace(
        regime=regime,
        position_sizing=position_sizing,
        status=status,
        distribution_days=0,
        drawdown_pct=0.0,
        trend_direction="up",
        price_vs_21d_pct=1.5,
        price_vs_50d_pct=3.0,
    )


def _adverse(
    *,
    label: str,
    size_multiplier: float,
    reason_components: list[str] | None = None,
    source: str = "test",
) -> dict[str, object]:
    return {
        "label": label,
        "score": 0.0,
        "reason": "; ".join(reason_components or []),
        "reason_components": reason_components or [],
        "size_multiplier": size_multiplier,
        "source": source,
    }


def test_confirmed_uptrend_stays_open_and_aggressive_when_stress_is_normal():
    overlay = build_risk_budget_overlay(
        market=_market(regime=MarketRegime.CONFIRMED_UPTREND, position_sizing=1.0),
        adverse_regime=_adverse(label="normal", size_multiplier=1.0),
    )

    assert isinstance(overlay, RiskBudgetOverlay)
    assert overlay.tier == "open"
    assert overlay.aggression_dial == "lean_more_aggressive"
    assert overlay.budget_fraction == 1.0
    assert overlay.budget_pct == 100
    assert overlay.state == "open"
    assert overlay.status == "open"
    assert overlay.label == "open"
    assert overlay.aggression_posture == "lean_more_aggressive"
    assert overlay.risk_budget_remaining == 1.0
    assert overlay.exposure_cap_hint == 1.0
    assert "confirmed uptrend" in overlay.explanation


def test_under_pressure_with_elevated_stress_tightens_budget():
    overlay = build_risk_budget_overlay(
        market=_market(regime=MarketRegime.UPTREND_UNDER_PRESSURE, position_sizing=0.6),
        adverse_regime=_adverse(
            label="elevated",
            size_multiplier=0.7,
            reason_components=["VIX percentile is elevated", "fear proxy is leaning risk-off"],
        ),
    )

    assert overlay.tier == "tight"
    assert overlay.aggression_dial == "lean_more_selective"
    assert overlay.budget_fraction == 0.42
    assert overlay.budget_pct == 42
    assert overlay.state == "tight"
    assert overlay.risk_budget_remaining == 0.42
    assert "VIX percentile is elevated" in overlay.reasons


def test_correction_always_closes_budget():
    overlay = build_risk_budget_overlay(
        market=_market(regime=MarketRegime.CORRECTION, position_sizing=0.0),
    )

    assert overlay.tier == "closed"
    assert overlay.aggression_dial == "lean_more_selective"
    assert overlay.budget_fraction == 0.0
    assert overlay.budget_pct == 0
    assert overlay.regime == "correction"


def test_degraded_inputs_downgrade_otherwise_open_context():
    overlay = build_risk_budget_overlay(
        market=_market(
            regime=MarketRegime.CONFIRMED_UPTREND,
            position_sizing=1.0,
            status="degraded",
        ),
        adverse_regime=_adverse(label="normal", size_multiplier=1.0),
    )

    assert overlay.tier == "open"
    assert overlay.budget_fraction == 0.85
    assert overlay.aggression_dial == "lean_more_selective"
    assert "market inputs degraded" in overlay.reasons


def test_missing_market_returns_unavailable_overlay():
    overlay = build_risk_budget_overlay(market=None)

    assert overlay.tier == "unavailable"
    assert overlay.aggression_dial == "no_change"
    assert overlay.budget_fraction == 0.0
    assert overlay.adverse_label == "unavailable"
    assert "unavailable" in overlay.explanation.lower()


def test_provided_adverse_regime_is_used_for_explanation_and_source():
    overlay = build_risk_budget_overlay(
        market=_market(regime=MarketRegime.RALLY_ATTEMPT, position_sizing=0.45),
        adverse_regime=_adverse(
            label="caution",
            size_multiplier=0.9,
            reason_components=["fear proxy remains elevated"],
            source="caller_override",
        ),
    )

    assert overlay.source == "caller_override"
    assert overlay.adverse_label == "caution"
    assert overlay.reasons[-1] == "fear proxy remains elevated"
    assert overlay.tier == "balanced"
