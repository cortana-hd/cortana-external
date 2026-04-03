#!/usr/bin/env python3
"""Pre-open readiness canary for the live trading lane."""

from __future__ import annotations

import argparse
from datetime import UTC, datetime
import json
from pathlib import Path
from typing import Any

import requests

import canslim_alert
from advisor import TradingAdvisor
from evaluation.artifact_contracts import (
    ARTIFACT_FAMILY_READINESS_CHECK,
    ARTIFACT_STATUS_DEGRADED,
    ARTIFACT_STATUS_ERROR,
    ARTIFACT_STATUS_OK,
    DEGRADED_STATUS_HEALTHY,
    DEGRADED_STATUS_RISKY,
    DEGRADED_STATUS_SAFE,
    annotate_artifact,
)

BACKTESTER_ROOT = Path(__file__).resolve().parent
DEFAULT_OUTPUT_PATH = BACKTESTER_ROOT / "var" / "readiness" / "pre-open-canary-latest.json"
DEFAULT_SERVICE_BASE_URL = "http://127.0.0.1:3033"
DEFAULT_QUOTE_SYMBOLS = ("SPY", "QQQ")

RESULT_PASS = "pass"
RESULT_WARN = "warn"
RESULT_FAIL = "fail"

OUTCOME_READINESS_PASS = "readiness_pass"
OUTCOME_READINESS_WARN = "readiness_warn"
OUTCOME_READINESS_FAIL = "readiness_fail"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the pre-open readiness canary.")
    parser.add_argument("--service-base-url", default=DEFAULT_SERVICE_BASE_URL)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_PATH)
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON to stdout.")
    parser.add_argument("--operator", action="store_true", help="Print an operator-facing summary instead of raw JSON.")
    parser.add_argument("--require-pass", action="store_true", help="Exit non-zero unless the overall result is pass.")
    parser.add_argument("--quote-symbols", default=",".join(DEFAULT_QUOTE_SYMBOLS))
    parser.add_argument("--strategy-universe-size", type=int, default=12)
    parser.add_argument("--strategy-limit", type=int, default=2)
    return parser.parse_args()


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


def _result_rank(value: str) -> int:
    return {RESULT_PASS: 0, RESULT_WARN: 1, RESULT_FAIL: 2}.get(str(value).strip().lower(), 2)


def _max_result(*values: str) -> str:
    normalized = [str(value).strip().lower() for value in values if str(value).strip()]
    if not normalized:
        return RESULT_FAIL
    return max(normalized, key=_result_rank)


def _http_json(url: str) -> tuple[dict[str, Any] | None, str | None]:
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:
        return None, str(exc)
    return payload if isinstance(payload, dict) else None, None


def _parse_ready_and_ops(
    service_base_url: str,
    *,
    require_schwab: bool = True,
) -> dict[str, Any]:
    ready_payload, ready_error = _http_json(f"{service_base_url}/market-data/ready")
    if ready_error:
        return {
            "name": "service_ready",
            "result": RESULT_FAIL,
            "evidence": {
                "reason": "ready_unreachable",
                "error": ready_error,
            },
        }

    ops_payload, ops_error = _http_json(f"{service_base_url}/market-data/ops")
    if ops_error:
        return {
            "name": "service_ready",
            "result": RESULT_FAIL,
            "evidence": {
                "reason": "ops_unreachable",
                "error": ops_error,
                "ready": ready_payload,
            },
        }

    ready_data = (ready_payload.get("data") or {}) if isinstance(ready_payload, dict) else {}
    ops_data = (ops_payload.get("data") or {}) if isinstance(ops_payload, dict) else {}
    providers = ((ops_data.get("health") or {}).get("providers") or {}) if isinstance(ops_data, dict) else {}
    provider_metrics = providers.get("providerMetrics") or {}

    operator_state = str(ready_data.get("operatorState") or ops_data.get("serviceOperatorState") or "unknown")
    operator_action = str(ready_data.get("operatorAction") or ops_data.get("serviceOperatorAction") or "")
    schwab_state = str(providers.get("schwab") or "unknown")
    token_status = str(providers.get("schwabTokenStatus") or provider_metrics.get("schwabTokenStatus") or "unknown")
    token_reason = str(providers.get("schwabTokenReason") or provider_metrics.get("schwabTokenReason") or "")

    result = RESULT_PASS
    reason = "healthy"
    if not bool(ready_data.get("ready")):
        result = RESULT_FAIL
        reason = f"service_not_ready:{operator_state}"
    elif require_schwab and schwab_state != "configured":
        result = RESULT_FAIL
        reason = "schwab_not_configured"
    elif require_schwab and token_status == "human_action_required":
        result = RESULT_FAIL
        reason = "human_action_required"
    elif operator_state == "provider_cooldown":
        result = RESULT_WARN
        reason = "provider_cooldown"

    return {
        "name": "service_ready",
        "result": result,
        "evidence": {
            "reason": reason,
            "operator_state": operator_state,
            "operator_action": operator_action or token_reason,
            "schwab_state": schwab_state,
            "token_status": token_status,
        },
    }


