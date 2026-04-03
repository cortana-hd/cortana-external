"""Helpers for building machine-readable runtime run manifests."""

from __future__ import annotations

import argparse
from collections.abc import Iterable
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
from typing import Any

from evaluation.artifact_contracts import (
    ARTIFACT_FAMILY_MARKET_BRIEF,
    ARTIFACT_FAMILY_RUN_MANIFEST,
    ARTIFACT_FAMILY_STRATEGY_ALERT,
    ARTIFACT_STATUS_DEGRADED,
    ARTIFACT_STATUS_ERROR,
    ARTIFACT_STATUS_OK,
    DEGRADED_STATUS_HEALTHY,
    DEGRADED_STATUS_RISKY,
    DEGRADED_STATUS_SAFE,
    annotate_artifact,
    validate_artifact_payload,
)

RUN_MANIFEST_OUTCOME_COMPLETED = "run_completed"
RUN_MANIFEST_OUTCOME_FAILED = "run_failed"

BACKTESTER_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKTESTER_ROOT.parent


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a machine-readable runtime run manifest.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    build = subparsers.add_parser("build", help="Build a run manifest from stage and artifact logs.")
    build.add_argument("--manifest-path", type=Path, required=True)
    build.add_argument("--producer", required=True)
    build.add_argument("--run-id", required=True)
    build.add_argument("--run-kind", required=True)
    build.add_argument("--started-at", required=True)
    build.add_argument("--finished-at", required=True)
    build.add_argument("--final-status", choices=("ok", "error"), required=True)
    build.add_argument("--stage-log", type=Path, required=True)
    build.add_argument("--artifact-log", type=Path, required=True)
    build.add_argument("--setting", action="append", default=[], help="Config setting in KEY=VALUE form.")
    return parser.parse_args()


def _read_tsv(path: Path, *, columns: int) -> list[list[str]]:
    if not path.exists():
        return []
    rows: list[list[str]] = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        if not raw_line.strip():
            continue
        parts = raw_line.split("\t")
        if len(parts) < columns:
            parts.extend([""] * (columns - len(parts)))
        rows.append(parts[:columns])
    return rows


def _parse_iso8601(value: str) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def _duration_seconds(started_at: str, finished_at: str) -> float | None:
    started = _parse_iso8601(started_at)
    finished = _parse_iso8601(finished_at)
    if started is None or finished is None:
        return None
    duration = (finished - started).total_seconds()
    return round(duration, 3) if duration >= 0 else None


def _git_head() -> str:
    try:
        return (
            subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=str(REPO_ROOT), stderr=subprocess.DEVNULL)
            .decode("utf-8")
            .strip()
        )
    except Exception:
        return "unknown"


def _parse_settings(items: Iterable[str]) -> dict[str, str]:
    settings: dict[str, str] = {}
    for item in items:
        key, _, value = str(item).partition("=")
        key = key.strip()
        if not key:
            continue
        settings[key] = value.strip()
    return settings


def _config_hash(settings: dict[str, str]) -> str:
    payload = json.dumps(settings, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()[:16]


def _load_json(path: Path) -> dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    return payload if isinstance(payload, dict) else None


def _stage_rows(stage_log: Path) -> list[dict[str, Any]]:
    stages: list[dict[str, Any]] = []
    for name, status, started_at, finished_at in _read_tsv(stage_log, columns=4):
        row: dict[str, Any] = {
            "name": name,
            "status": status or "unknown",
            "started_at": started_at,
            "finished_at": finished_at,
        }
        duration = _duration_seconds(started_at, finished_at)
        if duration is not None:
            row["duration_seconds"] = duration
        stages.append(row)
    return stages


def _artifact_rows(artifact_log: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str], str, str]:
    artifacts: list[dict[str, Any]] = []
    input_sources: list[dict[str, Any]] = []
    warnings: list[str] = []
    aggregate_status = ARTIFACT_STATUS_OK
    aggregate_degraded_status = DEGRADED_STATUS_HEALTHY

    for label, artifact_family, path_str in _read_tsv(artifact_log, columns=3):
        path = Path(path_str)
        item: dict[str, Any] = {
            "label": label,
            "artifact_family": artifact_family or "file",
            "path": path_str,
            "exists": path.exists(),
        }
        if not path.exists():
            warnings.append(f"missing_artifact:{label}")
            aggregate_status = ARTIFACT_STATUS_ERROR
            aggregate_degraded_status = DEGRADED_STATUS_RISKY
            artifacts.append(item)
            continue

        if path.suffix.lower() == ".json":
            payload = _load_json(path)
            if payload is not None:
                artifact_status = str(payload.get("status") or "").strip().lower()
                degraded_status = str(payload.get("degraded_status") or "").strip().lower()
                if artifact_status:
                    item["status"] = artifact_status
                if degraded_status:
                    item["degraded_status"] = degraded_status
                if payload.get("outcome_class"):
                    item["outcome_class"] = payload["outcome_class"]
                if payload.get("producer"):
                    item["producer"] = payload["producer"]

                if artifact_status == ARTIFACT_STATUS_ERROR:
                    aggregate_status = ARTIFACT_STATUS_ERROR
                    aggregate_degraded_status = DEGRADED_STATUS_RISKY
                elif aggregate_status != ARTIFACT_STATUS_ERROR and artifact_status == ARTIFACT_STATUS_DEGRADED:
                    aggregate_status = ARTIFACT_STATUS_DEGRADED
                    if degraded_status == DEGRADED_STATUS_RISKY:
                        aggregate_degraded_status = DEGRADED_STATUS_RISKY
                    elif aggregate_degraded_status == DEGRADED_STATUS_HEALTHY:
                        aggregate_degraded_status = DEGRADED_STATUS_SAFE

                if artifact_family == ARTIFACT_FAMILY_STRATEGY_ALERT:
                    source_counts = ((payload.get("inputs") or {}).get("source_counts") or {})
                    if source_counts:
                        input_sources.append(
                            {
                                "artifact": label,
                                "artifact_family": artifact_family,
                                "sources": source_counts,
                            }
                        )
                    analysis_error_count = int((payload.get("inputs") or {}).get("analysis_error_count", 0) or 0)
                    if analysis_error_count > 0:
                        warnings.append(f"analysis_errors:{label}:{analysis_error_count}")
                elif artifact_family == ARTIFACT_FAMILY_MARKET_BRIEF:
                    sources: dict[str, Any] = {}
                    tape_source = ((payload.get("tape") or {}).get("primary_source") or "").strip()
                    regime_source = ((payload.get("regime") or {}).get("data_source") or "").strip()
                    if tape_source:
                        sources["tape"] = tape_source
                    if regime_source:
                        sources["regime"] = regime_source
                    if sources:
                        input_sources.append(
                            {
                                "artifact": label,
                                "artifact_family": artifact_family,
                                "sources": sources,
                            }
                        )

                raw_warnings = payload.get("warnings")
                if isinstance(raw_warnings, list):
                    for warning in raw_warnings:
                        warning_text = str(warning).strip()
                        if warning_text:
                            warnings.append(f"{label}:{warning_text}")
        artifacts.append(item)

    return artifacts, input_sources, warnings, aggregate_status, aggregate_degraded_status


