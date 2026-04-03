"""Versioned prediction contract helpers for strategy snapshot producers."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any, Iterable, Mapping

PREDICTION_CONTRACT_SCHEMA_VERSION = 1

_VETO_FLAG_MAP: tuple[tuple[str, str], ...] = (
    ("credit_veto", "credit"),
    ("sentiment_veto", "sentiment"),
    ("exit_risk_veto", "exit_risk"),
    ("market_regime_blocked", "market_regime"),
    ("falling_knife", "falling_knife"),
    ("market_inactive", "market_inactive"),
)


@dataclass(frozen=True)
class PredictionContractRecord:
    schema_version: int
    producer: str
    symbol: str
    strategy: str
    action: str
    predicted_at: str
    known_at: str
    market_regime: str
    confidence: float | None
    risk: str
    score: float | None
    uncertainty_pct: float | None
    trade_quality_score: float | None
    breadth_state: str | None
    entry_plan_ref: str | None
    execution_policy_ref: str | None
    vetoes: list[str]
    abstain: bool
    reason: str


def build_prediction_contract_records(
    *,
    strategy: str,
    market_regime: str,
    records: Iterable[Mapping[str, Any]],
    generated_at: datetime,
    producer: str | None = None,
) -> list[PredictionContractRecord]:
    return [
        build_prediction_contract_record(
            strategy=strategy,
            market_regime=market_regime,
            record=record,
            generated_at=generated_at,
            producer=producer,
        )
        for record in records
    ]


def build_prediction_contract_record(
    *,
    strategy: str,
    market_regime: str,
    record: Mapping[str, Any],
    generated_at: datetime,
    producer: str | None = None,
) -> PredictionContractRecord:
    normalized_strategy = str(strategy or "").strip()
    if not normalized_strategy:
        raise ValueError("prediction contract requires a strategy")

    symbol = str(record.get("symbol") or "").strip().upper()
    if not symbol:
        raise ValueError("prediction contract requires a symbol")

    action = str(record.get("action") or "").strip().upper()
    if not action:
        raise ValueError(f"prediction contract requires an action for {symbol}")

    reason = str(record.get("reason") or "").strip()
    if not reason:
        raise ValueError(f"prediction contract requires a reason for {symbol}")

    timestamp = generated_at.astimezone(timezone.utc).isoformat()
    normalized_regime = str(
        record.get("market_regime")
        or record.get("regime_label")
        or market_regime
        or "unknown"
    ).strip()
    if not normalized_regime:
        normalized_regime = "unknown"

    normalized_producer = str(producer or f"backtester.{normalized_strategy}.prediction_snapshot").strip()
    if not normalized_producer:
        raise ValueError("prediction contract requires a producer")

    return PredictionContractRecord(
        schema_version=PREDICTION_CONTRACT_SCHEMA_VERSION,
        producer=normalized_producer,
        symbol=symbol,
        strategy=normalized_strategy,
        action=action,
        predicted_at=timestamp,
        known_at=timestamp,
        market_regime=normalized_regime,
        confidence=_to_float(record.get("effective_confidence", record.get("confidence"))),
        risk=_normalize_risk(record.get("risk")),
        score=_to_float(record.get("score")),
        uncertainty_pct=_to_float(record.get("uncertainty_pct")),
        trade_quality_score=_to_float(record.get("trade_quality_score")),
        breadth_state=_normalize_optional_text(
            record.get("breadth_state", record.get("intraday_override_state"))
        ),
        entry_plan_ref=_normalize_optional_text(record.get("entry_plan_ref")),
        execution_policy_ref=_normalize_optional_text(record.get("execution_policy_ref")),
        vetoes=_normalize_vetoes(record),
        abstain=bool(record.get("abstain", False)),
        reason=reason,
    )


def serialize_prediction_contract_records(records: Iterable[PredictionContractRecord]) -> list[dict[str, Any]]:
    return [asdict(record) for record in records]


def _normalize_risk(value: object) -> str:
    text = str(value or "").strip().lower()
    return text or "unknown"


def _normalize_optional_text(value: object) -> str | None:
    text = str(value or "").strip()
    return text or None


def _normalize_vetoes(record: Mapping[str, Any]) -> list[str]:
    explicit = record.get("vetoes")
    if isinstance(explicit, list):
        return [str(item).strip() for item in explicit if str(item or "").strip()]
    tags = [label for key, label in _VETO_FLAG_MAP if bool(record.get(key, False))]
    return tags


def _to_float(value: object) -> float | None:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if numeric != numeric:
        return None
    return numeric
