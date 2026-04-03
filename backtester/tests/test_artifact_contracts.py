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
