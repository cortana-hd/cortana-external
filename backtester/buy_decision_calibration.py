#!/usr/bin/env python3
"""Build an advisory buy-decision calibration artifact from settled research outcomes."""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from datetime import UTC, datetime
import math
from pathlib import Path
from typing import Any, Iterable, Optional, Sequence

from experimental_alpha import (
    build_calibration_report,
    default_alpha_root,
    load_settled_alpha,
)
from outcomes import summarize_forward_return_by_dimension

SCHEMA_VERSION = 1
DEFAULT_MAX_AGE_HOURS = 72.0
DEFAULT_MIN_BUCKET_COUNT = 2
DEFAULT_HORIZON = "5d"
DEFAULT_OUTPUT_NAME = "buy-decision-calibration-latest.json"
DIMENSION_CANDIDATES: tuple[str, ...] = (
    "market_regime",
    "risk_budget_state",
    "aggression_posture",
    "execution_quality",
    "liquidity_tier",
)


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build buy-decision calibration artifact")
    parser.add_argument("--alpha-root", type=str, help="Override experimental alpha root")
    parser.add_argument("--output-path", type=str, help="Override output artifact path")
    parser.add_argument("--minimum-samples", type=int, default=20, help="Minimum paper_long samples for gate context")
    parser.add_argument(
        "--min-bucket-count",
        type=int,
        default=DEFAULT_MIN_BUCKET_COUNT,
        help="Minimum records required to include a dimension bucket",
    )
    parser.add_argument(
        "--horizon",
        type=str,
        choices=["1d", "5d", "10d"],
        default=DEFAULT_HORIZON,
        help="Forward-return horizon for bucket summaries",
    )
    parser.add_argument(
        "--max-age-hours",
        type=float,
        default=DEFAULT_MAX_AGE_HOURS,
        help="Mark artifact stale when latest settled timestamp exceeds this age",
    )
    parser.add_argument("--json", action="store_true", help="Print artifact JSON to stdout")
    return parser.parse_args(argv)


def build_buy_decision_calibration_artifact(
    records: Sequence[Any],
    *,
    generated_at: Optional[datetime] = None,
    minimum_samples: int = 20,
    min_bucket_count: int = DEFAULT_MIN_BUCKET_COUNT,
    horizon: str = DEFAULT_HORIZON,
    max_age_hours: float = DEFAULT_MAX_AGE_HOURS,
    source_root: Optional[Path] = None,
) -> dict:
    now = _normalize_datetime(generated_at or datetime.now(UTC))
    calibration = build_calibration_report(
        records,
        generated_at=now,
        minimum_samples=minimum_samples,
    )
    dimensions = _available_dimensions(records, DIMENSION_CANDIDATES)
    by_dimension = summarize_forward_return_by_dimension(
        records,
        dimensions=dimensions,
        horizon_key=horizon,
        min_count=max(1, int(min_bucket_count)),
    )
    latest_settled_at = _latest_timestamp(records)
    freshness = _freshness_metadata(
        now=now,
        latest_settled_at=latest_settled_at,
        max_age_hours=max_age_hours,
    )

    return {
        "schema_version": SCHEMA_VERSION,
        "artifact_type": "buy_decision_calibration",
        "generated_at": now.isoformat(),
        "source": {
            "dataset": "experimental_alpha_settled",
            "alpha_root": str(source_root) if source_root else None,
            "record_count": len(records),
            "minimum_samples": int(minimum_samples),
            "min_bucket_count": max(1, int(min_bucket_count)),
            "horizon": horizon,
        },
        "freshness": freshness,
        "summary": {
            "settled_candidates": int(calibration.settled_candidates),
            "promotion_gate": asdict(calibration.gate),
            "action_bucket_count": len(calibration.by_action),
            "dimension_bucket_count": sum(len(items) for items in by_dimension.values()),
        },
        "calibration": {
            "by_action": [asdict(item) for item in calibration.by_action],
            "by_dimension": _format_dimension_slices(by_dimension),
        },
    }


def default_output_path(alpha_root: Path) -> Path:
    return alpha_root / "calibration" / DEFAULT_OUTPUT_NAME


