"""Execution-policy and fill-realism helpers."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from lifecycle.trade_objects import deterministic_key


@dataclass(frozen=True)
class ExecutionPolicy:
    id: str
    policy_key: str
    schema_version: str
    symbol: str
    strategy: str
    created_at: str
    entry_order_type: str
    entry_valid_until: str | None
    gap_above_zone_policy: str
    partial_fill_policy: str
    cancel_if_not_filled: bool
    execution_timing_assumption: str
    slippage_model_ref: str | None
    stop_fill_policy: str
    target_fill_policy: str
    liquidity_penalty_bps: float | None = None
    expected_fill_fraction: float = 1.0
    fill_realism_state: str = "clean"
    fill_allowed: bool = True
    blocked_reason: str | None = None
    policy_notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def build_execution_policy(
    *,
    strategy: str,
    signal: dict[str, Any],
    entry_plan: dict[str, Any],
    overlays: dict[str, Any] | None = None,
    generated_at: str,
) -> ExecutionPolicy:
    normalized_strategy = str(strategy or "").strip().lower()
    signal_price = _optional_float(signal.get("price"))
    chase_limit = _optional_float(entry_plan.get("do_not_chase_above"))
    execution_overlay = _execution_overlay(overlays)
    risk_overlay = _risk_overlay(overlays)

    liquidity_penalty_bps = _liquidity_penalty_bps(execution_overlay)
    execution_quality = str(
        execution_overlay.get("execution_quality")
        or execution_overlay.get("quality_label")
        or execution_overlay.get("liquidity_quality")
        or ""
    ).strip().lower()
    risk_state = str(
        risk_overlay.get("state")
        or risk_overlay.get("tier")
        or risk_overlay.get("status")
        or ""
    ).strip().lower()

    blocked_reason = None
    notes: list[str] = []
    if signal_price is not None and chase_limit is not None and signal_price > chase_limit:
        blocked_reason = "gap_above_zone"
        notes.append(f"signal price {signal_price:.2f} is above chase limit {chase_limit:.2f}")
    elif risk_state in {"closed", "unavailable"}:
        blocked_reason = "risk_budget_closed"
        notes.append("risk budget is closed or unavailable")
    elif liquidity_penalty_bps is not None and liquidity_penalty_bps >= 80:
        blocked_reason = "liquidity_penalty_too_high"
        notes.append(f"estimated slippage {liquidity_penalty_bps:.1f}bps exceeds threshold")
    elif execution_quality in {"low", "illiquid"}:
        blocked_reason = "execution_quality_too_low"
        notes.append(f"execution quality is {execution_quality}")

    expected_fill_fraction = _expected_fill_fraction(liquidity_penalty_bps=liquidity_penalty_bps)
    if blocked_reason is not None:
        fill_realism_state = "blocked"
    elif expected_fill_fraction < 1.0:
        fill_realism_state = "partial_fill_risk"
        notes.append(f"expected fill fraction capped at {expected_fill_fraction:.2f}")
    else:
        fill_realism_state = "clean"

    created = _normalize_timestamp(generated_at)
    policy_key = str(signal.get("execution_policy_ref") or "").strip() or (
        f"{normalized_strategy}:{signal.get('symbol')}:{created}:"
        f"{deterministic_key(normalized_strategy, signal.get('symbol'), created, signal.get('action'))}"
    )
    policy_id = deterministic_key("execution_policy", policy_key)
    return ExecutionPolicy(
        id=policy_id,
        policy_key=policy_key,
        schema_version="execution_policy.v1",
        symbol=str(signal.get("symbol") or "").upper(),
        strategy=normalized_strategy,
        created_at=created,
        entry_order_type="limit",
        entry_valid_until=(datetime.fromisoformat(created) + timedelta(days=1)).astimezone(timezone.utc).isoformat(),
        gap_above_zone_policy="cancel" if normalized_strategy == "canslim" else "pause_and_retest",
        partial_fill_policy="allow_partial" if expected_fill_fraction >= 0.75 else "cancel_partial",
        cancel_if_not_filled=True,
        execution_timing_assumption="same_day_limit",
        slippage_model_ref="liquidity_overlay.v1",
        stop_fill_policy="next_trade_or_stop",
        target_fill_policy="limit_target",
        liquidity_penalty_bps=liquidity_penalty_bps,
        expected_fill_fraction=expected_fill_fraction,
        fill_realism_state=fill_realism_state,
        fill_allowed=blocked_reason is None,
        blocked_reason=blocked_reason,
        policy_notes=notes,
    )


def annotate_alert_payload_with_execution_policies(
    *,
    strategy: str,
    payload: dict[str, Any],
    generated_at: str,
) -> dict[str, Any]:
    signals = list(payload.get("signals") or [])
    overlays = dict(payload.get("overlays") or {})
    policies: list[dict[str, Any]] = []
    enriched_signals: list[dict[str, Any]] = []
    refreshed_entry_plans: list[dict[str, Any]] = []

    for signal in signals:
        copied = dict(signal)
        entry_plan = copied.get("entry_plan")
        if not isinstance(entry_plan, dict):
            enriched_signals.append(copied)
            continue
        policy = build_execution_policy(
            strategy=strategy,
            signal=copied,
            entry_plan=entry_plan,
            overlays=overlays,
            generated_at=generated_at,
        )
        entry_plan_copy = dict(entry_plan)
        entry_plan_copy["execution_policy_ref"] = policy.policy_key
        copied["entry_plan"] = entry_plan_copy
        copied["entry_plan_ref"] = entry_plan_copy.get("plan_key") or copied.get("entry_plan_ref")
        copied["execution_policy"] = policy.to_dict()
        copied["execution_policy_ref"] = policy.policy_key
        enriched_signals.append(copied)
        refreshed_entry_plans.append(entry_plan_copy)
        policies.append(policy.to_dict())

    payload["signals"] = enriched_signals
    if refreshed_entry_plans:
        payload["entry_plans"] = refreshed_entry_plans
    payload["execution_policies"] = policies
    return payload


def build_execution_policy_artifact(policies: list[ExecutionPolicy]) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "artifact_family": "execution_policy_snapshots",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "policies": [policy.to_dict() for policy in policies],
    }


def _execution_overlay(overlays: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(overlays, dict):
        return {}
    payload = overlays.get("execution")
    return payload if isinstance(payload, dict) else {}


def _risk_overlay(overlays: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(overlays, dict):
        return {}
    payload = overlays.get("risk")
    return payload if isinstance(payload, dict) else {}


def _liquidity_penalty_bps(execution_overlay: dict[str, Any]) -> float | None:
    penalty = _optional_float(
        execution_overlay.get("estimated_slippage_bps")
        or execution_overlay.get("slippage_bps")
    )
    if penalty is None:
        return None
    quality = str(
        execution_overlay.get("execution_quality")
        or execution_overlay.get("quality_label")
        or ""
    ).strip().lower()
    if quality == "moderate":
        penalty += 8.0
    elif quality in {"low", "illiquid"}:
        penalty += 20.0
    return round(penalty, 2)


def _expected_fill_fraction(*, liquidity_penalty_bps: float | None) -> float:
    if liquidity_penalty_bps is None:
        return 1.0
    if liquidity_penalty_bps >= 80:
        return 0.0
    if liquidity_penalty_bps >= 50:
        return 0.5
    if liquidity_penalty_bps >= 25:
        return 0.75
    return 1.0


def _optional_float(value: object) -> float | None:
    try:
        if value is None or value == "":
            return None
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if numeric != numeric:
        return None
    return numeric


def _normalize_timestamp(value: str) -> str:
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat()
