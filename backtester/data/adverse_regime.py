"""Shared adverse-regime ensemble over existing market stress inputs."""

from __future__ import annotations

from typing import Dict, Optional

from data.market_regime import MarketRegime
from scoring_tuning import (
    ADVERSE_REGIME_CALIBRATION,
    AdverseRegimeCalibration,
    ThresholdDetailBand,
    ThresholdScoreBand,
)


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _safe_float(value: object, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _first_matching_band(value: float, bands: tuple[ThresholdScoreBand, ...]) -> float:
    for band in bands:
        if value >= band.threshold:
            return band.score
    return 0.0


def _first_matching_detail_band(value: float, bands: tuple[ThresholdDetailBand, ...]) -> tuple[float, str]:
    for band in bands:
        if value >= band.threshold:
            return band.score, band.detail
    return 0.0, ""


def build_adverse_regime_indicator(
    *,
    market: Optional[object],
    risk_inputs: Optional[Dict[str, object]] = None,
    calibration: AdverseRegimeCalibration = ADVERSE_REGIME_CALIBRATION,
) -> Dict[str, object]:
    """Collapse existing market stress signals into one bounded runtime feature."""
    if market is None:
        return {
            "score": 0.0,
            "label": "normal",
            "reason": "market stress inputs unavailable",
            "reason_components": [],
            "components": [],
            "confidence_penalty": 0,
            "trade_quality_penalty": 0.0,
            "size_multiplier": 1.0,
            "source": "unavailable",
        }

    components: list[Dict[str, object]] = []

    def add_component(name: str, score: float, detail: str) -> None:
        if score <= 0:
            return
        components.append({"name": name, "score": round(score, 2), "detail": detail})

    regime = getattr(market, "regime", None)
    position_sizing = _clamp(_safe_float(getattr(market, "position_sizing", 1.0), 1.0), 0.0, 1.0)
    distribution_days = max(0, int(round(_safe_float(getattr(market, "distribution_days", 0), 0.0))))
    drawdown_pct = _safe_float(getattr(market, "drawdown_pct", 0.0), 0.0)
    drawdown_pct = -abs(drawdown_pct) if drawdown_pct > 0 else drawdown_pct
    trend_direction = str(getattr(market, "trend_direction", "sideways") or "sideways").lower()
    price_vs_21d_pct = _safe_float(getattr(market, "price_vs_21d_pct", 0.0), 0.0)
    price_vs_50d_pct = _safe_float(getattr(market, "price_vs_50d_pct", 0.0), 0.0)

    if regime == MarketRegime.CORRECTION:
        add_component("regime", calibration.correction_score, "market regime: correction")
    elif regime == MarketRegime.UPTREND_UNDER_PRESSURE:
        add_component("regime", calibration.under_pressure_score, "market regime: uptrend under pressure")
    elif regime == MarketRegime.RALLY_ATTEMPT:
        add_component("regime", calibration.rally_attempt_score, "market regime: rally attempt")

    sizing_stress = round((1.0 - position_sizing) * calibration.position_sizing_scale, 2)
    if sizing_stress >= calibration.position_sizing_min_component:
        add_component("position_sizing", sizing_stress, f"position sizing capped at {position_sizing:.0%}")

    distribution_score = _first_matching_band(float(distribution_days), calibration.distribution_day_bands)
    if distribution_score > 0:
        detail = "5 recent distribution days" if distribution_days == 5 else f"{distribution_days} recent distribution days"
        add_component("distribution_days", distribution_score, detail)

    drawdown_score = 0.0
    for band in calibration.drawdown_bands:
        if drawdown_pct <= band.threshold:
            drawdown_score = band.score
            break
    if drawdown_score > 0:
        add_component("drawdown", drawdown_score, f"{abs(drawdown_pct):.1f}% drawdown from recent high")

    if trend_direction == "down":
        add_component("trend", calibration.down_trend_score, "trend direction remains down")
    elif trend_direction == "sideways" and regime != MarketRegime.CONFIRMED_UPTREND:
        add_component("trend", calibration.sideways_trend_score, "trend direction is still sideways")

    if price_vs_21d_pct < 0:
        add_component("price_vs_21d", calibration.below_21d_score, "index is below the 21-day trend")
    if price_vs_50d_pct < 0:
        add_component("price_vs_50d", calibration.below_50d_score, "index is below the 50-day trend")

    macro_components: list[Dict[str, object]] = []
    risk_inputs = risk_inputs or {}
    vix_percentile = _safe_float(risk_inputs.get("vix_percentile"), float("nan"))
    hy_percentile = _safe_float(risk_inputs.get("hy_spread_percentile"), float("nan"))
    hy_spread = _safe_float(risk_inputs.get("hy_spread"), float("nan"))
    fear_greed = _safe_float(risk_inputs.get("fear_greed"), float("nan"))
    hy_change_10d = _safe_float(risk_inputs.get("hy_spread_change_10d"), float("nan"))

    if vix_percentile == vix_percentile:
        vix_score, vix_detail = _first_matching_detail_band(vix_percentile, calibration.vix_percentile_bands)
        if vix_score > 0:
            macro_components.append({"name": "vix_percentile", "score": vix_score, "detail": vix_detail})

    hy_stress_score = 0.0
    hy_stress_detail = ""
    if hy_percentile == hy_percentile:
        hy_stress_score, hy_stress_detail = _first_matching_detail_band(hy_percentile, calibration.hy_percentile_bands)
    elif hy_spread == hy_spread:
        hy_stress_score, hy_stress_detail = _first_matching_detail_band(hy_spread, calibration.hy_spread_bands)
    if hy_stress_score > 0:
        macro_components.append({"name": "hy_spread", "score": hy_stress_score, "detail": hy_stress_detail})

    if fear_greed == fear_greed:
        fear_score, fear_detail = _first_matching_detail_band(fear_greed, calibration.fear_greed_bands)
        if fear_score > 0:
            macro_components.append({"name": "fear_greed", "score": fear_score, "detail": fear_detail})

    if hy_change_10d == hy_change_10d:
        hy_change_score, hy_change_detail = _first_matching_detail_band(hy_change_10d, calibration.hy_change_10d_bands)
        if hy_change_score > 0:
            macro_components.append({"name": "hy_spread_change_10d", "score": hy_change_score, "detail": hy_change_detail})

    macro_total = min(sum(float(item["score"]) for item in macro_components), calibration.macro_component_cap)
    if macro_total > 0:
        macro_detail = "; ".join(str(item["detail"]) for item in macro_components[:2])
        add_component("macro", macro_total, macro_detail)

    ordered_components = sorted(components, key=lambda item: float(item["score"]), reverse=True)
    score = round(_clamp(sum(float(item["score"]) for item in ordered_components), 0.0, 100.0), 2)

    if score >= calibration.severe_threshold:
        label = "severe"
    elif score >= calibration.elevated_threshold:
        label = "elevated"
    elif score >= calibration.caution_threshold:
        label = "caution"
    else:
        label = "normal"

    reason_components = [str(item["detail"]) for item in ordered_components[:4]]
    reason = "; ".join(reason_components) if reason_components else "market backdrop is not showing elevated stress"

    return {
        "score": score,
        "label": label,
        "reason": reason,
        "reason_components": reason_components,
        "components": ordered_components,
        "confidence_penalty": int(round(_clamp(score / calibration.confidence_penalty_divisor, 0.0, calibration.confidence_penalty_cap))),
        "trade_quality_penalty": round(
            _clamp(score / calibration.trade_quality_penalty_divisor, 0.0, calibration.trade_quality_penalty_cap),
            2,
        ),
        "size_multiplier": round(
            _clamp(1.0 - (score / calibration.size_multiplier_divisor), calibration.size_multiplier_floor, calibration.size_multiplier_ceiling),
            2,
        ),
        "source": "market_status_plus_macro" if risk_inputs else "market_status",
    }
