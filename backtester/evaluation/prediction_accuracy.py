"""Lightweight prediction logging + settlement for alert outputs."""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable, Optional

import pandas as pd

from data.market_data_provider import MarketDataError, MarketDataProvider
from evaluation.prediction_contract import (
    PREDICTION_CONTRACT_SCHEMA_VERSION,
    build_prediction_contract_records,
    serialize_prediction_contract_records,
)

DEFAULT_HORIZONS = (1, 5, 20)


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
) -> list[dict]:
    base = root or default_prediction_root()
    snapshots_dir = base / "snapshots"
    settled_dir = base / "settled"
    settled_dir.mkdir(parents=True, exist_ok=True)
    provider = provider or MarketDataProvider()
    current_time = now or datetime.now(timezone.utc)
    settled: list[dict] = []

    for path in sorted(snapshots_dir.glob("*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        generated_at = _parse_dt(payload.get("generated_at"))
        if generated_at is None:
            continue
        out_path = settled_dir / path.name
        records = payload.get("records") or []
        settled_records = []
        for record in records:
            symbol = str(record.get("symbol") or "").strip().upper()
            if not symbol:
                continue
            settlement = _settle_record(
                symbol=symbol,
                generated_at=generated_at,
                horizons=horizons,
                provider=provider,
                now=current_time,
            )
            settled_records.append({**record, **settlement})
        out_payload = {
            "strategy": payload.get("strategy"),
            "market_regime": payload.get("market_regime"),
            "generated_at": payload.get("generated_at"),
            "settled_at": current_time.isoformat(),
            "records": settled_records,
        }
        out_path.write_text(json.dumps(out_payload, indent=2), encoding="utf-8")
        settled.append(out_payload)
    return settled


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
            normalized["confidence_bucket"] = _confidence_bucket(record.get("confidence"))
            records.append(normalized)
            record_count += 1
            for horizon_key in horizon_status:
                if horizon_key in (record.get("forward_returns_pct") or {}):
                    horizon_status[horizon_key]["matured"] += 1
                elif horizon_key in set(record.get("pending_horizons") or []):
                    horizon_status[horizon_key]["pending"] += 1
                else:
                    horizon_status[horizon_key]["incomplete"] += 1

    artifact = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "snapshot_count": snapshot_count,
        "record_count": record_count,
        "horizon_status": horizon_status,
        "summary": _build_group_summary(records, group_fields=("strategy", "action")),
        "by_regime": _build_group_summary(records, group_fields=("strategy", "market_regime", "action")),
        "by_confidence_bucket": _build_group_summary(records, group_fields=("strategy", "confidence_bucket", "action")),
    }
    reports_dir = base / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    (reports_dir / "prediction-accuracy-latest.json").write_text(json.dumps(artifact, indent=2), encoding="utf-8")
    return artifact


def _settle_record(
    *,
    symbol: str,
    generated_at: datetime,
    horizons: tuple[int, ...],
    provider: MarketDataProvider,
    now: datetime,
) -> dict:
    try:
        history = provider.get_history(symbol, period="6mo").frame.copy()
    except MarketDataError as error:
        return {"settlement_error": str(error), "forward_returns_pct": {}}

    if history.empty:
        return {"settlement_error": "empty history", "forward_returns_pct": {}}

    history.index = pd.to_datetime(history.index, utc=True)
    anchor = history.loc[history.index >= generated_at]
    if anchor.empty:
        return {
            "settlement_error": "no anchor bar after prediction",
            "forward_returns_pct": {},
            "max_drawdown_pct": {},
            "max_runup_pct": {},
            "pending_horizons": [f"{horizon}d" for horizon in horizons],
        }

    anchor_close = float(anchor.iloc[0]["Close"])
    forward_returns = {}
    max_drawdown = {}
    max_runup = {}
    pending_horizons: list[str] = []
    for horizon in horizons:
        horizon_cutoff = generated_at + timedelta(days=horizon)
        horizon_key = f"{horizon}d"
        if now < horizon_cutoff:
            pending_horizons.append(horizon_key)
            continue
        future_rows = history.loc[history.index >= horizon_cutoff]
        if future_rows.empty:
            continue
        future_close = float(future_rows.iloc[0]["Close"])
        window_rows = history.loc[(history.index >= generated_at) & (history.index <= future_rows.index[0])]
        if anchor_close:
            forward_returns[horizon_key] = round(((future_close - anchor_close) / anchor_close) * 100.0, 3)
            if not window_rows.empty:
                lows = pd.to_numeric(window_rows["Close"], errors="coerce").dropna()
                highs = pd.to_numeric(window_rows["Close"], errors="coerce").dropna()
                if not lows.empty:
                    max_drawdown[horizon_key] = round(((float(lows.min()) - anchor_close) / anchor_close) * 100.0, 3)
                if not highs.empty:
                    max_runup[horizon_key] = round(((float(highs.max()) - anchor_close) / anchor_close) * 100.0, 3)
    return {
        "forward_returns_pct": forward_returns,
        "max_drawdown_pct": max_drawdown,
        "max_runup_pct": max_runup,
        "pending_horizons": pending_horizons,
    }


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


def _confidence_bucket(value: object) -> str:
    confidence = _to_float(value)
    if confidence is None:
        return "unknown"
    if confidence >= 75:
        return "high"
    if confidence >= 55:
        return "medium"
    if confidence >= 35:
        return "low"
    return "very_low"


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
