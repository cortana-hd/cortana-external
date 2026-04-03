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
            json=lambda: {"data": {"serviceOperatorState": "healthy"}},
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
    assert payload["watchdog_health"]["state_present"] is True
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
    assert payload["incident_markers"][0]["incident_type"] == "market_data_service_unreachable"
