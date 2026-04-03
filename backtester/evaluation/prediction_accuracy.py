"""Lightweight prediction logging + settlement for alert outputs."""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable, Optional

import pandas as pd
import requests

from data.confidence import stable_confidence_bucket
from data.market_data_provider import MarketDataError, MarketDataProvider
from evaluation.prediction_contract import (
    PREDICTION_CONTRACT_SCHEMA_VERSION,
    build_prediction_contract_records,
    serialize_prediction_contract_records,
)
from outcomes import (
    SETTLEMENT_ARTIFACT_SCHEMA_VERSION,
    build_action_aware_validation_grades,
    build_forward_settlement_snapshot,
)

DEFAULT_HORIZONS = (1, 5, 20)
ROLLING_SAMPLE_WINDOWS = (20, 50, 100)
DEFAULT_SETTLEMENT_BATCH_SIZE = 200


def default_prediction_root() -> Path:
    return Path(__file__).resolve().parents[1] / ".cache" / "prediction_accuracy"


def persist_prediction_snapshot(
    *,
    strategy: str,
    market_regime: str,
    records: Iterable[dict],
    root: Optional[Path] = None,
    generated_at: Optional[datetime] = None,
    producer: str | None = None,
) -> Path | None:
    now = generated_at or datetime.now(timezone.utc)
    normalized = build_prediction_contract_records(
        strategy=strategy,
        market_regime=market_regime,
        records=records,
        generated_at=now,
        producer=producer,
    )
    if not normalized:
        return None

    payload = {
        "schema_version": PREDICTION_CONTRACT_SCHEMA_VERSION,
        "strategy": strategy,
        "market_regime": market_regime,
        "generated_at": now.isoformat(),
        "records": serialize_prediction_contract_records(normalized),
    }
    out_dir = (root or default_prediction_root()) / "snapshots"
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{now.strftime('%Y%m%d-%H%M%S-%f')}-{strategy}.json"
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return path


def settle_prediction_snapshots(
    *,
    root: Optional[Path] = None,
    horizons: tuple[int, ...] = DEFAULT_HORIZONS,
    provider: Optional[MarketDataProvider] = None,
    now: Optional[datetime] = None,
    max_snapshots_per_run: int = DEFAULT_SETTLEMENT_BATCH_SIZE,
) -> list[dict]:
    base = root or default_prediction_root()
    snapshots_dir = base / "snapshots"
    settled_dir = base / "settled"
    settled_dir.mkdir(parents=True, exist_ok=True)
    provider = provider or MarketDataProvider()
    current_time = now or datetime.now(timezone.utc)
    settled: list[dict] = []
    should_attempt_live_settlement = _market_data_available_for_settlement(provider)
    processed = 0

    for path in sorted(snapshots_dir.glob("*.json"), reverse=True):
        payload = json.loads(path.read_text(encoding="utf-8"))
        generated_at = _parse_dt(payload.get("generated_at"))
        if generated_at is None:
            continue
        out_path = settled_dir / path.name
        existing_payload = _load_existing_settlement(out_path)
        if _settlement_complete(existing_payload):
            continue
        if not should_attempt_live_settlement:
            if existing_payload is not None:
                settled.append(existing_payload)
            continue
        if max_snapshots_per_run > 0 and processed >= max_snapshots_per_run:
            if existing_payload is not None:
                settled.append(existing_payload)
            continue
        records = payload.get("records") or []
        settled_records = []
        for record in records:
            symbol = str(record.get("symbol") or "").strip().upper()
            if not symbol:
                continue
            settlement = _settle_record(
                symbol=symbol,
                record=record,
                generated_at=generated_at,
                horizons=horizons,
                provider=provider,
                now=current_time,
            )
            settled_records.append({**record, **settlement})
        settlement_summary = _build_settlement_summary(settled_records)
        out_payload = {
            "schema_version": SETTLEMENT_ARTIFACT_SCHEMA_VERSION,
            "artifact_family": "prediction_settlement",
            "strategy": payload.get("strategy"),
            "market_regime": payload.get("market_regime"),
            "generated_at": payload.get("generated_at"),
            "settled_at": current_time.isoformat(),
            "settlement_horizons": [f"{horizon}d" for horizon in horizons],
            "record_count": len(settled_records),
            "settlement_summary": settlement_summary,
            "records": settled_records,
        }
        out_path.write_text(json.dumps(out_payload, indent=2), encoding="utf-8")
        settled.append(out_payload)
        processed += 1
    return settled


