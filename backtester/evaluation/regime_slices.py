"""Regime-aware summary helpers for Backtester V2 strategy evaluation."""

from __future__ import annotations

from collections import defaultdict
from typing import Iterable, Mapping


def build_regime_slice_summary(records: Iterable[Mapping[str, object]]) -> list[dict]:
    grouped: dict[str, list[Mapping[str, object]]] = defaultdict(list)
    for record in records:
        regime = str(record.get("market_regime") or record.get("regime_label") or "unknown")
        grouped[regime].append(record)

    summaries: list[dict] = []
    for regime, regime_records in sorted(grouped.items()):
        sample_depth = len(regime_records)
        mean_return = _mean(
            _first_available_number(record, "validation_return_pct", "forward_return_5d_pct", "return_5d")
            for record in regime_records
        )
        hit_rate = _rate(
            _first_available_number(record, "validation_return_pct", "forward_return_5d_pct", "return_5d") > 0
            for record in regime_records
        )
        summaries.append(
            {
                "regime_label": regime,
                "sample_depth": sample_depth,
                "avg_return_pct": round(mean_return, 4),
                "hit_rate": round(hit_rate, 4),
            }
        )
    return summaries


def _first_available_number(record: Mapping[str, object], *keys: str) -> float:
    for key in keys:
        value = record.get(key)
        try:
            if value is None:
                continue
            return float(value)
        except (TypeError, ValueError):
            continue
    return 0.0


def _mean(values: Iterable[float]) -> float:
    items = list(values)
    if not items:
        return 0.0
    return sum(items) / len(items)


def _rate(flags: Iterable[bool]) -> float:
    items = list(flags)
    if not items:
        return 0.0
    return sum(1 for item in items if item) / len(items)

