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


def test_build_run_manifest_aggregates_market_brief_and_readiness_artifacts(tmp_path):
    stage_log = tmp_path / "stages.tsv"
    artifact_log = tmp_path / "artifacts.tsv"
    brief_path = tmp_path / "market-brief.json"
    readiness_path = tmp_path / "pre-open-canary.json"

    _write_lines(
        stage_log,
        [
            "pre_open_canary\tdegraded\t2026-04-03T13:20:00Z\t2026-04-03T13:20:05Z",
            "market_brief_snapshot\tdegraded\t2026-04-03T13:20:05Z\t2026-04-03T13:20:08Z",
        ],
    )
    brief_path.write_text(
        json.dumps(
            {
                "artifact_family": "market_brief",
                "schema_version": 1,
                "producer": "backtester.market_brief_snapshot",
                "status": "degraded",
                "degraded_status": "degraded_safe",
                "generated_at": "2026-04-03T13:20:08Z",
                "known_at": "2026-04-03T13:20:08Z",
                "outcome_class": "degraded_safe",
                "session": {"phase": "PREMARKET", "is_regular_hours": False},
                "regime": {"display": "CORRECTION"},
                "posture": {"action": "NO_BUY"},
                "tape": {"primary_source": "cache"},
                "macro": {"state": "watch"},
                "intraday_breadth": {"override_state": "inactive"},
                "focus": {"symbols": ["OXY", "GEV", "FANG"]},
                "warnings": ["tape_previous_session_fallback"],
                "freshness": {"regime_snapshot_age_seconds": 1800.0, "tape_primary_source": "cache"},
            }
        )
        + "\n",
        encoding="utf-8",
    )
    readiness_path.write_text(
        json.dumps(
            {
                "artifact_family": "readiness_check",
                "schema_version": 1,
                "producer": "backtester.pre_open_canary",
                "status": "degraded",
                "degraded_status": "degraded_safe",
                "generated_at": "2026-04-03T13:20:05Z",
                "known_at": "2026-04-03T13:20:05Z",
                "outcome_class": "readiness_warn",
                "check_name": "pre_open_canary",
                "result": "warn",
                "ready_for_open": False,
                "checked_at": "2026-04-03T13:20:05Z",
                "checks": [{"name": "regime_path", "result": "warn", "evidence": {"reason": "cached_fallback"}}],
                "warnings": ["regime_path:warn"],
            }
        )
        + "\n",
        encoding="utf-8",
    )
    _write_lines(
        artifact_log,
        [
            f"market-brief-json\tmarket_brief\t{brief_path}",
            f"readiness-json\treadiness_check\t{readiness_path}",
        ],
    )

    payload = run_manifest.build_run_manifest(
        run_id="20260403-132000",
        run_kind="pre_open_readiness",
        producer="backtester.pre_open_canary",
        started_at="2026-04-03T13:20:00Z",
        finished_at="2026-04-03T13:20:08Z",
        final_status="ok",
        stage_log=stage_log,
        artifact_log=artifact_log,
        settings={},
    )

    assert payload["status"] == "degraded"
    assert payload["degraded_status"] == "degraded_safe"
    assert payload["outcome_class"] == "run_completed"
    assert {artifact["artifact_family"] for artifact in payload["artifacts"]} == {"market_brief", "readiness_check"}
    assert any("market-brief-json:tape_previous_session_fallback" == warning for warning in payload["warnings"])
    assert any("readiness-json:regime_path:warn" == warning for warning in payload["warnings"])
    assert payload["input_sources"] == [
        {
            "artifact": "market-brief-json",
            "artifact_family": "market_brief",
            "sources": {"tape": "cache"},
        }
    ]
