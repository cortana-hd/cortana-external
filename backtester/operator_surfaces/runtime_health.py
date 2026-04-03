"""Runtime-health snapshot helpers for operator surfaces and ops planning."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import requests

from evaluation.artifact_contracts import (
    ARTIFACT_FAMILY_RUNTIME_HEALTH_SNAPSHOT,
    annotate_artifact,
)

BACKTESTER_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKTESTER_ROOT.parent
WATCHDOG_ROOT = REPO_ROOT / "watchdog"
DEFAULT_READINESS_PATH = BACKTESTER_ROOT / "var" / "readiness" / "pre-open-canary-latest.json"
DEFAULT_WATCHDOG_STATE_PATH = WATCHDOG_ROOT / "watchdog-state.json"
DEFAULT_WATCHDOG_LOG_PATH = WATCHDOG_ROOT / "logs" / "watchdog.log"
DEFAULT_SERVICE_BASE_URL = "http://127.0.0.1:3033"


def build_runtime_health_snapshot(
    *,
    generated_at: str,
    service_base_url: str = DEFAULT_SERVICE_BASE_URL,
    readiness_path: Path = DEFAULT_READINESS_PATH,
    watchdog_state_path: Path = DEFAULT_WATCHDOG_STATE_PATH,
    watchdog_log_path: Path = DEFAULT_WATCHDOG_LOG_PATH,
) -> dict[str, Any]:
    readiness = _load_json(readiness_path)
    ready_payload, ready_error = _http_json(f"{service_base_url.rstrip('/')}/market-data/ready")
    ops_payload, ops_error = _http_json(f"{service_base_url.rstrip('/')}/market-data/ops")
    watchdog_state = _load_json(watchdog_state_path)

    service_health = {
        "status": "ok" if ready_error is None else "degraded",
        "ready_error": ready_error,
        "ready_payload": ready_payload,
        "ops_error": ops_error,
        "ops_payload": ops_payload,
    }
    cron_health = {
        "status": "ok" if readiness else "degraded",
        "pre_open_canary_present": bool(readiness),
        "pre_open_canary_result": str((readiness or {}).get("result") or "unknown"),
        "pre_open_canary_checked_at": (readiness or {}).get("checked_at"),
    }
    watchdog_health = {
        "status": "ok" if watchdog_state_path.exists() or watchdog_log_path.exists() else "degraded",
        "state_path": str(watchdog_state_path),
        "log_path": str(watchdog_log_path),
        "state_present": watchdog_state_path.exists(),
        "log_present": watchdog_log_path.exists(),
        "state_payload": watchdog_state,
    }
    delivery_health = {
        "status": "ok" if readiness else "degraded",
        "notes": "Delivery health is inferred from readiness and watchdog artifacts until direct Telegram receipts are modeled.",
    }

    ready_data = (ready_payload or {}).get("data") if isinstance(ready_payload, dict) else {}
    ops_data = (ops_payload or {}).get("data") if isinstance(ops_payload, dict) else {}
    operator_state = str(
        (ready_data or {}).get("operatorState")
        or (ops_data or {}).get("serviceOperatorState")
        or ""
    ).strip()
    operator_action = str(
        (ready_data or {}).get("operatorAction")
        or (ops_data or {}).get("serviceOperatorAction")
        or ""
    ).strip()

    incident_markers = []
    if ready_error:
        incident_markers.append(
            {
                "incident_type": "market_data_service_unreachable",
                "severity": "high",
                "runbook_ref": "watchdog/README.md#What it checks",
            }
        )
    elif operator_state == "provider_cooldown":
        incident_markers.append(
            {
                "incident_type": "provider_cooldown",
                "severity": "medium",
                "runbook_ref": "backtester/docs/market-data-service-reference.md",
                "operator_action": operator_action,
            }
        )
    if readiness and str(readiness.get("result") or "").lower() == "fail":
        incident_markers.append(
            {
                "incident_type": "pre_open_gate_failed",
                "severity": "high",
                "runbook_ref": "watchdog/README.md#What it checks",
            }
        )

    if operator_state and operator_state not in {"healthy"} and service_health["status"] == "ok":
        service_health["status"] = "degraded"
    if operator_state:
        service_health["operator_state"] = operator_state
    if operator_action:
        service_health["operator_action"] = operator_action

    overall_status = "ok" if not incident_markers and readiness else "degraded"
    return annotate_artifact(
        {
            "pre_open_gate_status": str((readiness or {}).get("result") or "unknown"),
            "service_health": service_health,
            "cron_health": cron_health,
            "watchdog_health": watchdog_health,
            "delivery_health": delivery_health,
            "incident_markers": incident_markers,
            "inspection_paths": {
                "readiness_artifact": str(readiness_path),
                "watchdog_state": str(watchdog_state_path),
                "watchdog_log": str(watchdog_log_path),
                "service_ready": f"{service_base_url.rstrip('/')}/market-data/ready",
                "service_ops": f"{service_base_url.rstrip('/')}/market-data/ops",
            },
            "warnings": [item["incident_type"] for item in incident_markers],
        },
        artifact_family=ARTIFACT_FAMILY_RUNTIME_HEALTH_SNAPSHOT,
        producer="backtester.operator_surfaces.runtime_health",
        generated_at=generated_at,
        known_at=generated_at,
        status=overall_status,
        degraded_status="healthy" if overall_status == "ok" else "degraded_safe",
        outcome_class="run_completed" if overall_status == "ok" else "degraded_safe",
    )


def _load_json(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    return payload if isinstance(payload, dict) else None


def _http_json(url: str) -> tuple[dict[str, Any] | None, str | None]:
    try:
        response = requests.get(url, timeout=5)
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:
        return None, str(exc)
    return payload if isinstance(payload, dict) else None, None