def _market_data_available_for_settlement(provider: MarketDataProvider) -> bool:
    service_base_url = str(getattr(provider, "service_base_url", "") or "").rstrip("/")
    if not service_base_url:
        return True
    try:
        response = requests.get(f"{service_base_url}/market-data/ready", timeout=3)
        response.raise_for_status()
        payload = response.json() or {}
    except Exception:
        return False
    data = payload.get("data") if isinstance(payload, dict) else {}
    operator_state = str((data or {}).get("operatorState") or "").strip().lower()
    if operator_state in {"provider_cooldown", "human_action_required"}:
        return False
    return bool((data or {}).get("ready", True))


def _load_existing_settlement(path: Path) -> dict | None:
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    return payload if isinstance(payload, dict) else None


def _settlement_complete(payload: dict | None) -> bool:
    if not payload:
        return False
    records = payload.get("records") or []
    if not isinstance(records, list) or not records:
        return False
    for record in records:
        if not isinstance(record, dict):
            return False
        if record.get("pending_horizons") or record.get("incomplete_horizons"):
            return False
    return True


def build_prediction_accuracy_summary(root: Optional[Path] = None) -> dict:
    base = root or default_prediction_root()
    settled_dir = base / "settled"
    snapshot_count = 0
    record_count = 0
    records: list[dict] = []
    horizon_status: dict[str, dict[str, int]] = {
        f"{horizon}d": {"matured": 0, "pending": 0, "incomplete": 0}
        for horizon in DEFAULT_HORIZONS
    }
    for path in sorted(settled_dir.glob("*.json")):
        snapshot_count += 1
        payload = json.loads(path.read_text(encoding="utf-8"))
        strategy = str(payload.get("strategy") or "unknown")
        market_regime = str(payload.get("market_regime") or "unknown")
        for record in payload.get("records") or []:
            normalized = dict(record)
            normalized["strategy"] = strategy
            normalized["market_regime"] = str(record.get("market_regime") or market_regime)
            normalized["action"] = str(record.get("action") or "UNKNOWN").upper()
            normalized["confidence_bucket"] = stable_confidence_bucket(record.get("confidence"))
            records.append(normalized)
            record_count += 1
            for horizon_key in horizon_status:
                if horizon_key in (record.get("forward_returns_pct") or {}):
                    horizon_status[horizon_key]["matured"] += 1
                elif horizon_key in set(record.get("pending_horizons") or []):
                    horizon_status[horizon_key]["pending"] += 1
                else:
                    horizon_status[horizon_key]["incomplete"] += 1

    records.sort(key=_record_sort_key)
    by_strategy = _build_group_summary(records, group_fields=("strategy",))
    by_action = _build_group_summary(records, group_fields=("action",))
    by_strategy_action = _build_group_summary(records, group_fields=("strategy", "action"))
    by_regime = _build_group_summary(records, group_fields=("strategy", "market_regime", "action"))
    by_confidence_bucket = _build_group_summary(records, group_fields=("strategy", "confidence_bucket", "action"))

    artifact = {
        "schema_version": SETTLEMENT_ARTIFACT_SCHEMA_VERSION,
        "artifact_family": "prediction_accuracy_summary",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "snapshot_count": snapshot_count,
        "record_count": record_count,
        "settlement_horizons": [f"{horizon}d" for horizon in DEFAULT_HORIZONS],
        "rolling_window_sizes": list(ROLLING_SAMPLE_WINDOWS),
        "horizon_status": horizon_status,
        "settlement_status_counts": _count_record_field(records, "settlement_status"),
        "maturity_state_counts": _count_record_field(records, "settlement_maturity_state"),
        "validation_grade_counts": {
            "signal_validation_grade": _count_record_field(records, "signal_validation_grade"),
            "entry_validation_grade": _count_record_field(records, "entry_validation_grade"),
            "execution_validation_grade": _count_record_field(records, "execution_validation_grade"),
            "trade_validation_grade": _count_record_field(records, "trade_validation_grade"),
        },
        "summary": by_strategy_action,
        "by_strategy": by_strategy,
        "by_action": by_action,
        "by_strategy_action": by_strategy_action,
        "by_regime": by_regime,
        "by_confidence_bucket": by_confidence_bucket,
        "rolling_summary": _build_rolling_summary(records),
    }
    reports_dir = base / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    (reports_dir / "prediction-accuracy-latest.json").write_text(json.dumps(artifact, indent=2), encoding="utf-8")
    return artifact


