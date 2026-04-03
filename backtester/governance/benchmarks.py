"""Comparable-window benchmark ladder helpers for governance."""

from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Mapping

from evaluation.benchmark_models import build_benchmark_comparison_artifact
from evaluation.prediction_accuracy import default_prediction_root

DEFAULT_BENCHMARK_REGISTRY_PATH = Path(__file__).resolve().parent / "benchmark_registry.json"


class GovernanceBenchmarkError(ValueError):
    """Raised when benchmark inputs are not comparable."""


def load_benchmark_registry(path: str | Path | None = None) -> dict[str, Any]:
    target = Path(path or DEFAULT_BENCHMARK_REGISTRY_PATH).expanduser()
    payload = json.loads(target.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise GovernanceBenchmarkError("benchmark registry must be a JSON object")
    ladders = payload.get("benchmark_ladder") or []
    if not isinstance(ladders, list):
        raise GovernanceBenchmarkError("benchmark registry benchmark_ladder must be a list")
    return payload


def build_comparable_window_key(
    *,
    dataset: str,
    start_at: str,
    end_at: str,
    horizon_key: str,
    assumptions: Mapping[str, Any],
    point_in_time_label: str,
) -> str:
    canonical = json.dumps(
        {
            "dataset": dataset,
            "start_at": _normalize_timestamp(start_at),
            "end_at": _normalize_timestamp(end_at),
            "horizon_key": str(horizon_key or "").strip(),
            "assumptions": _canonical_mapping(assumptions),
            "point_in_time_label": str(point_in_time_label or "").strip().lower(),
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


def validate_comparable_inputs(
    *,
    candidate_window: Mapping[str, Any],
    benchmark_window: Mapping[str, Any],
) -> None:
    candidate_key = build_comparable_window_key(
        dataset=str(candidate_window.get("dataset") or "unknown"),
        start_at=str(candidate_window.get("start_at") or ""),
        end_at=str(candidate_window.get("end_at") or ""),
        horizon_key=str(candidate_window.get("horizon_key") or ""),
        assumptions=_canonical_mapping(candidate_window.get("assumptions") or {}),
        point_in_time_label=str(candidate_window.get("point_in_time_label") or ""),
    )
    benchmark_key = build_comparable_window_key(
        dataset=str(benchmark_window.get("dataset") or "unknown"),
        start_at=str(benchmark_window.get("start_at") or ""),
        end_at=str(benchmark_window.get("end_at") or ""),
        horizon_key=str(benchmark_window.get("horizon_key") or ""),
        assumptions=_canonical_mapping(benchmark_window.get("assumptions") or {}),
        point_in_time_label=str(benchmark_window.get("point_in_time_label") or ""),
    )
    if candidate_key != benchmark_key:
        raise GovernanceBenchmarkError("candidate and benchmark windows are not comparable")


def build_benchmark_ladder_artifact(
    *,
    experiment_key: str,
    benchmark_registry: Mapping[str, Any] | None = None,
    candidate_window: Mapping[str, Any],
    root: Path | None = None,
    source_artifact: Mapping[str, Any] | None = None,
    generated_at: str | None = None,
) -> dict[str, Any]:
    registry = dict(benchmark_registry or load_benchmark_registry())
    benchmark_summary = dict(
        source_artifact
        or build_benchmark_comparison_artifact(root=root or default_prediction_root(), horizon_key=str(candidate_window.get("horizon_key") or "5d"))
    )
    benchmark_window = {
        "dataset": str(candidate_window.get("dataset") or "prediction_accuracy"),
        "start_at": str(candidate_window.get("start_at") or ""),
        "end_at": str(candidate_window.get("end_at") or ""),
        "horizon_key": str(candidate_window.get("horizon_key") or "5d"),
        "assumptions": _canonical_mapping(candidate_window.get("assumptions") or {}),
        "point_in_time_label": str(candidate_window.get("point_in_time_label") or "strict"),
    }
    validate_comparable_inputs(candidate_window=candidate_window, benchmark_window=benchmark_window)
    comparable_window_key = build_comparable_window_key(**benchmark_window)
    generated = _normalize_timestamp(generated_at or datetime.now(UTC).isoformat())
    ladders = []
    for item in registry.get("benchmark_ladder") or []:
        if not isinstance(item, dict):
            continue
        benchmark_name = str(item.get("benchmark_name") or "").strip()
        source_key = str(item.get("source_key") or "").strip()
        rows = ((benchmark_summary.get("comparisons") or {}).get(source_key) or []) if source_key else []
        ladders.append(
            {
                "benchmark_name": benchmark_name,
                "source_key": source_key,
                "description": str(item.get("description") or "").strip(),
                "rows": deepcopy(rows),
                "assumptions": deepcopy(benchmark_window["assumptions"]),
                "comparable_window_key": comparable_window_key,
            }
        )
    return {
        "artifact_family": "benchmark_ladder_summary",
        "schema_version": 1,
        "experiment_key": str(experiment_key or "").strip().lower(),
        "generated_at": generated,
        "comparable_window": benchmark_window,
        "comparable_window_key": comparable_window_key,
        "benchmark_ladder": ladders,
        "lineage": {
            "source_artifact_family": str(benchmark_summary.get("artifact_family") or "benchmark_comparison_summary"),
            "source_generated_at": benchmark_summary.get("generated_at"),
            "registry_version": registry.get("schema_version"),
        },
    }


def _canonical_mapping(payload: Mapping[str, Any]) -> dict[str, Any]:
    return json.loads(json.dumps(dict(payload), sort_keys=True))


def _normalize_timestamp(value: object) -> str:
    text = str(value or "").strip()
    parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC).isoformat()
