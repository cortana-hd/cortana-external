"""Shared confidence and uncertainty assessment helpers."""

from __future__ import annotations

from typing import Dict, Iterable, Optional

from data.market_regime import MarketRegime, MarketStatus


REASON_MESSAGES = {
    "market_regime_degraded": "Market regime data is degraded.",
    "market_correction": "Market regime is a correction.",
    "symbol_data_stale": "Symbol price history is stale or degraded.",
    "insufficient_history": "Price history is insufficient for a reliable read.",
    "sentiment_unavailable": "Reliable sentiment inputs are unavailable.",
    "sentiment_conflict": "Sentiment inputs disagree.",
    "sector_unavailable": "Sector context is unavailable.",
    "catalyst_event_imminent": "A catalyst event is too close to trust sizing.",
    "signal_conflict": "Signal layers are materially conflicted.",
    "credit_veto": "Credit veto is active.",
    "falling_knife": "Falling-knife filter is active.",
    "risk_data_incomplete": "Risk inputs are incomplete.",
}


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def confidence_bucket(value: float) -> str:
    """Map effective confidence to a stable evaluation bucket."""
    if value >= 75:
        return "high"
    if value >= 55:
        return "medium"
    if value >= 35:
        return "low"
    return "very_low"


def _size_multiplier(effective_confidence_pct: float, uncertainty_pct: float, abstain: bool) -> float:
    if abstain:
        return 0.5

    if effective_confidence_pct >= 85:
        confidence_multiplier = 1.1
    elif effective_confidence_pct >= 75:
        confidence_multiplier = 1.0
    elif effective_confidence_pct >= 65:
        confidence_multiplier = 0.9
    elif effective_confidence_pct >= 55:
        confidence_multiplier = 0.78
    else:
        confidence_multiplier = 0.65

    if uncertainty_pct >= 35:
        uncertainty_multiplier = 0.72
    elif uncertainty_pct >= 25:
        uncertainty_multiplier = 0.82
    elif uncertainty_pct >= 15:
        uncertainty_multiplier = 0.92
    else:
        uncertainty_multiplier = 1.0

    return round(_clamp(confidence_multiplier * uncertainty_multiplier, 0.4, 1.1), 2)


def _normalize_codes(codes: Iterable[str]) -> list[str]:
    ordered: list[str] = []
    seen = set()
    for code in codes:
        if not code or code in seen:
            continue
        seen.add(code)
        ordered.append(code)
    return ordered


def _finalize_assessment(
    *,
    symbol: str,
    raw_confidence_pct: float,
    component_signal: Dict[str, int],
    component_uncertainty: Dict[str, int],
    data_quality: Dict[str, object],
    reason_codes: Iterable[str],
) -> Dict:
    uncertainty_pct = int(
        _clamp(sum(max(0, int(value)) for value in component_uncertainty.values()), 0, 95)
    )
    effective_confidence_pct = int(_clamp(round(raw_confidence_pct) - uncertainty_pct, 0, 100))
    codes = _normalize_codes(reason_codes)
    abstain = uncertainty_pct >= 35 or effective_confidence_pct < 35
    if abstain and not codes:
        codes = ["signal_conflict"]

    return {
        "version": 1,
        "symbol": symbol,
        "raw_confidence_pct": int(_clamp(round(raw_confidence_pct), 0, 100)),
        "uncertainty_pct": uncertainty_pct,
        "effective_confidence_pct": effective_confidence_pct,
        "confidence_bucket": confidence_bucket(effective_confidence_pct),
        "size_multiplier": _size_multiplier(effective_confidence_pct, uncertainty_pct, abstain),
        "abstain": abstain,
        "abstain_reason_codes": codes if abstain else [],
        "abstain_reasons": [REASON_MESSAGES.get(code, code.replace("_", " ")) for code in codes] if abstain else [],
        "component_signal": component_signal,
        "component_uncertainty": component_uncertainty,
        "data_quality": data_quality,
    }