def _settle_record(
    *,
    symbol: str,
    record: dict,
    generated_at: datetime,
    horizons: tuple[int, ...],
    provider: MarketDataProvider,
    now: datetime,
) -> dict:
    try:
        history = provider.get_history(symbol, period="6mo").frame.copy()
    except MarketDataError as error:
        horizon_keys = [f"{horizon}d" for horizon in horizons]
        return {
            "settlement_schema_version": SETTLEMENT_ARTIFACT_SCHEMA_VERSION,
            "settlement_status": "insufficient_data",
            "settlement_maturity_state": "incomplete",
            "settlement_error": str(error),
            "anchor_timestamp": None,
            "anchor_close": None,
            "forward_returns_pct": {},
            "max_adverse_excursion_pct": {},
            "max_favorable_excursion_pct": {},
            "max_drawdown_pct": {},
            "max_runup_pct": {},
            "matured_horizons": [],
            "pending_horizons": [],
            "incomplete_horizons": horizon_keys,
            "pending_coverage_pct": 0.0,
            "matured_coverage_pct": 0.0,
            "incomplete_coverage_pct": 1.0,
        }

    if history.empty:
        horizon_keys = [f"{horizon}d" for horizon in horizons]
        return {
            "settlement_schema_version": SETTLEMENT_ARTIFACT_SCHEMA_VERSION,
            "settlement_status": "insufficient_data",
            "settlement_maturity_state": "incomplete",
            "settlement_error": "empty history",
            "anchor_timestamp": None,
            "anchor_close": None,
            "forward_returns_pct": {},
            "max_adverse_excursion_pct": {},
            "max_favorable_excursion_pct": {},
            "max_drawdown_pct": {},
            "max_runup_pct": {},
            "matured_horizons": [],
            "pending_horizons": [],
            "incomplete_horizons": horizon_keys,
            "pending_coverage_pct": 0.0,
            "matured_coverage_pct": 0.0,
            "incomplete_coverage_pct": 1.0,
        }
    settlement = build_forward_settlement_snapshot(
        history=history,
        generated_at=generated_at,
        horizons=horizons,
        now=now,
    )
    enriched_validation = {**settlement}
    grades = build_action_aware_validation_grades(
        action=str(record.get("action") or "UNKNOWN"),
        forward_returns_pct=dict(settlement.get("forward_returns_pct") or {}),
        max_adverse_excursion_pct=dict(settlement.get("max_adverse_excursion_pct") or {}),
        max_favorable_excursion_pct=dict(settlement.get("max_favorable_excursion_pct") or {}),
        execution_policy_ref=record.get("execution_policy_ref"),
    )
    enriched_validation.update(grades)
    return enriched_validation


def _to_float(value: object) -> float | None:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if numeric != numeric:
        return None
    return numeric


def _parse_dt(value: object) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _build_settlement_summary(records: list[dict]) -> dict:
    status_counts: dict[str, int] = defaultdict(int)
    maturity_counts: dict[str, int] = defaultdict(int)
    validation_grade_counts: dict[str, dict[str, int]] = {
        "signal_validation_grade": defaultdict(int),
        "entry_validation_grade": defaultdict(int),
        "execution_validation_grade": defaultdict(int),
        "trade_validation_grade": defaultdict(int),
    }
    for record in records:
        status_counts[str(record.get("settlement_status") or "unknown")] += 1
        maturity_counts[str(record.get("settlement_maturity_state") or "unknown")] += 1
        for key in validation_grade_counts:
            validation_grade_counts[key][str(record.get(key) or "unknown")] += 1
    return {
        "status_counts": dict(status_counts),
        "maturity_state_counts": dict(maturity_counts),
        "validation_grade_counts": {
            key: dict(value) for key, value in validation_grade_counts.items()
        },
    }


def _count_record_field(records: list[dict], key: str) -> dict[str, int]:
    counts: dict[str, int] = defaultdict(int)
    for record in records:
        counts[str(record.get(key) or "unknown")] += 1
    return dict(counts)


