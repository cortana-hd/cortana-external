"""Deterministic walk-forward and robustness summaries for governance."""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import UTC, datetime
from statistics import median
from typing import Any, Iterable, Mapping


def build_walk_forward_summary(
    *,
    experiment_key: str,
    records: Iterable[Mapping[str, Any]],
    horizon_key: str = "5d",
    train_size: int = 30,
    validation_size: int = 15,
    test_size: int = 15,
    worse_fill_bps: int = 10,
    hold_windows: tuple[str, ...] = ("1d", "5d", "20d"),
    generated_at: str | None = None,
) -> dict[str, Any]:
    ordered = sorted((_normalize_record(record) for record in records), key=lambda item: item["generated_at"])
    windows = _build_windows(
        ordered,
        train_size=train_size,
        validation_size=validation_size,
        test_size=test_size,
        horizon_key=horizon_key,
        worse_fill_bps=worse_fill_bps,
    )
    regime_segment_summary = _build_regime_segments(ordered, horizon_key=horizon_key)
    parameter_stability_summary = _build_parameter_stability(ordered, horizon_key=horizon_key)
    stress_test_summary = _build_stress_summary(
        ordered,
        horizon_key=horizon_key,
        worse_fill_bps=worse_fill_bps,
        hold_windows=hold_windows,
    )
    pass_fail_summary = _build_walk_forward_gate_summary(
        windows=windows,
        regime_segment_summary=regime_segment_summary,
        parameter_stability_summary=parameter_stability_summary,
        stress_test_summary=stress_test_summary,
    )
    return {
        "artifact_family": "walk_forward_summary",
        "schema_version": 1,
        "experiment_key": str(experiment_key or "").strip().lower(),
        "generated_at": _normalize_timestamp(generated_at or datetime.now(UTC).isoformat()),
        "window_definition": {
            "train_size": int(train_size),
            "validation_size": int(validation_size),
            "test_size": int(test_size),
            "horizon_key": horizon_key,
            "worse_fill_bps": int(worse_fill_bps),
        },
        "window_results": windows,
        "regime_segment_summary": regime_segment_summary,
        "parameter_stability_summary": parameter_stability_summary,
        "stress_test_summary": stress_test_summary,
        "pass_fail_summary": pass_fail_summary,
    }


def _build_windows(
    records: list[dict[str, Any]],
    *,
    train_size: int,
    validation_size: int,
    test_size: int,
    horizon_key: str,
    worse_fill_bps: int,
) -> list[dict[str, Any]]:
    total_window = train_size + validation_size + test_size
    if len(records) < total_window:
        return []
    rows: list[dict[str, Any]] = []
    step = max(test_size, 1)
    for start in range(0, len(records) - total_window + 1, step):
        train = records[start:start + train_size]
        validation = records[start + train_size:start + train_size + validation_size]
        test = records[start + train_size + validation_size:start + total_window]
        rows.append(
            {
                "window_index": len(rows) + 1,
                "train": _window_slice_summary(train, horizon_key=horizon_key),
                "validation": _window_slice_summary(validation, horizon_key=horizon_key),
                "out_of_sample": _window_slice_summary(test, horizon_key=horizon_key),
                "worse_fill_out_of_sample": _window_slice_summary(test, horizon_key=horizon_key, worse_fill_bps=worse_fill_bps),
            }
        )
    return rows


def _window_slice_summary(records: list[dict[str, Any]], *, horizon_key: str, worse_fill_bps: int = 0) -> dict[str, Any]:
    values = []
    for record in records:
        value = _return_value(record, horizon_key)
        if value is None:
            continue
        adjusted = value - (worse_fill_bps / 100.0 if worse_fill_bps else 0.0)
        values.append(adjusted)
    return {
        "count": len(records),
        "matured_count": len(values),
        "mean_return_pct": _avg(values),
        "median_return_pct": _median(values),
        "hit_rate": _ratio(sum(1 for value in values if value > 0.0), len(values)),
    }


def _build_regime_segments(records: list[dict[str, Any]], *, horizon_key: str) -> dict[str, Any]:
    buckets: dict[str, list[float]] = defaultdict(list)
    for record in records:
        regime = str(record.get("market_regime") or "unknown").strip().lower()
        value = _return_value(record, horizon_key)
        if value is not None:
            buckets[regime].append(value)
    by_regime = []
    for regime, values in sorted(buckets.items()):
        by_regime.append(
            {
                "market_regime": regime,
                "count": len(values),
                "mean_return_pct": _avg(values),
                "hit_rate": _ratio(sum(1 for value in values if value > 0.0), len(values)),
            }
        )
    return {
        "regime_count": len(by_regime),
        "by_regime": by_regime,
    }


