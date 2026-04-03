from __future__ import annotations

import json
from pathlib import Path

from evaluation.artifact_contracts import (
    ARTIFACT_FAMILY_MARKET_BRIEF,
    ARTIFACT_FAMILY_READINESS_CHECK,
    ARTIFACT_FAMILY_RUN_MANIFEST,
    ARTIFACT_FAMILY_STRATEGY_ALERT,
    validate_artifact_payload,
)

FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures" / "consumer_contracts"

EXPECTED_CASES = {
    "market-brief-market-gate-blocked.json": {
        "artifact_family": ARTIFACT_FAMILY_MARKET_BRIEF,
        "status": "ok",
        "outcome_class": "market_gate_blocked",
        "degraded_status": "healthy",
    },
    "market-brief-degraded-safe.json": {
        "artifact_family": ARTIFACT_FAMILY_MARKET_BRIEF,
        "status": "degraded",
        "outcome_class": "degraded_safe",
        "degraded_status": "degraded_safe",
    },
    "market-brief-degraded-risky.json": {
        "artifact_family": ARTIFACT_FAMILY_MARKET_BRIEF,
        "status": "error",
        "outcome_class": "degraded_risky",
        "degraded_status": "degraded_risky",
    },
    "strategy-alert-canslim-healthy-candidates-found.json": {
        "artifact_family": ARTIFACT_FAMILY_STRATEGY_ALERT,
        "status": "ok",
        "outcome_class": "healthy_candidates_found",
        "degraded_status": "healthy",
    },
    "strategy-alert-canslim-analysis-failed.json": {
        "artifact_family": ARTIFACT_FAMILY_STRATEGY_ALERT,
        "status": "error",
        "outcome_class": "analysis_failed",
        "degraded_status": "degraded_risky",
    },
    "strategy-alert-dipbuyer-market-gate-blocked.json": {
        "artifact_family": ARTIFACT_FAMILY_STRATEGY_ALERT,
        "status": "ok",
        "outcome_class": "market_gate_blocked",
        "degraded_status": "healthy",
    },
    "strategy-alert-dipbuyer-healthy-no-candidates.json": {
        "artifact_family": ARTIFACT_FAMILY_STRATEGY_ALERT,
        "status": "ok",
        "outcome_class": "healthy_no_candidates",
        "degraded_status": "healthy",
    },
    "run-manifest-completed-degraded-safe.json": {
        "artifact_family": ARTIFACT_FAMILY_RUN_MANIFEST,
        "status": "degraded",
        "outcome_class": "run_completed",
        "degraded_status": "degraded_safe",
    },
    "run-manifest-failed.json": {
        "artifact_family": ARTIFACT_FAMILY_RUN_MANIFEST,
        "status": "error",
        "outcome_class": "run_failed",
        "degraded_status": "degraded_risky",
    },
    "readiness-warn.json": {
        "artifact_family": ARTIFACT_FAMILY_READINESS_CHECK,
        "status": "degraded",
        "outcome_class": "readiness_warn",
        "degraded_status": "degraded_safe",
    },
    "readiness-fail.json": {
        "artifact_family": ARTIFACT_FAMILY_READINESS_CHECK,
        "status": "error",
        "outcome_class": "readiness_fail",
        "degraded_status": "degraded_risky",
    },
}


def _load_fixture(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_all_expected_consumer_contract_fixtures_exist():
    actual = {path.name for path in FIXTURE_DIR.glob("*.json")}
    assert actual == set(EXPECTED_CASES)


def test_consumer_contract_fixtures_are_valid_and_typed():
    for name, expected in EXPECTED_CASES.items():
        payload = _load_fixture(FIXTURE_DIR / name)
        validate_artifact_payload(payload, expected_family=expected["artifact_family"])
        assert payload["artifact_family"] == expected["artifact_family"]
        assert payload["status"] == expected["status"]
        assert payload["outcome_class"] == expected["outcome_class"]
        assert payload["degraded_status"] == expected["degraded_status"]


def test_strategy_alert_fixtures_expose_outcome_class_without_rendering():
    for name in (
        "strategy-alert-canslim-healthy-candidates-found.json",
        "strategy-alert-canslim-analysis-failed.json",
        "strategy-alert-dipbuyer-market-gate-blocked.json",
        "strategy-alert-dipbuyer-healthy-no-candidates.json",
    ):
        payload = _load_fixture(FIXTURE_DIR / name)
        assert payload["artifact_family"] == ARTIFACT_FAMILY_STRATEGY_ALERT
        assert isinstance(payload["signals"], list)
        assert isinstance(payload["summary"], dict)
        assert payload["outcome_class"]


def test_market_brief_fixtures_cover_healthy_safe_and_risky_consumer_states():
    blocked = _load_fixture(FIXTURE_DIR / "market-brief-market-gate-blocked.json")
    safe = _load_fixture(FIXTURE_DIR / "market-brief-degraded-safe.json")
    risky = _load_fixture(FIXTURE_DIR / "market-brief-degraded-risky.json")

    assert blocked["outcome_class"] == "market_gate_blocked"
    assert safe["degraded_status"] == "degraded_safe"
    assert risky["degraded_status"] == "degraded_risky"
    assert risky["tape"]["primary_source"] == "unavailable"


def test_run_manifest_fixtures_cover_completed_and_failed_runs():
    completed = _load_fixture(FIXTURE_DIR / "run-manifest-completed-degraded-safe.json")
    failed = _load_fixture(FIXTURE_DIR / "run-manifest-failed.json")

    assert completed["outcome_class"] == "run_completed"
    assert failed["outcome_class"] == "run_failed"
    assert failed["warnings"] == ["stage_failed:nightly_discovery"]


def test_readiness_fixtures_cover_warn_and_fail():
    warn = _load_fixture(FIXTURE_DIR / "readiness-warn.json")
    fail = _load_fixture(FIXTURE_DIR / "readiness-fail.json")

    assert warn["result"] == "warn"
    assert warn["ready_for_open"] is False
    assert fail["result"] == "fail"
    assert fail["ready_for_open"] is False
