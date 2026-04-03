"""Replayable exit decisions for paper-trade lifecycle."""

from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timezone
from typing import Any

from lifecycle.trade_objects import ExitDecision, OpenPosition


MAX_HOLD_DAYS = {
    "canslim": 20,
    "dip_buyer": 15,
}


def evaluate_exit_decision(
    *,
    position: OpenPosition,
    reviewed_at: str,
    current_price: float | None,
    market: dict[str, Any] | None = None,
    signal: dict[str, Any] | None = None,
    manual_override_reason: str | None = None,
) -> ExitDecision:
    decided_at = _normalize_timestamp(reviewed_at)
    price = _safe_price(current_price) or position.entry_price
    signal_action = str((signal or {}).get("action") or "").strip().upper()
    market_regime = str((market or {}).get("label") or (market or {}).get("regime") or "").strip().lower()
    hold_days = _hold_days(position.entered_at, decided_at)

    if manual_override_reason:
        return ExitDecision(
            position_key=position.position_key,
            decided_at=decided_at,
            action="EXIT",
            reason="manual_override",
            exit_price=price,
            exit_state=manual_override_reason,
        )
    if position.stop_price is not None and price <= position.stop_price:
        return ExitDecision(
            position_key=position.position_key,
            decided_at=decided_at,
            action="EXIT",
            reason="stop_hit",
            exit_price=price,
            exit_state="closed",
        )
    if position.target_price_1 is not None and price >= position.target_price_1:
        return ExitDecision(
            position_key=position.position_key,
            decided_at=decided_at,
            action="EXIT",
            reason="target_hit",
            exit_price=price,
            exit_state="closed",
        )
    if signal_action == "NO_BUY":
        return ExitDecision(
            position_key=position.position_key,
            decided_at=decided_at,
            action="EXIT",
            reason="signal_downgrade",
            exit_price=price,
            exit_state="closed",
        )
    if hold_days >= float(MAX_HOLD_DAYS.get(position.strategy, 15)):
        return ExitDecision(
            position_key=position.position_key,
            decided_at=decided_at,
            action="EXIT",
            reason="max_hold",
            exit_price=price,
            exit_state="closed",
        )
    current_return = ((price / position.entry_price) - 1.0) * 100.0 if position.entry_price > 0 else 0.0
    if market_regime == "correction" and current_return <= 0:
        return ExitDecision(
            position_key=position.position_key,
            decided_at=decided_at,
            action="EXIT",
            reason="regime_deterioration",
            exit_price=price,
            exit_state="closed",
        )
    return ExitDecision(
        position_key=position.position_key,
        decided_at=decided_at,
        action="HOLD",
        reason="hold",
        exit_price=price,
        exit_state=position.current_state,
    )


def update_position_mark_to_market(
    *,
    position: OpenPosition,
    current_price: float | None,
    current_state: str | None = None,
) -> OpenPosition:
    price = _safe_price(current_price) or position.entry_price
    current_return = ((price / position.entry_price) - 1.0) * 100.0 if position.entry_price > 0 else 0.0
    max_runup = current_return if position.max_runup_pct is None else max(position.max_runup_pct, current_return)
    max_drawdown = current_return if position.max_drawdown_pct is None else min(position.max_drawdown_pct, current_return)
    return OpenPosition(
        id=position.id,
        position_key=position.position_key,
        schema_version=position.schema_version,
        symbol=position.symbol,
        strategy=position.strategy,
        entered_at=position.entered_at,
        entry_price=position.entry_price,
        size_tier=position.size_tier,
        capital_allocated=position.capital_allocated,
        entry_plan_ref=position.entry_plan_ref,
        execution_policy_ref=position.execution_policy_ref,
        stop_price=position.stop_price,
        target_price_1=position.target_price_1,
        target_price_2=position.target_price_2,
        current_state=current_state or position.current_state,
        max_drawdown_pct=round(max_drawdown, 4),
        max_runup_pct=round(max_runup, 4),
        unrealized_return_pct=round(current_return, 4),
        portfolio_snapshot_ref=position.portfolio_snapshot_ref,
    )


def exit_decision_to_dict(decision: ExitDecision) -> dict[str, Any]:
    return asdict(decision)


def _normalize_timestamp(value: str) -> str:
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat()


def _hold_days(entered_at: str, reviewed_at: str) -> float:
    entered = datetime.fromisoformat(str(entered_at).replace("Z", "+00:00"))
    reviewed = datetime.fromisoformat(str(reviewed_at).replace("Z", "+00:00"))
    if entered.tzinfo is None:
        entered = entered.replace(tzinfo=timezone.utc)
    if reviewed.tzinfo is None:
        reviewed = reviewed.replace(tzinfo=timezone.utc)
    delta = reviewed.astimezone(timezone.utc) - entered.astimezone(timezone.utc)
    return round(delta.total_seconds() / 86400.0, 4)


def _safe_price(value: object) -> float | None:
    try:
        if value is None or value == "":
            return None
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if numeric <= 0 or numeric != numeric:
        return None
    return numeric