def _quote_smoke(service_base_url: str, symbols: tuple[str, ...]) -> dict[str, Any]:
    symbol_query = ",".join(symbols)
    payload, error = _http_json(f"{service_base_url}/market-data/quote/batch?symbols={symbol_query}")
    if error:
        lowered = error.lower()
        result = RESULT_WARN if ("503" in lowered or "service unavailable" in lowered) else RESULT_FAIL
        return {
            "name": "quote_smoke",
            "result": result,
            "evidence": {
                "symbols": list(symbols),
                "error": error,
            },
        }

    items = (((payload or {}).get("data") or {}).get("items") or [])
    ok_items = []
    bad_items = []
    for item in items:
        if not isinstance(item, dict):
            continue
        symbol = str(item.get("symbol") or "")
        status = str(item.get("status") or "unknown")
        source = str(item.get("source") or "unknown")
        if status == "ok":
            ok_items.append({"symbol": symbol, "source": source})
        else:
            bad_items.append(
                {
                    "symbol": symbol,
                    "status": status,
                    "source": source,
                    "degraded_reason": item.get("degradedReason"),
                }
            )
    result = RESULT_PASS if len(ok_items) == len(symbols) and not bad_items else RESULT_WARN
    return {
        "name": "quote_smoke",
        "result": result,
        "evidence": {
            "symbols": list(symbols),
            "ok_items": ok_items,
            "bad_items": bad_items,
        },
    }


def _regime_path() -> dict[str, Any]:
    try:
        market = TradingAdvisor().get_market_status(refresh=True)
    except Exception as exc:
        return {
            "name": "regime_path",
            "result": RESULT_FAIL,
            "evidence": {"error": str(exc)},
        }

    market_status = str(getattr(market, "status", "unknown") or "unknown")
    data_source = str(getattr(market, "data_source", "unknown") or "unknown")
    snapshot_age_seconds = float(getattr(market, "snapshot_age_seconds", 0.0) or 0.0)
    result = RESULT_PASS
    if market_status == "degraded" or data_source in {"unknown", "unavailable", "cache"}:
        result = RESULT_WARN
    return {
        "name": "regime_path",
        "result": result,
        "evidence": {
            "market_status": market_status,
            "data_source": data_source,
            "snapshot_age_seconds": snapshot_age_seconds,
            "notes": str(getattr(market, "notes", "") or ""),
            "degraded_reason": str(getattr(market, "degraded_reason", "") or ""),
        },
    }


def _strategy_smoke(*, strategy_limit: int, strategy_universe_size: int) -> dict[str, Any]:
    try:
        payload = canslim_alert.build_alert_payload(
            limit=strategy_limit,
            min_score=6,
            universe_size=strategy_universe_size,
            review_detail_limit=1,
        )
    except Exception as exc:
        return {
            "name": "strategy_smoke",
            "result": RESULT_FAIL,
            "evidence": {"error": str(exc)},
        }

    artifact_status = str(payload.get("status") or "unknown")
    degraded_status = str(payload.get("degraded_status") or "unknown")
    outcome_class = str(payload.get("outcome_class") or "unknown")
    result = RESULT_PASS
    if artifact_status == ARTIFACT_STATUS_ERROR:
        result = RESULT_FAIL
    elif artifact_status == ARTIFACT_STATUS_DEGRADED or degraded_status != DEGRADED_STATUS_HEALTHY:
        result = RESULT_WARN
    return {
        "name": "strategy_smoke",
        "result": result,
        "evidence": {
            "strategy": "canslim",
            "artifact_status": artifact_status,
            "degraded_status": degraded_status,
            "outcome_class": outcome_class,
            "summary": dict(payload.get("summary") or {}),
        },
    }


