"""Runtime-health snapshot helpers for operator surfaces and ops planning."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

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
DEFAULT_PRE_OPEN_CANARY_MAX_AGE_SECONDS = 7200
DISPLAY_TIMEZONE = ZoneInfo("America/New_York")


def build_runtime_health_snapshot(
    *,
    generated_at: str,
    service_base_url: str = DEFAULT_SERVICE_BASE_URL,
    readiness_path: Path = DEFAULT_READINESS_PATH,
    watchdog_state_path: Path = DEFAULT_WATCHDOG_STATE_PATH,
    watchdog_log_path: Path = DEFAULT_WATCHDOG_LOG_PATH,
    pre_open_canary_max_age_seconds: int = DEFAULT_PRE_OPEN_CANARY_MAX_AGE_SECONDS,
) -> dict[str, Any]:
    readiness = _load_json(readiness_path)
    ready_payload, ready_error = _http_json(f"{service_base_url.rstrip('/')}/market-data/ready")
    ops_payload, ops_error = _http_json(f"{service_base_url.rstrip('/')}/market-data/ops")
    watchdog_state = _load_json(watchdog_state_path)
    canary_freshness = _build_canary_freshness(
        readiness,
        readiness_path=readiness_path,
        generated_at=generated_at,
        max_age_seconds=pre_open_canary_max_age_seconds,
    )

    service_health = {
        "status": "ok" if ready_error is None else "degraded",
        "ready_error": ready_error,
        "ready_payload": ready_payload,
        "ops_error": ops_error,
        "ops_payload": ops_payload,
    }
    canary_result = str((readiness or {}).get("result") or "not_available")
    if canary_freshness["status"] == "stale":
        canary_result = "stale"
    elif canary_result == "unknown":
        canary_result = "not_reported"

    cron_health = {
        "status": "ok" if canary_freshness["status"] == "fresh" else "degraded",
        "pre_open_canary_present": bool(readiness),
        "pre_open_canary_result": canary_result,
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
    cooldown_summary = _build_provider_cooldown_summary(
        operator_state=operator_state,
        watchdog_state=watchdog_state,
    )
    provider_lane_guidance = (
        (ops_data or {}).get("providerLaneGuidance")
        if isinstance((ops_data or {}).get("providerLaneGuidance"), dict)
        else {}
    )
    provider_mode_summary = _build_provider_mode_summary(provider_lane_guidance)

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
                "runbook_ref": "backtester/docs/source/reference/market-data-service-reference.md",
                "operator_action": operator_action,
            }
        )
    if canary_freshness["status"] in {"missing", "stale", "unreadable"}:
        incident_markers.append(
            {
                "incident_type": "pre_open_gate_unavailable",
                "severity": "medium",
                "runbook_ref": "watchdog/README.md#What it checks",
                "operator_action": canary_freshness["detail"],
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
    if provider_mode_summary["summary_line"]:
        service_health["provider_mode_summary"] = provider_mode_summary["summary_line"]

    pre_open_gate_status = canary_result
    pre_open_gate_detail = canary_freshness["detail"]

    overall_status = "ok" if not incident_markers and canary_freshness["status"] == "fresh" else "degraded"
    return annotate_artifact(
        {
            "pre_open_gate_status": pre_open_gate_status,
            "pre_open_gate_detail": pre_open_gate_detail,
            "pre_open_gate_freshness": canary_freshness,
            "service_health": service_health,
            "cron_health": cron_health,
            "watchdog_health": watchdog_health,
            "delivery_health": delivery_health,
            "provider_cooldown_summary": cooldown_summary,
            "provider_mode_summary": provider_mode_summary,
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


def _build_canary_freshness(
    readiness: dict[str, Any] | None,
    *,
    readiness_path: Path,
    generated_at: str,
    max_age_seconds: int,
) -> dict[str, Any]:
    checked_at = None
    if isinstance(readiness, dict):
        checked_at = readiness.get("checked_at") or readiness.get("generated_at")
    age_seconds = _age_seconds(checked_at, generated_at)
    detail = None
    status = "fresh"

    if not readiness_path.exists():
        status = "missing"
        detail = f"Pre-open readiness check artifact is missing at {readiness_path}."
    elif readiness is None:
        status = "unreadable"
        detail = f"Pre-open readiness check artifact at {readiness_path} is unreadable or invalid."
    elif age_seconds is None:
        status = "unreadable"
        detail = f"Pre-open readiness check artifact at {readiness_path} is missing a valid checked_at timestamp."
    elif age_seconds > max_age_seconds:
        status = "stale"
        detail = (
            f"Pre-open readiness check is stale. Last check ran "
            f"{_format_duration(age_seconds)} ago at {_format_iso(checked_at)}."
        )
    else:
        detail = f"Last pre-open readiness check ran {_format_duration(age_seconds)} ago at {_format_iso(checked_at)}."

    return {
        "status": status,
        "checked_at": checked_at,
        "age_seconds": age_seconds,
        "max_age_seconds": max_age_seconds,
        "detail": detail,
    }


def _build_provider_cooldown_summary(
    *,
    operator_state: str,
    watchdog_state: dict[str, Any] | None,
) -> dict[str, Any]:
    failing_rows: list[dict[str, Any]] = []
    labels = {
        "market_data_provider": "provider health",
        "market_data_quotes": "quote smoke",
    }

    state_payload = watchdog_state if isinstance(watchdog_state, dict) else {}
    for key, label in labels.items():
        row = state_payload.get(key)
        if not isinstance(row, dict):
            continue
        if str(row.get("status") or "") != "failing":
            continue
        failing_rows.append(
            {
                "key": key,
                "label": label,
                "first_failure": _epoch_to_iso(row.get("first_failure")),
                "last_alert": _epoch_to_iso(row.get("last_alert")),
            }
        )

    active = operator_state == "provider_cooldown" or bool(failing_rows)
    first_failure_at = _min_iso(*(row["first_failure"] for row in failing_rows))
    last_alert_at = _max_iso(*(row["last_alert"] for row in failing_rows))
    active_for_seconds = _duration_between(first_failure_at) if active and first_failure_at else None
    affected_labels = [row["label"] for row in failing_rows]
    detail = None
    if active:
        affected = ", ".join(affected_labels) if affected_labels else "market-data service"
        if first_failure_at:
            detail = f"Cooldown is active now. Watchdog still sees {affected} failing since {_format_iso(first_failure_at)}."
        else:
            detail = f"Cooldown is active now across {affected}."
    elif last_alert_at:
        detail = f"Last provider cooldown alert cleared at {_format_iso(last_alert_at)}."

    return {
        "active": active,
        "affected_checks": affected_labels,
        "failing_check_count": len(failing_rows),
        "first_failure_at": first_failure_at,
        "last_alert_at": last_alert_at,
        "active_for_seconds": active_for_seconds,
        "detail": detail,
    }


def _build_provider_mode_summary(provider_lane_guidance: dict[str, Any]) -> dict[str, Any]:
    live_quotes = provider_lane_guidance.get("liveQuotes") if isinstance(provider_lane_guidance, dict) else {}
    history = provider_lane_guidance.get("history") if isinstance(provider_lane_guidance, dict) else {}
    fundamentals = provider_lane_guidance.get("fundamentals") if isinstance(provider_lane_guidance, dict) else {}
    metadata = provider_lane_guidance.get("metadata") if isinstance(provider_lane_guidance, dict) else {}

    def _mode(row: Any) -> str:
        return str(row.get("providerMode") or "unknown") if isinstance(row, dict) else "unknown"

    return {
        "live_quotes": live_quotes if isinstance(live_quotes, dict) else {},
        "history": history if isinstance(history, dict) else {},
        "fundamentals": fundamentals if isinstance(fundamentals, dict) else {},
        "metadata": metadata if isinstance(metadata, dict) else {},
        "summary_line": (
            f"Live quotes: {_mode(live_quotes)} | "
            f"history: {_mode(history)} | "
            f"fundamentals: {_mode(fundamentals)} | "
            f"metadata: {_mode(metadata)}"
        ),
    }


def _age_seconds(value: Any, generated_at: str) -> int | None:
    if not value:
        return None
    checked_dt = _parse_iso(value)
    generated_dt = _parse_iso(generated_at)
    if checked_dt is None or generated_dt is None:
        return None
    return max(0, int((generated_dt - checked_dt).total_seconds()))


def _duration_between(value: str | None) -> int | None:
    if not value:
        return None
    current = datetime.now(UTC)
    parsed = _parse_iso(value)
    if parsed is None:
        return None
    return max(0, int((current - parsed).total_seconds()))


def _parse_iso(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(UTC)
    except Exception:
        return None


def _epoch_to_iso(value: Any) -> str | None:
    try:
        raw = int(value)
    except Exception:
        return None
    if raw <= 0:
        return None
    return datetime.fromtimestamp(raw, UTC).isoformat()


def _format_duration(seconds: int | None) -> str:
    if seconds is None:
        return "unknown age"
    if seconds < 60:
        return "under 1m"
    minutes = round(seconds / 60)
    if minutes < 60:
        return f"{minutes}m"
    hours = minutes // 60
    remainder = minutes % 60
    if remainder == 0:
        return f"{hours}h"
    return f"{hours}h {remainder}m"


def _format_iso(value: Any) -> str:
    parsed = _parse_iso(value)
    if parsed is None:
        return "unknown time"
    display = parsed.astimezone(DISPLAY_TIMEZONE)
    month = display.strftime("%b")
    hour = display.strftime("%I").lstrip("0") or "0"
    return f"{month} {display.day}, {hour}:{display.strftime('%M %p')} ET"


def _min_iso(*values: str | None) -> str | None:
    parsed = [item for item in (_parse_iso(value) for value in values) if item is not None]
    if not parsed:
        return None
    return min(parsed).isoformat()


def _max_iso(*values: str | None) -> str | None:
    parsed = [item for item in (_parse_iso(value) for value in values) if item is not None]
    if not parsed:
        return None
    return max(parsed).isoformat()