def build_confidence_assessment(
    *,
    market: MarketStatus,
    total_score: int,
    breakout: Dict,
    sentiment_overlay: Dict,
    exit_risk: Dict,
    sector_context: Dict,
    catalyst_weighting: Dict,
    data_status: str,
    data_staleness_seconds: float,
    history_bars: int,
    symbol: str,
) -> Dict:
    """Build a shared CANSLIM confidence/uncertainty assessment."""
    breakout_score = int((breakout or {}).get("score", 0))
    sentiment_score = int((sentiment_overlay or {}).get("score", 0))
    exit_risk_score = int((exit_risk or {}).get("score", 0))
    sector_score = int((sector_context or {}).get("score", 0))
    catalyst_score = int((catalyst_weighting or {}).get("score", 0))
    sentiment_delta = int((sentiment_overlay or {}).get("confidence_delta", 0))
    sector_delta = int((sector_context or {}).get("confidence_delta", 0))
    catalyst_delta = int((catalyst_weighting or {}).get("confidence_delta", 0))

    raw_confidence_pct = _clamp(
        28
        + total_score * 5
        + breakout_score * 6
        + sentiment_delta
        - exit_risk_score * 7
        + sector_delta
        + catalyst_delta,
        5,
        95,
    )

    market_penalty = 0
    reason_codes: list[str] = []
    if getattr(market, "status", "ok") == "degraded":
        market_penalty += 10
        if float(getattr(market, "snapshot_age_seconds", 0.0) or 0.0) >= 1800:
            market_penalty += 4
        reason_codes.append("market_regime_degraded")

    stale_penalty = 0
    if data_status != "ok":
        stale_penalty += 6
    if data_staleness_seconds >= 3600:
        stale_penalty += 10
    elif data_staleness_seconds >= 900:
        stale_penalty += 6
    elif data_staleness_seconds >= 300:
        stale_penalty += 3
    if stale_penalty:
        reason_codes.append("symbol_data_stale")

    history_penalty = 0
    if history_bars < 50:
        history_penalty = 20
    elif history_bars < 126:
        history_penalty = 10
    elif history_bars < 200:
        history_penalty = 4
    if history_penalty:
        reason_codes.append("insufficient_history")

    sentiment_unavailable_penalty = 0
    sentiment_conflict_penalty = 0
    sentiment_source = (sentiment_overlay or {}).get("source", "none")
    sentiment_reason = str((sentiment_overlay or {}).get("reason", "")).lower()
    if sentiment_source == "none":
        sentiment_unavailable_penalty = 6
        reason_codes.append("sentiment_unavailable")
    elif "disagree" in sentiment_reason:
        sentiment_conflict_penalty = 8
        reason_codes.append("sentiment_conflict")

    sector_penalty = 0
    if (sector_context or {}).get("status") in {"unavailable", "unmapped", "insufficient"}:
        sector_penalty = 5
        reason_codes.append("sector_unavailable")

    event_penalty = 0
    if catalyst_score <= -2:
        event_penalty = 10
    elif catalyst_score < 0:
        event_penalty = 6
    if event_penalty:
        reason_codes.append("catalyst_event_imminent")

    signal_conflict_penalty = 0
    if total_score >= 8 and exit_risk_score >= 3:
        signal_conflict_penalty += 8
    if total_score >= 8 and sector_score < 0:
        signal_conflict_penalty += 4
    if sentiment_score > 0 and breakout_score <= 1:
        signal_conflict_penalty += 4
    if sentiment_score < 0 and breakout_score >= 4:
        signal_conflict_penalty += 4
    if sector_score < 0 and catalyst_score < 0 and total_score >= 7:
        signal_conflict_penalty += 4
    if signal_conflict_penalty:
        reason_codes.append("signal_conflict")

    if getattr(market, "regime", None) == MarketRegime.CORRECTION:
        reason_codes.append("market_correction")

    component_signal = {
        "total_score": int(total_score),
        "breakout_score": breakout_score,
        "sentiment_score": sentiment_score,
        "sector_score": sector_score,
        "catalyst_score": catalyst_score,
        "exit_risk_score": exit_risk_score,
    }
    component_uncertainty = {
        "market_data_degraded": market_penalty,
        "symbol_data_stale": stale_penalty,
        "insufficient_history": history_penalty,
        "sentiment_unavailable": sentiment_unavailable_penalty,
        "sentiment_conflict": sentiment_conflict_penalty,
        "sector_unavailable": sector_penalty,
        "event_risk": event_penalty,
        "signal_conflict": signal_conflict_penalty,
    }
    data_quality = {
        "history_status": data_status,
        "history_staleness_seconds": float(data_staleness_seconds or 0.0),
        "market_status": getattr(market, "status", "ok"),
        "market_snapshot_age_seconds": float(getattr(market, "snapshot_age_seconds", 0.0) or 0.0),
    }

    return _finalize_assessment(
        symbol=symbol,
        raw_confidence_pct=raw_confidence_pct,
        component_signal=component_signal,
        component_uncertainty=component_uncertainty,
        data_quality=data_quality,
        reason_codes=reason_codes,
    )