def _skipped_check(name: str, reason: str) -> dict[str, Any]:
    return {
        "name": name,
        "result": RESULT_WARN,
        "evidence": {
            "reason": "skipped",
            "detail": reason,
        },
    }


def build_canary_payload(
    *,
    service_base_url: str,
    quote_symbols: tuple[str, ...],
    strategy_limit: int,
    strategy_universe_size: int,
) -> dict[str, Any]:
    checked_at = _utc_now()
    service_check = _parse_ready_and_ops(service_base_url)
    checks = [service_check]
    if service_check["result"] == RESULT_FAIL:
        checks.extend(
            [
                _skipped_check("quote_smoke", "service_ready failed"),
                _skipped_check("regime_path", "service_ready failed"),
                _skipped_check("strategy_smoke", "service_ready failed"),
            ]
        )
    else:
        checks.extend(
            [
                _quote_smoke(service_base_url, quote_symbols),
                _regime_path(),
                _strategy_smoke(strategy_limit=strategy_limit, strategy_universe_size=strategy_universe_size),
            ]
        )
    overall = _max_result(*(check["result"] for check in checks))
    warnings = [
        f"{check['name']}:{check['evidence'].get('reason') or check['result']}"
        for check in checks
        if check["result"] != RESULT_PASS
    ]
    status = ARTIFACT_STATUS_OK
    degraded_status = DEGRADED_STATUS_HEALTHY
    outcome_class = OUTCOME_READINESS_PASS
    if overall == RESULT_WARN:
        status = ARTIFACT_STATUS_DEGRADED
        degraded_status = DEGRADED_STATUS_SAFE
        outcome_class = OUTCOME_READINESS_WARN
    elif overall == RESULT_FAIL:
        status = ARTIFACT_STATUS_ERROR
        degraded_status = DEGRADED_STATUS_RISKY
        outcome_class = OUTCOME_READINESS_FAIL

    payload = {
        "check_name": "pre_open_canary",
        "result": overall,
        "ready_for_open": overall == RESULT_PASS,
        "checked_at": checked_at,
        "service_base_url": service_base_url,
        "quote_symbols": list(quote_symbols),
        "checks": checks,
        "warnings": warnings,
    }
    return annotate_artifact(
        payload,
        artifact_family=ARTIFACT_FAMILY_READINESS_CHECK,
        producer="backtester.pre_open_canary",
        generated_at=checked_at,
        known_at=checked_at,
        status=status,
        degraded_status=degraded_status,
        outcome_class=outcome_class,
        freshness={"check_count": len(checks)},
    )


def format_operator_text(payload: dict[str, Any]) -> str:
    lines = [
        f"Pre-open canary: {str(payload.get('result', 'unknown')).upper()}",
        (
            "Trading lane is ready for the open."
            if payload.get("ready_for_open")
            else "Trading lane is not fully ready for the open."
        ),
    ]
    for check in payload.get("checks") or []:
        if not isinstance(check, dict):
            continue
        lines.append(f"- {check.get('name')}: {str(check.get('result', 'unknown')).upper()}")
    warnings = payload.get("warnings") or []
    if warnings:
        lines.append("Warnings: " + ", ".join(str(item) for item in warnings[:4]))
    return "\n".join(lines)


def main() -> None:
    args = parse_args()
    quote_symbols = tuple(symbol.strip().upper() for symbol in str(args.quote_symbols).split(",") if symbol.strip())
    payload = build_canary_payload(
        service_base_url=args.service_base_url,
        quote_symbols=quote_symbols or DEFAULT_QUOTE_SYMBOLS,
        strategy_limit=int(args.strategy_limit),
        strategy_universe_size=int(args.strategy_universe_size),
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    text = format_operator_text(payload) if args.operator else json.dumps(payload, indent=2 if args.pretty else None, sort_keys=True)
    print(text)
    if args.require_pass and not bool(payload.get("ready_for_open")):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