def generate_buy_decision_calibration_artifact(
    *,
    alpha_root: Optional[Path] = None,
    output_path: Optional[Path] = None,
    minimum_samples: int = 20,
    min_bucket_count: int = DEFAULT_MIN_BUCKET_COUNT,
    horizon: str = DEFAULT_HORIZON,
    max_age_hours: float = DEFAULT_MAX_AGE_HOURS,
    generated_at: Optional[datetime] = None,
) -> tuple[dict, Path]:
    root = (alpha_root or default_alpha_root()).expanduser().resolve()
    records = load_settled_alpha(root)
    artifact = build_buy_decision_calibration_artifact(
        records,
        generated_at=generated_at,
        minimum_samples=minimum_samples,
        min_bucket_count=min_bucket_count,
        horizon=horizon,
        max_age_hours=max_age_hours,
        source_root=root,
    )
    destination = (output_path.expanduser().resolve() if output_path else default_output_path(root))
    _write_atomic_json(destination, artifact)
    return artifact, destination


def main(argv: Optional[list[str]] = None) -> None:
    args = parse_args(argv)
    artifact, path = generate_buy_decision_calibration_artifact(
        alpha_root=Path(args.alpha_root).expanduser() if args.alpha_root else None,
        output_path=Path(args.output_path).expanduser() if args.output_path else None,
        minimum_samples=args.minimum_samples,
        min_bucket_count=args.min_bucket_count,
        horizon=args.horizon,
        max_age_hours=args.max_age_hours,
    )
    if args.json:
        print(json.dumps(artifact, indent=2))
        return
    print(f"Buy decision calibration artifact written: {path}")
    print(
        "Freshness: "
        f"stale={artifact['freshness']['is_stale']} "
        f"(age_hours={artifact['freshness']['age_hours']}, max_age_hours={artifact['freshness']['max_age_hours']})"
    )


def _available_dimensions(records: Sequence[Any], candidates: Iterable[str]) -> list[str]:
    available: list[str] = []
    for dimension in candidates:
        if any(_has_signal_value(record, dimension) for record in records):
            available.append(dimension)
    return available


def _has_signal_value(record: Any, key: str) -> bool:
    value = _extract_value(record, key)
    if value is None:
        return False
    text = str(value).strip().lower()
    return bool(text) and text not in {"unknown", "n/a", "none"}


def _format_dimension_slices(payload: dict[str, dict[str, dict[str, float | int | None]]]) -> dict[str, list[dict[str, Any]]]:
    output: dict[str, list[dict[str, Any]]] = {}
    for dimension, buckets in payload.items():
        rows: list[dict[str, Any]] = []
        for bucket, metrics in buckets.items():
            rows.append(
                {
                    "bucket": bucket,
                    "count": int(metrics.get("count", 0) or 0),
                    "matured_count": int(metrics.get("matured_count", 0) or 0),
                    "hit_rate": _safe_float(metrics.get("hit_rate")),
                    "avg_return": _safe_float(metrics.get("avg_return")),
                }
            )
        output[dimension] = sorted(rows, key=lambda item: (-int(item["count"]), str(item["bucket"])))
    return output


def _latest_timestamp(records: Sequence[Any]) -> Optional[datetime]:
    timestamps: list[datetime] = []
    for record in records:
        for key in ("settled_at", "generated_at"):
            value = _extract_value(record, key)
            parsed = _parse_timestamp(value) if isinstance(value, str) else None
            if parsed is not None:
                timestamps.append(parsed)
                break
    if not timestamps:
        return None
    return max(timestamps)


def _freshness_metadata(*, now: datetime, latest_settled_at: Optional[datetime], max_age_hours: float) -> dict:
    safe_max_age = max(float(max_age_hours), 1.0)
    if latest_settled_at is None:
        return {
            "max_age_hours": safe_max_age,
            "latest_settled_at": None,
            "age_hours": None,
            "is_stale": True,
            "reason": "no_settled_records",
        }
    age_hours = round(max((now - latest_settled_at).total_seconds(), 0.0) / 3600.0, 3)
    is_stale = age_hours > safe_max_age
    return {
        "max_age_hours": safe_max_age,
        "latest_settled_at": latest_settled_at.isoformat(),
        "age_hours": age_hours,
        "is_stale": is_stale,
        "reason": "stale_settled_records" if is_stale else "fresh",
    }


def _normalize_datetime(value: datetime) -> datetime:
    return value.astimezone(UTC) if value.tzinfo else value.replace(tzinfo=UTC)


def _parse_timestamp(value: str) -> Optional[datetime]:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except Exception:
        return None
    return _normalize_datetime(parsed)


def _extract_value(record: Any, key: str) -> Any:
    if isinstance(record, dict):
        return record.get(key)
    return getattr(record, key, None)


def _safe_float(value: Any) -> Optional[float]:
    try:
        parsed = float(value)
    except Exception:
        return None
    if not math.isfinite(parsed):
        return None
    return round(parsed, 4)


def _write_atomic_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    tmp_path.replace(path)


if __name__ == "__main__":
    main()
