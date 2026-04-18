"""Typed lifecycle artifacts for paper-trade state."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
import hashlib
from typing import Any, ClassVar


SCHEMA_VERSION = "lifecycle.v1"


class LifecycleStateError(ValueError):
    """Raised when a lifecycle state transition is invalid."""


def deterministic_key(*parts: object) -> str:
    raw = "|".join(str(part or "").strip() for part in parts)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:20]


def _normalize_timestamp(value: object) -> str:
    if isinstance(value, datetime):
        stamp = value.astimezone(timezone.utc) if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return stamp.isoformat()
    text = str(value or "").strip()
    if not text:
        raise LifecycleStateError("Lifecycle artifacts require explicit timestamps")
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as exc:
        raise LifecycleStateError(f"Invalid lifecycle timestamp: {text}") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat()


def _optional_float(value: object) -> float | None:
    if value is None or value == "":
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError) as exc:
        raise LifecycleStateError(f"Expected numeric lifecycle field, got {value!r}") from exc
    if numeric != numeric:
        return None
    return round(numeric, 4)


def _optional_int(value: object) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise LifecycleStateError(f"Expected integer lifecycle field, got {value!r}") from exc


@dataclass(frozen=True)
class EntryPlan:
    artifact_family: ClassVar[str] = "entry_plan"

    id: str
    plan_key: str
    schema_version: str
    symbol: str
    strategy: str
    created_at: str
    action_context: str
    entry_style: str
    entry_price_ideal_min: float | None = None
    entry_price_ideal_max: float | None = None
    do_not_chase_above: float | None = None
    initial_stop_price: float | None = None
    first_target_price: float | None = None
    stretch_target_price: float | None = None
    expected_hold_days_min: int | None = None
    expected_hold_days_max: int | None = None
    entry_reason: str | None = None
    entry_risk_summary: str | None = None
    execution_policy_ref: str | None = None
    data_quality_state: str | None = None
    prediction_ref: str | None = None
    executable: bool = False
    preview_only: bool = False
    suppressed_reason: str | None = None

    def __post_init__(self) -> None:
        if not self.symbol or not self.strategy:
            raise LifecycleStateError("EntryPlan requires symbol and strategy")
        if self.action_context not in {"BUY", "WATCH_PREVIEW"}:
            raise LifecycleStateError(f"Unsupported entry plan action_context: {self.action_context}")
        if self.preview_only and self.executable:
            raise LifecycleStateError("Preview entry plans cannot be executable")

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "EntryPlan":
        return cls(
            id=str(payload.get("id") or ""),
            plan_key=str(payload.get("plan_key") or ""),
            schema_version=str(payload.get("schema_version") or SCHEMA_VERSION),
            symbol=str(payload.get("symbol") or "").upper(),
            strategy=str(payload.get("strategy") or ""),
            created_at=_normalize_timestamp(payload.get("created_at")),
            action_context=str(payload.get("action_context") or ""),
            entry_style=str(payload.get("entry_style") or ""),
            entry_price_ideal_min=_optional_float(payload.get("entry_price_ideal_min")),
            entry_price_ideal_max=_optional_float(payload.get("entry_price_ideal_max")),
            do_not_chase_above=_optional_float(payload.get("do_not_chase_above")),
            initial_stop_price=_optional_float(payload.get("initial_stop_price")),
            first_target_price=_optional_float(payload.get("first_target_price")),
            stretch_target_price=_optional_float(payload.get("stretch_target_price")),
            expected_hold_days_min=_optional_int(payload.get("expected_hold_days_min")),
            expected_hold_days_max=_optional_int(payload.get("expected_hold_days_max")),
            entry_reason=str(payload.get("entry_reason") or "") or None,
            entry_risk_summary=str(payload.get("entry_risk_summary") or "") or None,
            execution_policy_ref=str(payload.get("execution_policy_ref") or "") or None,
            data_quality_state=str(payload.get("data_quality_state") or "") or None,
            prediction_ref=str(payload.get("prediction_ref") or "") or None,
            executable=bool(payload.get("executable", False)),
            preview_only=bool(payload.get("preview_only", False)),
            suppressed_reason=str(payload.get("suppressed_reason") or "") or None,
        )


@dataclass(frozen=True)
class OpenPosition:
    artifact_family: ClassVar[str] = "paper_open_position"

    id: str
    position_key: str
    schema_version: str
    symbol: str
    strategy: str
    entered_at: str
    entry_price: float
    size_tier: str | None = None
    capital_allocated: float | None = None
    entry_plan_ref: str | None = None
    execution_policy_ref: str | None = None
    stop_price: float | None = None
    target_price_1: float | None = None
    target_price_2: float | None = None
    current_state: str = "open"
    max_drawdown_pct: float | None = None
    max_runup_pct: float | None = None
    unrealized_return_pct: float | None = None
    portfolio_snapshot_ref: str | None = None
    portfolio_posture_ref: str | None = None
    authority_tier: str | None = None
    autonomy_mode: str | None = None
    strategy_budget_amount: float | None = None
    sector: str | None = None
    theme: str | None = None

    def __post_init__(self) -> None:
        if not self.position_key or not self.symbol or not self.strategy:
            raise LifecycleStateError("OpenPosition requires position_key, symbol, and strategy")
        if self.entry_price <= 0:
            raise LifecycleStateError("OpenPosition requires a positive entry_price")

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "OpenPosition":
        return cls(
            id=str(payload.get("id") or ""),
            position_key=str(payload.get("position_key") or ""),
            schema_version=str(payload.get("schema_version") or SCHEMA_VERSION),
            symbol=str(payload.get("symbol") or "").upper(),
            strategy=str(payload.get("strategy") or ""),
            entered_at=_normalize_timestamp(payload.get("entered_at")),
            entry_price=float(payload.get("entry_price")),
            size_tier=str(payload.get("size_tier") or "") or None,
            capital_allocated=_optional_float(payload.get("capital_allocated")),
            entry_plan_ref=str(payload.get("entry_plan_ref") or "") or None,
            execution_policy_ref=str(payload.get("execution_policy_ref") or "") or None,
            stop_price=_optional_float(payload.get("stop_price")),
            target_price_1=_optional_float(payload.get("target_price_1")),
            target_price_2=_optional_float(payload.get("target_price_2")),
            current_state=str(payload.get("current_state") or "open"),
            max_drawdown_pct=_optional_float(payload.get("max_drawdown_pct")),
            max_runup_pct=_optional_float(payload.get("max_runup_pct")),
            unrealized_return_pct=_optional_float(payload.get("unrealized_return_pct")),
            portfolio_snapshot_ref=str(payload.get("portfolio_snapshot_ref") or "") or None,
            portfolio_posture_ref=str(payload.get("portfolio_posture_ref") or "") or None,
            authority_tier=str(payload.get("authority_tier") or "") or None,
            autonomy_mode=str(payload.get("autonomy_mode") or "") or None,
            strategy_budget_amount=_optional_float(payload.get("strategy_budget_amount")),
            sector=str(payload.get("sector") or "") or None,
            theme=str(payload.get("theme") or "") or None,
        )


@dataclass(frozen=True)
class ClosedPosition:
    artifact_family: ClassVar[str] = "paper_closed_position"

    id: str
    position_key: str
    schema_version: str
    symbol: str
    strategy: str
    entered_at: str
    exited_at: str
    entry_price: float
    exit_price: float
    exit_reason: str | None = None
    realized_return_pct: float | None = None
    hold_days: float | None = None
    position_review_ref: str | None = None
    entry_plan_ref: str | None = None
    execution_policy_ref: str | None = None
    portfolio_posture_ref: str | None = None
    authority_tier: str | None = None
    autonomy_mode: str | None = None
    strategy_budget_amount: float | None = None

    def __post_init__(self) -> None:
        if not self.position_key:
            raise LifecycleStateError("ClosedPosition requires position_key")
        if self.entry_price <= 0 or self.exit_price <= 0:
            raise LifecycleStateError("ClosedPosition requires positive entry and exit prices")

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "ClosedPosition":
        return cls(
            id=str(payload.get("id") or ""),
            position_key=str(payload.get("position_key") or ""),
            schema_version=str(payload.get("schema_version") or SCHEMA_VERSION),
            symbol=str(payload.get("symbol") or "").upper(),
            strategy=str(payload.get("strategy") or ""),
            entered_at=_normalize_timestamp(payload.get("entered_at")),
            exited_at=_normalize_timestamp(payload.get("exited_at")),
            entry_price=float(payload.get("entry_price")),
            exit_price=float(payload.get("exit_price")),
            exit_reason=str(payload.get("exit_reason") or "") or None,
            realized_return_pct=_optional_float(payload.get("realized_return_pct")),
            hold_days=_optional_float(payload.get("hold_days")),
            position_review_ref=str(payload.get("position_review_ref") or "") or None,
            entry_plan_ref=str(payload.get("entry_plan_ref") or "") or None,
            execution_policy_ref=str(payload.get("execution_policy_ref") or "") or None,
            portfolio_posture_ref=str(payload.get("portfolio_posture_ref") or "") or None,
            authority_tier=str(payload.get("authority_tier") or "") or None,
            autonomy_mode=str(payload.get("autonomy_mode") or "") or None,
            strategy_budget_amount=_optional_float(payload.get("strategy_budget_amount")),
        )


@dataclass(frozen=True)
class ExitDecision:
    artifact_family: ClassVar[str] = "exit_decision"

    position_key: str
    decided_at: str
    action: str
    reason: str
    exit_price: float | None = None
    exit_state: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class PositionReview:
    artifact_family: ClassVar[str] = "position_review"

    id: str
    review_key: str
    schema_version: str
    position_key: str
    symbol: str
    strategy: str
    reviewed_at: str
    exit_reason: str
    hold_days: float | None = None
    realized_return_pct: float | None = None
    max_drawdown_pct: float | None = None
    max_runup_pct: float | None = None
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