def _build_parameter_stability(records: list[dict[str, Any]], *, horizon_key: str) -> dict[str, Any]:
    buckets: dict[str, list[float]] = defaultdict(list)
    for record in records:
        params = record.get("parameter_set")
        if not isinstance(params, Mapping):
            continue
        key = _stable_params_key(params)
        value = _return_value(record, horizon_key)
        if value is not None:
            buckets[key].append(value)
    by_parameter = []
    for key, values in sorted(buckets.items()):
        by_parameter.append(
            {
                "parameter_set_key": key,
                "count": len(values),
                "mean_return_pct": _avg(values),
                "median_return_pct": _median(values),
                "fragile": bool(len(values) < 3 or (_avg(values) or 0.0) < 0.0),
            }
        )
    fragile_count = sum(1 for row in by_parameter if row["fragile"])
    return {
        "parameter_set_count": len(by_parameter),
        "fragile_parameter_count": fragile_count,
        "by_parameter_set": by_parameter,
    }


def _build_stress_summary(
    records: list[dict[str, Any]],
    *,
    horizon_key: str,
    worse_fill_bps: int,
    hold_windows: tuple[str, ...],
) -> dict[str, Any]:
    base_values = [value for value in (_return_value(record, horizon_key) for record in records) if value is not None]
    worse_fill_values = [value - (worse_fill_bps / 100.0) for value in base_values]
    hold_window_summary = {}
    for hold_window in hold_windows:
        values = [value for value in (_return_value(record, hold_window) for record in records) if value is not None]
        hold_window_summary[hold_window] = {
            "matured_count": len(values),
            "mean_return_pct": _avg(values),
            "hit_rate": _ratio(sum(1 for value in values if value > 0.0), len(values)),
        }
    return {
        "base_mean_return_pct": _avg(base_values),
        "worse_fill_mean_return_pct": _avg(worse_fill_values),
        "worse_fill_drawdown_delta_pct": round((_avg(base_values) or 0.0) - (_avg(worse_fill_values) or 0.0), 4),
        "hold_window_summary": hold_window_summary,
    }


def _build_walk_forward_gate_summary(
    *,
    windows: list[dict[str, Any]],
    regime_segment_summary: dict[str, Any],
    parameter_stability_summary: dict[str, Any],
    stress_test_summary: dict[str, Any],
) -> dict[str, Any]:
    reasons: list[str] = []
    if len(windows) < 2:
        reasons.append("insufficient walk-forward windows")
    non_negative_oos = sum(
        1
        for row in windows
        if float((row.get("out_of_sample") or {}).get("mean_return_pct") or 0.0) >= 0.0
    )
    if windows and non_negative_oos < max(1, len(windows) // 2):
        reasons.append("out-of-sample windows are too weak")
    if int(regime_segment_summary.get("regime_count", 0) or 0) < 2:
        reasons.append("single-regime evidence only")
    if int(parameter_stability_summary.get("fragile_parameter_count", 0) or 0) > 0:
        reasons.append("fragile parameter sets detected")
    if float(stress_test_summary.get("worse_fill_drawdown_delta_pct") or 0.0) > 1.5:
        reasons.append("worse-fill sensitivity too high")
    return {
        "passed": not reasons,
        "reasons": reasons,
        "window_count": len(windows),
        "non_negative_out_of_sample_windows": non_negative_oos,
    }


def _normalize_record(record: Mapping[str, Any]) -> dict[str, Any]:
    return {
        **dict(record),
        "generated_at": _normalize_timestamp(record.get("generated_at") or record.get("known_at") or datetime.now(UTC).isoformat()),
    }


def _return_value(record: Mapping[str, Any], horizon_key: str) -> float | None:
    payload = record.get("forward_returns_pct") or record.get("forward_returns") or {}
    if not isinstance(payload, Mapping):
        return None
    value = payload.get(horizon_key)
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _stable_params_key(payload: Mapping[str, Any]) -> str:
    parts = [f"{key}={payload[key]}" for key in sorted(payload.keys())]
    return "|".join(parts)


def _normalize_timestamp(value: object) -> str:
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC).isoformat()


def _avg(values: list[float]) -> float | None:
    if not values:
        return None
    return round(sum(values) / len(values), 4)


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    return round(float(median(values)), 4)


def _ratio(numerator: int, denominator: int) -> float | None:
    if denominator <= 0:
        return None
    return round(float(numerator) / float(denominator), 4)
