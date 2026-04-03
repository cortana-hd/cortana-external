from __future__ import annotations

import pytest

from evaluation import artifact_contracts as contracts


def test_annotate_artifact_adds_required_metadata():
    payload = contracts.annotate_artifact(
        {
            "session": {"phase": "OPEN", "is_regular_hours": True},
            "regime": {"display": "CORRECTION"},
            "posture": {"action": "NO_BUY"},
            "tape": {"primary_source": "cache"},
            "macro": {"state": "unknown"},
            "intraday_breadth": {"override_state": "inactive"},
            "focus": {"symbols": ["OXY"]},
            "warnings": [],
        },
        artifact_family=contracts.ARTIFACT_FAMILY_MARKET_BRIEF,
        producer="backtester.market_brief_snapshot",
        generated_at="2026-04-03T12:00:00+00:00",
        status="degraded",
        outcome_class="market_snapshot",
        freshness={"regime_snapshot_age_seconds": 0.0},
    )

    assert payload["artifact_family"] == contracts.ARTIFACT_FAMILY_MARKET_BRIEF
    assert payload["schema_version"] == contracts.ARTIFACT_SCHEMA_VERSION
    assert payload["producer"] == "backtester.market_brief_snapshot"
    assert payload["status"] == "degraded"
    assert payload["degraded_status"] == "degraded_safe"
    assert payload["outcome_class"] == "market_snapshot"
    assert payload["known_at"] == "2026-04-03T12:00:00+00:00"


def test_validate_artifact_payload_rejects_missing_required_family_fields():
    with pytest.raises(ValueError, match="missing required fields"):
        contracts.validate_artifact_payload(
            {
                "artifact_family": contracts.ARTIFACT_FAMILY_MARKET_BRIEF,
                "schema_version": contracts.ARTIFACT_SCHEMA_VERSION,
                "producer": "backtester.market_brief_snapshot",
                "status": "ok",
                "generated_at": "2026-04-03T12:00:00+00:00",
                "known_at": "2026-04-03T12:00:00+00:00",
                "degraded_status": "healthy",
            }
        )


def test_build_artifact_metadata_defaults_healthy_for_ok_status():
    metadata = contracts.build_artifact_metadata(
        artifact_family=contracts.ARTIFACT_FAMILY_MARKET_BRIEF,
        producer="backtester.market_brief_snapshot",
        generated_at="2026-04-03T12:00:00+00:00",
        status="ok",
    )

    assert metadata["degraded_status"] == "healthy"
    assert metadata["known_at"] == "2026-04-03T12:00:00+00:00"


def test_build_artifact_metadata_accepts_risky_degraded_status():
    metadata = contracts.build_artifact_metadata(
        artifact_family=contracts.ARTIFACT_FAMILY_MARKET_BRIEF,
        producer="backtester.market_brief_snapshot",
        generated_at="2026-04-03T12:00:00+00:00",
        status="error",
        degraded_status="degraded_risky",
    )

    assert metadata["degraded_status"] == "degraded_risky"


def test_validate_artifact_payload_accepts_readiness_check_family():
    payload = contracts.annotate_artifact(
        {
            "check_name": "pre_open_canary",
            "result": "pass",
            "ready_for_open": True,
            "checked_at": "2026-04-03T12:00:00+00:00",
            "checks": [{"name": "service_ready", "result": "pass", "evidence": {}}],
            "warnings": [],
        },
        artifact_family=contracts.ARTIFACT_FAMILY_READINESS_CHECK,
        producer="backtester.pre_open_canary",
        generated_at="2026-04-03T12:00:00+00:00",
        status="ok",
    )

    assert payload["artifact_family"] == contracts.ARTIFACT_FAMILY_READINESS_CHECK
    assert payload["degraded_status"] == "healthy"


def test_validate_artifact_payload_accepts_operator_payload_family():
    payload = contracts.annotate_artifact(
        {
            "payload_key": "market_brief:2026-04-03T12:00:00Z",
            "surface_type": "brief",
            "summary": {
                "headline": "OPEN: NO_BUY | CORRECTION | size 0%",
                "what_this_means": "Stay defensive.",
            },
            "decision_contract_ref": {
                "artifact_family": "decision_state",
                "producer": "backtester.market_brief_snapshot",
                "generated_at": "2026-04-03T12:00:00+00:00",
            },
            "source_refs": {
                "market_brief": {
                    "artifact_family": "market_brief",
                    "producer": "backtester.market_brief_snapshot",
                    "generated_at": "2026-04-03T12:00:00+00:00",
                }
            },
            "health": {"status": "ok"},
            "warnings": [],
        },
        artifact_family=contracts.ARTIFACT_FAMILY_OPERATOR_PAYLOAD,
        producer="backtester.market_brief_snapshot",
        generated_at="2026-04-03T12:00:00+00:00",
        status="ok",
    )

    assert payload["artifact_family"] == contracts.ARTIFACT_FAMILY_OPERATOR_PAYLOAD
    assert payload["degraded_status"] == "healthy"