def build_run_manifest(
    *,
    run_id: str,
    run_kind: str,
    producer: str,
    started_at: str,
    finished_at: str,
    final_status: str,
    stage_log: Path,
    artifact_log: Path,
    settings: dict[str, str] | None = None,
) -> dict[str, Any]:
    settings = dict(settings or {})
    stages = _stage_rows(stage_log)
    artifacts, input_sources, warnings, artifact_status, artifact_degraded_status = _artifact_rows(artifact_log)

    status = ARTIFACT_STATUS_OK
    degraded_status = DEGRADED_STATUS_HEALTHY
    outcome_class = RUN_MANIFEST_OUTCOME_COMPLETED

    if str(final_status).strip().lower() == "error" or any(stage.get("status") == "error" for stage in stages):
        status = ARTIFACT_STATUS_ERROR
        degraded_status = DEGRADED_STATUS_RISKY
        outcome_class = RUN_MANIFEST_OUTCOME_FAILED
    elif artifact_status == ARTIFACT_STATUS_ERROR:
        status = ARTIFACT_STATUS_ERROR
        degraded_status = DEGRADED_STATUS_RISKY
        outcome_class = RUN_MANIFEST_OUTCOME_FAILED
    elif artifact_status == ARTIFACT_STATUS_DEGRADED:
        status = ARTIFACT_STATUS_DEGRADED
        degraded_status = artifact_degraded_status

    for stage in stages:
        if stage["status"] == "error":
            warnings.append(f"stage_failed:{stage['name']}")

    payload = annotate_artifact(
        {
            "run_id": run_id,
            "run_kind": run_kind,
            "started_at": started_at,
            "finished_at": finished_at,
            "code_version": _git_head(),
            "config_version": _config_hash(settings),
            "settings": settings,
            "input_sources": input_sources,
            "stages": stages,
            "artifacts": artifacts,
            "warnings": sorted(dict.fromkeys(warnings)),
        },
        artifact_family=ARTIFACT_FAMILY_RUN_MANIFEST,
        producer=producer,
        generated_at=finished_at,
        known_at=finished_at,
        status=status,
        degraded_status=degraded_status,
        outcome_class=outcome_class,
        freshness={"stage_count": len(stages), "artifact_count": len(artifacts)},
    )
    return validate_artifact_payload(payload, expected_family=ARTIFACT_FAMILY_RUN_MANIFEST)


def _write_manifest(args: argparse.Namespace) -> int:
    payload = build_run_manifest(
        run_id=args.run_id,
        run_kind=args.run_kind,
        producer=args.producer,
        started_at=args.started_at,
        finished_at=args.finished_at,
        final_status=args.final_status,
        stage_log=args.stage_log,
        artifact_log=args.artifact_log,
        settings=_parse_settings(args.setting),
    )
    args.manifest_path.parent.mkdir(parents=True, exist_ok=True)
    args.manifest_path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return 0


def main() -> None:
    args = _parse_args()
    if args.command == "build":
        raise SystemExit(_write_manifest(args))
    raise SystemExit(2)


if __name__ == "__main__":
    main()
