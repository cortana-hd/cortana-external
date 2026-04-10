from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

from operator_surfaces.runtime_health import build_runtime_health_snapshot
from operator_surfaces.runtime_inventory import build_runtime_inventory_artifact


def test_runtime_inventory_artifact_is_complete_and_machine_readable():
    payload = build_runtime_inventory_artifact(generated_at="2026-04-03T12:00:00+00:00")

    assert payload["artifact_family"] == "runtime_inventory"
    component_keys = {row["component_key"] for row in payload["components"]}
    assert {"external_service", "watchdog", "pre_open_canary"} <= component_keys


def test_runtime_health_snapshot_captures_readiness_and_incident_paths(monkeypatch, tmp_path):
    readiness_path = tmp_path / "pre-open-canary-latest.json"
    readiness_path.write_text(
        json.dumps(
            {
                "artifact_family": "readiness_check",
                "result": "warn",
                "checked_at": "2026-04-03T11:55:00+00:00",
            }
        ),
        encoding="utf-8",
    )
    watchdog_state = tmp_path / "watchdog-state.json"
    watchdog_state.write_text(json.dumps({"status": "ok"}), encoding="utf-8")
    watchdog_log = tmp_path / "watchdog.log"
    watchdog_log.write_text("ok\n", encoding="utf-8")

    def fake_get(url, timeout):
        if url.endswith("/market-data/ready"):
            return SimpleNamespace(
                raise_for_status=lambda: None,
                json=lambda: {"data": {"ready": True, "operatorState": "healthy"}},
            )
        return SimpleNamespace(
            raise_for_status=lambda: None,
            json=lambda: {
                "data": {
                    "serviceOperatorState": "healthy",
                    "providerLaneGuidance": {
                        "liveQuotes": {"providerMode": "schwab_primary"},
                        "history": {"providerMode": "schwab_primary"},
                        "fundamentals": {"providerMode": "schwab_primary"},
                        "metadata": {"providerMode": "schwab_primary"},
                    },
                }
            },
        )

    monkeypatch.setattr("operator_surfaces.runtime_health.requests.get", fake_get)

    payload = build_runtime_health_snapshot(
        generated_at="2026-04-03T12:00:00+00:00",
        readiness_path=readiness_path,
        watchdog_state_path=watchdog_state,
        watchdog_log_path=watchdog_log,
    )

    assert payload["artifact_family"] == "runtime_health_snapshot"
    assert payload["cron_health"]["pre_open_canary_result"] == "warn"
    assert payload["pre_open_gate_freshness"]["status"] == "fresh"
    assert payload["watchdog_health"]["state_present"] is True
    assert payload["provider_mode_summary"]["summary_line"] == (
        "Live quotes: schwab_primary | history: schwab_primary | fundamentals: schwab_primary | metadata: schwab_primary"
    )
    assert payload["inspection_paths"]["readiness_artifact"] == str(readiness_path)


def test_runtime_health_snapshot_marks_service_incident_when_ready_unreachable(monkeypatch, tmp_path):
    def fake_get(url, timeout):
        raise RuntimeError("503 Service Unavailable")

    monkeypatch.setattr("operator_surfaces.runtime_health.requests.get", fake_get)

    payload = build_runtime_health_snapshot(
        generated_at="2026-04-03T12:00:00+00:00",
        readiness_path=tmp_path / "missing.json",
        watchdog_state_path=tmp_path / "missing-state.json",
        watchdog_log_path=tmp_path / "missing.log",
    )

    assert payload["status"] == "degraded"
    incident_types = {item["incident_type"] for item in payload["incident_markers"]}
    assert "market_data_service_unreachable" in incident_types
    assert "pre_open_gate_unavailable" in incident_types
    assert payload["pre_open_gate_status"] == "not_available"
    assert "Pre-open readiness check artifact is missing" in payload["pre_open_gate_detail"]
    assert payload["pre_open_gate_freshness"]["status"] == "missing"


