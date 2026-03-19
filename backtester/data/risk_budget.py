"""Read-only risk budget overlay derived from existing regime and stress inputs."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Literal, Mapping, Optional

from data.adverse_regime import build_adverse_regime_indicator
from data.market_regime import MarketRegime

RiskBudgetTier = Literal["unavailable", "closed", "tight", "balanced", "open"]
AggressionDial = Literal["lean_more_selective", "no_change", "lean_more_aggressive"]


@dataclass(frozen=True)
class RiskBudgetOverlay:
    tier: RiskBudgetTier
    aggression_dial: AggressionDial
    budget_fraction: float
    budget_pct: int
    regime: str
    adverse_label: str
    explanation: str
    reasons: list[str]
    source: str
    state: str = "unknown"
    status: str = "unknown"
    label: str = "unknown"
    aggression_posture: str = "unknown"
    risk_budget_remaining: float = 0.0
    exposure_cap_hint: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def build_risk_budget_overlay(
    *,
    market: Optional[object],
    risk_inputs: Optional[Mapping[str, object]] = None,
    adverse_regime: Optional[Mapping[str, object]] = None,
) -> RiskBudgetOverlay:
    if market is None:
        return RiskBudgetOverlay(
            tier="unavailable",
            aggression_dial="no_change",
            budget_fraction=0.0,
            budget_pct=0,
            regime="unavailable",
            adverse_label="unavailable",
            explanation="Risk budget unavailable: market regime inputs unavailable.",
            reasons=["market regime inputs unavailable"],
            source="unavailable",
            state="unavailable",
            status="unavailable",
            label="unavailable",
            aggression_posture="no_change",
            risk_budget_remaining=0.0,
            exposure_cap_hint=0.0,
        )

    regime = _normalize_regime(getattr(market, "regime", None))
    position_sizing = _clamp(_safe_float(getattr(market, "position_sizing", 0.0), 0.0), 0.0, 1.0)
    degraded = str(getattr(market, "status", "ok") or "ok").strip().lower() == "degraded"

    stress = dict(
        adverse_regime
        or build_adverse_regime_indicator(
            market=market,
            risk_inputs=dict(risk_inputs or {}),
        )
    )
    adverse_label = str(stress.get("label", "normal") or "normal").strip().lower()
    stress_multiplier = _clamp(_safe_float(stress.get("size_multiplier"), 1.0), 0.0, 1.0)

    budget_fraction = position_sizing * stress_multiplier
    if degraded:
        budget_fraction *= 0.85
    budget_fraction = round(_clamp(budget_fraction, 0.0, 1.0), 2)

    if regime == MarketRegime.CORRECTION.value or position_sizing <= 0.0:
        tier: RiskBudgetTier = "closed"
        aggression_dial: AggressionDial = "lean_more_selective"
        budget_fraction = 0.0
    else:
        tier = _tier_for_fraction(budget_fraction)
        if adverse_label in {"elevated", "severe"}:
            tier = _downgrade_tier(tier)
        aggression_dial = _dial_for_context(
            regime=regime,
            tier=tier,
            degraded=degraded,
            adverse_label=adverse_label,
        )

    reasons = _build_reasons(
        regime=regime,
        position_sizing=position_sizing,
        degraded=degraded,
        adverse_regime=stress,
    )
    explanation = _build_explanation(
        tier=tier,
        regime=regime,
        adverse_label=adverse_label,
        reasons=reasons,
    )

    return RiskBudgetOverlay(
        tier=tier,
        aggression_dial=aggression_dial,
        budget_fraction=budget_fraction,
        budget_pct=int(round(budget_fraction * 100)),
        regime=regime,
        adverse_label=adverse_label,
        explanation=explanation,
        reasons=reasons,
        source=str(stress.get("source", "market_status") or "market_status"),
        state=tier,
        status=tier,
        label=tier,
        aggression_posture=aggression_dial,
        risk_budget_remaining=budget_fraction,
        exposure_cap_hint=budget_fraction,
    )


def _normalize_regime(value: object) -> str:
    if isinstance(value, MarketRegime):
        return value.value
    normalized = str(value or "").strip().lower()
    return normalized or "unknown"


def _safe_float(value: object, default: float) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _tier_for_fraction(budget_fraction: float) -> RiskBudgetTier:
    if budget_fraction <= 0.0:
        return "closed"
    if budget_fraction < 0.4:
        return "tight"
    if budget_fraction < 0.75:
        return "balanced"
    return "open"


def _downgrade_tier(tier: RiskBudgetTier) -> RiskBudgetTier:
    if tier == "open":
        return "balanced"
    if tier == "balanced":
        return "tight"
    return tier


def _dial_for_context(
    *,
    regime: str,
    tier: RiskBudgetTier,
    degraded: bool,
    adverse_label: str,
) -> AggressionDial:
    if tier in {"closed", "tight"}:
        return "lean_more_selective"
    if degraded or adverse_label in {"elevated", "severe"}:
        return "lean_more_selective"
    if regime == MarketRegime.CONFIRMED_UPTREND.value and adverse_label == "normal":
        return "lean_more_aggressive"
    return "no_change"


def _build_reasons(
    *,
    regime: str,
    position_sizing: float,
    degraded: bool,
    adverse_regime: Mapping[str, object],
) -> list[str]:
    reasons: list[str] = []

    regime_reason = {
        MarketRegime.CONFIRMED_UPTREND.value: "market regime confirmed uptrend",
        MarketRegime.UPTREND_UNDER_PRESSURE.value: "market regime uptrend under pressure",
        MarketRegime.CORRECTION.value: "market regime correction",
        MarketRegime.RALLY_ATTEMPT.value: "market regime rally attempt",
    }.get(regime)
    if regime_reason:
        reasons.append(regime_reason)

    if position_sizing < 0.99:
        reasons.append(f"base posture capped at {int(round(position_sizing * 100))}%")

    if degraded:
        reasons.append("market inputs degraded")

    label = str(adverse_regime.get("label", "normal") or "normal").strip().lower()
    if label != "normal":
        components = adverse_regime.get("reason_components")
        if isinstance(components, list):
            for item in components[:2]:
                detail = str(item or "").strip()
                if detail:
                    reasons.append(detail)
        if len(reasons) <= 1:
            detail = str(adverse_regime.get("reason", "") or "").strip()
            if detail:
                reasons.append(detail)

    return reasons or ["risk budget derived from current market posture"]


def _build_explanation(
    *,
    tier: RiskBudgetTier,
    regime: str,
    adverse_label: str,
    reasons: list[str],
) -> str:
    regime_text = regime.replace("_", " ")
    stress_text = f"stress {adverse_label}" if adverse_label not in {"", "normal", "unavailable"} else "stress normal"
    head = f"{tier} risk budget | {regime_text} | {stress_text}"
    if not reasons:
        return head
    return f"{head} | {'; '.join(reasons[:2])}"


__all__ = ["AggressionDial", "RiskBudgetOverlay", "RiskBudgetTier", "build_risk_budget_overlay"]
