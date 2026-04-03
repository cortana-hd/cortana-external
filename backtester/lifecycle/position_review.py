"""Position-review artifact helpers."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from lifecycle.trade_objects import ExitDecision, OpenPosition, PositionReview, deterministic_key


def build_position_review(
    *,
    position: OpenPosition,
    decision: ExitDecision,
    reviewed_at: str,
    current_price: float | None,
    notes: list[str] | None = None,
) -> PositionReview:
    reviewed_stamp = _normalize_timestamp(reviewed_at)
    price = _safe_price(current_price) or decision.exit_price or position.entry_price
    realized_return = ((price / position.entry_price) - 1.0) * 100.0 if position.entry_price > 0 else None
    hold_days = _hold_days(position.entered_at, reviewed_stamp)
    review_key = (
        f"{position.position_key}:{reviewed_stamp}:{decision.reason}:"
        f"{deterministic_key(position.position_key, reviewed_stamp, decision.reason)}"
    )
    return PositionReview(
        id=deterministic_key("position_review", review_key),
        review_key=review_key,
        schema_version=position.schema_version,
        position_key=position.position_key,
        symbol=position.symbol,
        strategy=position.strategy,
        reviewed_at=reviewed_stamp,
        exit_reason=decision.reason,
        hold_days=hold_days,
        realized_return_pct=round(realized_return, 4) if realized_return is not None else None,
        max_drawdown_pct=position.max_drawdown_pct,
        max_runup_pct=position.max_runup_pct,
        notes=list(notes or []),
    )


def build_position_review_artifact(
    *,
    reviews: list[PositionReview],
    generated_at: str | None = None,
) -> dict[str, Any]:
    return {
        "artifact_family": "position_reviews",
        "schema_version": 1,
        "generated_at": _normalize_timestamp(generated_at or datetime.now(timezone.utc).isoformat()),
        "reviews": [review.to_dict() for review in reviews],
    }


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
    return round((reviewed.astimezone(timezone.utc) - entered.astimezone(timezone.utc)).total_seconds() / 86400.0, 4)


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
