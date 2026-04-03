from __future__ import annotations

import json
from pathlib import Path

from evaluation import run_manifest


def _write_lines(path: Path, lines: list[str]) -> None:
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def test_build_run_manifest_aggregates_stage_and_artifact_truth(tmp_path):
    stage_log = tmp_path / "stages.tsv"
    artifact_log = tmp_path / "artifacts.tsv"
    strategy_path = tmp_path / "canslim-alert.json"
    text_path = tmp_path / "canslim-alert.txt"

    _write_lines(
        stage_log,
        [
            "market_data_preflight\tok\t2026-04-03T13:30:00Z\t2026-04-03T13:30:02Z",
            "canslim_alert\tok\t2026-04-03T13:30:02Z\t2026-04-03T13:30:05Z",
        ],
    )
    strategy_path.write_text(
        json.dumps(
            {
                "artifact_family": "strategy_alert",
                "schema_version": 1,
                "producer": "backtester.canslim_alert",
                "status": "degraded",
                "degraded_status": "degraded_safe",
                "generated_at": "2026-04-03T13:30:05Z",
                "known_at": "2026-04-03T13:30:05Z",
                "outcome_class": "healthy_no_candidates",
                "strategy": "canslim",
                "summary": {"scanned": 10},
                "signals": [],
                "inputs": {"source_counts": {"schwab": 8, "cache": 2}, "analysis_error_count": 0},
                "warnings": ["tape_previous_session_fallback"],
            }
        )
        + "\n",
        encoding="utf-8",
    )
    text_path.write_text("CANSLIM Scan\n", encoding="utf-8")
    _write_lines(
        artifact_log,
        [
            f"canslim-alert-json\tstrategy_alert\t{strategy_path}",
            f"canslim-alert-view\tfile\t{text_path}",
        ],
    )

    payload = run_manifest.build_run_manifest(
        run_id="20260403-133000",
        run_kind="daytime_flow",
        producer="backtester.daytime_flow",
        started_at="2026-04-03T13:30:00Z",
        finished_at="2026-04-03T13:30:10Z",
        final_status="ok",
        stage_log=stage_log,
        artifact_log=artifact_log,
        settings={"CANSLIM_LIMIT": "8"},
    )

    assert payload["artifact_family"] == "run_manifest"
    assert payload["status"] == "degraded"
    assert payload["degraded_status"] == "degraded_safe"
    assert payload["outcome_class"] == "run_completed"
    assert payload["run_kind"] == "daytime_flow"
    assert payload["input_sources"] == [
        {
            "artifact": "canslim-alert-json",
            "artifact_family": "strategy_alert",
            "sources": {"schwab": 8, "cache": 2},
        }
    ]
    assert payload["artifacts"][0]["label"] == "canslim-alert-json"
    assert payload["stages"][0]["duration_seconds"] == 2.0


def test_build_run_manifest_marks_missing_artifact_as_failed(tmp_path):
    stage_log = tmp_path / "stages.tsv"
    artifact_log = tmp_path / "artifacts.tsv"

    _write_lines(stage_log, ["nightly_discovery\tok\t2026-04-03T01:00:00Z\t2026-04-03T01:00:30Z"])
    _write_lines(artifact_log, [f"nightly-discovery-view\tfile\t{tmp_path / 'missing.txt'}"])

    payload = run_manifest.build_run_manifest(
        run_id="20260403-010000",
        run_kind="nighttime_flow",
        producer="backtester.nighttime_flow",
        started_at="2026-04-03T01:00:00Z",
        finished_at="2026-04-03T01:00:31Z",
        final_status="ok",
        stage_log=stage_log,
        artifact_log=artifact_log,
        settings={},
    )

    assert payload["status"] == "error"
    assert payload["degraded_status"] == "degraded_risky"
    assert payload["outcome_class"] == "run_failed"
    assert "missing_artifact:nightly-discovery-view" in payload["warnings"]
