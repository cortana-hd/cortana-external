"""Outcome labeling utilities for realized trades and forward windows."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Iterable

import pandas as pd


@dataclass(frozen=True)
class OutcomeLabel:
    """Normalized outcome label for a realized trade."""

    label: str
    bucket: str
    holding_days: int


def label_trade_outcome(
    pnl_pct: float,
    exit_reason: str,
    holding_days: int,
    *,
    scratch_band_pct: float = 1.0,
    win_threshold_pct: float = 4.0,
    outsized_win_threshold_pct: float = 12.0,
) -> OutcomeLabel:
    """Map a realized trade into a reviewable outcome label."""
    holding_days = max(int(holding_days), 0)
    exit_reason = (exit_reason or "").lower()

    if exit_reason == "stop_loss":
        label = "quick_stop" if holding_days <= 3 else "stopped_out"
        return OutcomeLabel(label=label, bucket="loss", holding_days=holding_days)

    if pnl_pct >= outsized_win_threshold_pct:
        return OutcomeLabel(label="outsized_win", bucket="win", holding_days=holding_days)

    if pnl_pct >= win_threshold_pct:
        return OutcomeLabel(label="trend_win", bucket="win", holding_days=holding_days)

    if abs(pnl_pct) < scratch_band_pct:
        return OutcomeLabel(label="scratch", bucket="neutral", holding_days=holding_days)

    if pnl_pct > 0:
        return OutcomeLabel(label="small_win", bucket="win", holding_days=holding_days)

    label = "controlled_loss" if pnl_pct > -win_threshold_pct else "failed_trade"
    return OutcomeLabel(label=label, bucket="loss", holding_days=holding_days)


def annotate_trade_outcomes(trades: pd.DataFrame) -> pd.DataFrame:
    """Attach outcome labels to a trades dataframe."""
    if trades.empty:
        return trades.copy()

    annotated = trades.copy()
    if "holding_days" not in annotated.columns:
        holding_days = (
            pd.to_datetime(annotated["exit_date"]) - pd.to_datetime(annotated["entry_date"])
        ).dt.days.fillna(0)
        annotated["holding_days"] = holding_days.astype(int)

    outcomes = [
        label_trade_outcome(
            float(row.pnl_pct),
            str(row.exit_reason),
            int(row.holding_days),
        )
        for row in annotated.itertuples(index=False)
    ]
    annotated["outcome_label"] = [o.label for o in outcomes]
    annotated["outcome_bucket"] = [o.bucket for o in outcomes]
    return annotated


def summarize_outcomes(trades: pd.DataFrame) -> Dict[str, int]:
    """Return a flat summary of outcome labels for downstream reporting."""
    annotated = annotate_trade_outcomes(trades)
    if annotated.empty:
        return {}
    return annotated["outcome_label"].value_counts().sort_index().to_dict()


def summarize_forward_return_by_dimension(
    records: Iterable[Any],
    *,
    dimensions: Iterable[str],
    horizon_key: str = "5d",
    min_count: int = 1,
) -> Dict[str, Dict[str, Dict[str, float | int | None]]]:
    """Summarize forward-return hit rate and average return across categorical dimensions.

    This helper is used by paper/research paths to evaluate contextual overlays over time.
    It is intentionally read-only and does not participate in live trade authority.
    """
    summary: Dict[str, Dict[str, Dict[str, float | int | None]]] = {}
    for dimension in dimensions:
        buckets: Dict[str, dict[str, float | int]] = {}
        for record in records:
            bucket = _extract_value(record, dimension)
            bucket_key = str(bucket).strip().lower().replace(" ", "_") if bucket is not None else "unknown"
            if not bucket_key:
                bucket_key = "unknown"
            forward_returns = _extract_value(record, "forward_returns")
            if not isinstance(forward_returns, dict):
                continue
            value = forward_returns.get(horizon_key)
            state = buckets.setdefault(
                bucket_key,
                {"count": 0, "matured_count": 0, "hits": 0, "return_sum": 0.0},
            )
            state["count"] += 1
            if value is None:
                continue
            try:
                parsed = float(value)
            except Exception:
                continue
            state["matured_count"] += 1
            state["hits"] += 1 if parsed > 0 else 0
            state["return_sum"] += parsed

        bucket_summary: Dict[str, Dict[str, float | int | None]] = {}
        for bucket_key, state in sorted(buckets.items()):
            if int(state["count"]) < max(int(min_count), 1):
                continue
            matured_count = int(state["matured_count"])
            hit_rate = round(float(state["hits"]) / matured_count, 4) if matured_count else None
            avg_return = round(float(state["return_sum"]) / matured_count, 4) if matured_count else None
            bucket_summary[bucket_key] = {
                "count": int(state["count"]),
                "matured_count": matured_count,
                "hit_rate": hit_rate,
                "avg_return": avg_return,
            }

        if bucket_summary:
            summary[str(dimension)] = bucket_summary

    return summary


def _extract_value(record: Any, key: str) -> Any:
    if isinstance(record, dict):
        return record.get(key)
    return getattr(record, key, None)