def _decision_success(action: str, forward_return_pct: float) -> bool:
    normalized = str(action or "UNKNOWN").upper()
    if normalized == "NO_BUY":
        return forward_return_pct <= 0
    return forward_return_pct > 0


def _decision_accuracy_label(action: str) -> str:
    normalized = str(action or "UNKNOWN").upper()
    if normalized == "NO_BUY":
        return "avoidance_rate"
    if normalized == "WATCH":
        return "watch_success_rate"
    return "buy_success_rate"


def _record_sort_key(record: dict) -> tuple[datetime, str, str]:
    predicted_at = _parse_dt(record.get("predicted_at")) or _parse_dt(record.get("generated_at"))
    return (
        predicted_at or datetime.min.replace(tzinfo=timezone.utc),
        str(record.get("strategy") or ""),
        str(record.get("symbol") or ""),
    )


def _build_rolling_summary(records: list[dict]) -> dict[str, dict]:
    payload: dict[str, dict] = {}
    for window_size in ROLLING_SAMPLE_WINDOWS:
        window_records = records[-window_size:]
        payload[str(window_size)] = {
            "requested_window": window_size,
            "records_considered": len(window_records),
            "is_partial_window": len(window_records) < window_size,
            "by_strategy": _build_group_summary(window_records, group_fields=("strategy",)),
            "by_action": _build_group_summary(window_records, group_fields=("action",)),
            "summary": _build_group_summary(window_records, group_fields=("strategy", "action")),
            "by_regime": _build_group_summary(window_records, group_fields=("strategy", "market_regime", "action")),
            "by_confidence_bucket": _build_group_summary(
                window_records,
                group_fields=("strategy", "confidence_bucket", "action"),
            ),
        }
    return payload


def _build_group_summary(records: list[dict], *, group_fields: tuple[str, ...]) -> list[dict]:
    buckets: dict[tuple[str, ...], dict[str, dict[str, list[float] | int | str]]] = defaultdict(dict)

    for record in records:
        group_key = tuple(str(record.get(field) or "unknown") for field in group_fields)
        action = str(record.get("action") or "UNKNOWN").upper()
        returns = record.get("forward_returns_pct") or {}
        drawdowns = record.get("max_drawdown_pct") or {}
        runups = record.get("max_runup_pct") or {}
        for horizon_key, value in returns.items():
            if not isinstance(value, (int, float)):
                continue
            bucket = buckets[group_key].setdefault(
                horizon_key,
                {
                    "returns": [],
                    "drawdowns": [],
                    "runups": [],
                    "decision_hits": 0,
                    "action": action,
                },
            )
            bucket["returns"].append(float(value))
            drawdown = drawdowns.get(horizon_key)
            if isinstance(drawdown, (int, float)):
                bucket["drawdowns"].append(float(drawdown))
            runup = runups.get(horizon_key)
            if isinstance(runup, (int, float)):
                bucket["runups"].append(float(runup))
            if _decision_success(action, float(value)):
                bucket["decision_hits"] += 1

    rows: list[dict] = []
    for key, series in sorted(buckets.items()):
        row = {field: value for field, value in zip(group_fields, key)}
        for horizon_key, metrics in sorted(series.items()):
            values = metrics.get("returns") or []
            if not values:
                continue
            avg_return = sum(values) / len(values)
            sorted_values = sorted(values)
            midpoint = len(sorted_values) // 2
            if len(sorted_values) % 2 == 0:
                median_return = (sorted_values[midpoint - 1] + sorted_values[midpoint]) / 2
            else:
                median_return = sorted_values[midpoint]
            action = str(metrics.get("action") or row.get("action") or "UNKNOWN").upper()
            drawdowns = metrics.get("drawdowns") or []
            runups = metrics.get("runups") or []
            row[horizon_key] = {
                "samples": len(values),
                "avg_return_pct": round(avg_return, 3),
                "median_return_pct": round(median_return, 3),
                "hit_rate": round(sum(1 for value in values if value > 0) / len(values), 3),
                "decision_accuracy": round(int(metrics.get("decision_hits", 0)) / len(values), 3),
                "decision_accuracy_label": _decision_accuracy_label(action),
                "avg_max_drawdown_pct": round(sum(drawdowns) / len(drawdowns), 3) if drawdowns else None,
                "avg_max_runup_pct": round(sum(runups) / len(runups), 3) if runups else None,
            }
        rows.append(row)
    return rows
