"""Canonical V3 risk-budget stack."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any


def build_risk_budget_state(
    *,
    total_capital: float,
    open_positions: list[Any],
    portfolio_drawdown_pct: float | None = None,
    gross_exposure_budget_fraction: float = 0.80,
    max_single_position_fraction: float = 0.20,
    sector_cap_fraction: float = 0.35,
    theme_cap_fraction: float = 0.40,
    generated_at: str | None = None,
) -> dict[str, Any]:
    drawdown_pct = float(portfolio_drawdown_pct or 0.0)
    posture_state = "risk_on"
    allowed_gross_fraction = gross_exposure_budget_fraction
    warnings: list[str] = []

    if drawdown_pct >= 8.0:
        posture_state = "paused"
        allowed_gross_fraction = 0.0
        warnings.append("drawdown_pause")
    elif drawdown_pct >= 5.0:
        posture_state = "defensive"
        allowed_gross_fraction = min(gross_exposure_budget_fraction, 0.35)
        warnings.append("drawdown_defensive")
    elif drawdown_pct >= 2.5:
        posture_state = "selective"
        allowed_gross_fraction = min(gross_exposure_budget_fraction, 0.55)
        warnings.append("drawdown_selective")

    capital_in_use = round(sum(float(getattr(position, "capital_allocated", 0.0) or 0.0) for position in open_positions), 2)
    gross_exposure_fraction = round((capital_in_use / total_capital), 4) if total_capital > 0 else 0.0
    if gross_exposure_fraction >= allowed_gross_fraction and allowed_gross_fraction > 0:
        warnings.append("gross_exposure_near_limit")

    return {
        "artifact_family": "risk_budget_stack_v1",
        "schema_version": 1,
        "generated_at": _normalize_timestamp(generated_at),
        "posture_state": posture_state,
        "drawdown_state": {
            "portfolio_drawdown_pct": round(drawdown_pct, 4),
            "allowed_gross_exposure_fraction": round(allowed_gross_fraction, 4),
        },
        "gross_exposure": {
            "current_fraction": gross_exposure_fraction,
            "allowed_fraction": round(allowed_gross_fraction, 4),
        },
        "position_limits": {
            "max_single_position_fraction": round(max_single_position_fraction, 4),
        },
        "concentration_caps": {
            "sector_cap_fraction": round(sector_cap_fraction, 4),
            "theme_cap_fraction": round(theme_cap_fraction, 4),
        },
        "warnings": warnings,
    }


def _normalize_timestamp(value: object) -> str:
    if isinstance(value, str) and value.strip():
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            parsed = datetime.now(UTC)
    else:
        parsed = datetime.now(UTC)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC).isoformat()