def build_dip_confidence_assessment(
    *,
    symbol: str,
    market: MarketStatus,
    total_score: int,
    q_score: int,
    v_score: int,
    c_score: int,
    market_active: bool,
    credit_veto: bool,
    recovery_ready: bool,
    falling_knife: bool,
    risk_inputs: Optional[Dict[str, object]] = None,
    data_status: str = "ok",
    data_staleness_seconds: float = 0.0,
    history_bars: int = 0,
) -> Dict:
    """Build a Dip Buyer confidence assessment with the shared contract."""
    raw_confidence_pct = _clamp(
        24
        + total_score * 6
        + (6 if recovery_ready else -8)
        + (4 if market_active else -12)
        - (10 if falling_knife else 0)
        - (18 if credit_veto else 0),
        5,
        95,
    )

    market_penalty = 0
    reason_codes: list[str] = []
    if getattr(market, "status", "ok") == "degraded":
        market_penalty += 10
        reason_codes.append("market_regime_degraded")

    stale_penalty = 0
    if data_status != "ok":
        stale_penalty += 6
    if data_staleness_seconds >= 3600:
        stale_penalty += 10
    elif data_staleness_seconds >= 900:
        stale_penalty += 6
    elif data_staleness_seconds >= 300:
        stale_penalty += 3
    if stale_penalty:
        reason_codes.append("symbol_data_stale")

    history_penalty = 0
    if history_bars < 30:
        history_penalty = 16
    elif history_bars < 60:
        history_penalty = 6
    if history_penalty:
        reason_codes.append("insufficient_history")

    risk_penalty = 0
    if risk_inputs:
        missing_count = sum(1 for value in risk_inputs.values() if value is None)
        risk_penalty = min(missing_count * 4, 12)
        if risk_penalty:
            reason_codes.append("risk_data_incomplete")

    structure_penalty = 0
    if credit_veto:
        structure_penalty += 22
        reason_codes.append("credit_veto")
    if falling_knife:
        structure_penalty += 18
        reason_codes.append("falling_knife")
    if not market_active and getattr(market, "regime", None) == MarketRegime.CORRECTION:
        reason_codes.append("market_correction")

    component_signal = {
        "total_score": int(total_score),
        "q_score": int(q_score),
        "v_score": int(v_score),
        "c_score": int(c_score),
        "market_active": int(bool(market_active)),
        "recovery_ready": int(bool(recovery_ready)),
    }
    component_uncertainty = {
        "market_data_degraded": market_penalty,
        "symbol_data_stale": stale_penalty,
        "insufficient_history": history_penalty,
        "risk_data_incomplete": risk_penalty,
        "signal_conflict": structure_penalty,
    }
    data_quality = {
        "history_status": data_status,
        "history_staleness_seconds": float(data_staleness_seconds or 0.0),
        "market_status": getattr(market, "status", "ok"),
        "market_snapshot_age_seconds": float(getattr(market, "snapshot_age_seconds", 0.0) or 0.0),
    }

    return _finalize_assessment(
        symbol=symbol,
        raw_confidence_pct=raw_confidence_pct,
        component_signal=component_signal,
        component_uncertainty=component_uncertainty,
        data_quality=data_quality,
        reason_codes=reason_codes,
    )