def test_runtime_health_snapshot_marks_provider_cooldown_as_incident(monkeypatch, tmp_path):
    readiness_path = tmp_path / "pre-open-canary-latest.json"
    readiness_path.write_text(
        json.dumps(
            {
                "artifact_family": "readiness_check",
                "result": "warn",
                "checked_at": "2026-04-03T11:55:00+00:00",
            }
        ),
        encoding="utf-8",
    )

    def fake_get(url, timeout):
        if url.endswith("/market-data/ready"):
            return SimpleNamespace(
                raise_for_status=lambda: None,
                json=lambda: {
                    "data": {
                        "ready": True,
                        "operatorState": "provider_cooldown",
                        "operatorAction": "wait",
                    }
                },
            )
        return SimpleNamespace(
            raise_for_status=lambda: None,
            json=lambda: {
                "data": {
                    "serviceOperatorState": "provider_cooldown",
                    "serviceOperatorAction": "wait",
                }
            },
        )

    monkeypatch.setattr("operator_surfaces.runtime_health.requests.get", fake_get)

    payload = build_runtime_health_snapshot(
        generated_at="2026-04-03T12:00:00+00:00",
        readiness_path=readiness_path,
        watchdog_state_path=tmp_path / "missing-state.json",
        watchdog_log_path=tmp_path / "missing.log",
    )

    assert payload["status"] == "degraded"
    assert payload["service_health"]["status"] == "degraded"
    assert payload["service_health"]["operator_state"] == "provider_cooldown"
    assert payload["incident_markers"][0]["incident_type"] == "provider_cooldown"
    assert "provider_cooldown" in payload["warnings"]
    assert payload["provider_cooldown_summary"]["active"] is True
    assert payload["provider_cooldown_summary"]["detail"] is not None


def test_runtime_health_snapshot_normalizes_unknown_canary_result(monkeypatch, tmp_path):
    readiness_path = tmp_path / "pre-open-canary-latest.json"
    readiness_path.write_text(
        json.dumps(
            {
                "artifact_family": "readiness_check",
                "result": "unknown",
                "checked_at": "2026-04-03T11:55:00+00:00",
            }
        ),
        encoding="utf-8",
    )

    def fake_get(url, timeout):
        return SimpleNamespace(
            raise_for_status=lambda: None,
            json=lambda: {"data": {"ready": True, "operatorState": "healthy"}},
        )

    monkeypatch.setattr("operator_surfaces.runtime_health.requests.get", fake_get)

    payload = build_runtime_health_snapshot(
        generated_at="2026-04-03T12:00:00+00:00",
        readiness_path=readiness_path,
        watchdog_state_path=tmp_path / "missing-state.json",
        watchdog_log_path=tmp_path / "missing.log",
    )

    assert payload["cron_health"]["pre_open_canary_result"] == "not_reported"
    assert payload["pre_open_gate_status"] == "not_reported"
    assert payload["pre_open_gate_freshness"]["status"] == "fresh"


def test_runtime_health_snapshot_marks_stale_canary_artifact(monkeypatch, tmp_path):
    readiness_path = tmp_path / "pre-open-canary-latest.json"
    readiness_path.write_text(
        json.dumps(
            {
                "artifact_family": "readiness_check",
                "result": "pass",
                "checked_at": "2026-04-03T08:00:00+00:00",
            }
        ),
        encoding="utf-8",
    )

    def fake_get(url, timeout):
        return SimpleNamespace(
            raise_for_status=lambda: None,
            json=lambda: {"data": {"ready": True, "operatorState": "healthy"}},
        )

    monkeypatch.setattr("operator_surfaces.runtime_health.requests.get", fake_get)

    payload = build_runtime_health_snapshot(
        generated_at="2026-04-03T12:00:00+00:00",
        readiness_path=readiness_path,
        watchdog_state_path=tmp_path / "missing-state.json",
        watchdog_log_path=tmp_path / "missing.log",
        pre_open_canary_max_age_seconds=900,
    )

    incident_types = {item["incident_type"] for item in payload["incident_markers"]}
    assert payload["pre_open_gate_status"] == "stale"
    assert payload["pre_open_gate_freshness"]["status"] == "stale"
    assert "pre_open_gate_unavailable" in incident_types


def test_runtime_health_snapshot_humanizes_pre_open_freshness_timestamp(monkeypatch, tmp_path):
    readiness_path = tmp_path / "pre-open-canary-latest.json"
    readiness_path.write_text(
        json.dumps(
            {
                "artifact_family": "readiness_check",
                "result": "warn",
                "checked_at": "2026-04-08T14:45:47.822867+00:00",
            }
        ),
        encoding="utf-8",
    )

    def fake_get(url, timeout):
        return SimpleNamespace(
            raise_for_status=lambda: None,
            json=lambda: {"data": {"ready": True, "operatorState": "healthy"}},
        )

    monkeypatch.setattr("operator_surfaces.runtime_health.requests.get", fake_get)

    payload = build_runtime_health_snapshot(
        generated_at="2026-04-08T14:46:20.382599+00:00",
        readiness_path=readiness_path,
        watchdog_state_path=tmp_path / "missing-state.json",
        watchdog_log_path=tmp_path / "missing.log",
    )

    assert payload["pre_open_gate_detail"] == "Last pre-open readiness check ran under 1m ago at Apr 8, 10:45 AM ET."
    assert payload["pre_open_gate_freshness"]["detail"] == payload["pre_open_gate_detail"]
