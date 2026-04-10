from __future__ import annotations

import os
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import requests

from decision_brain.multi_timeframe import build_multi_timeframe_context
from data.universe import GROWTH_WATCHLIST

SERVICE_BASE_URL = os.getenv("MARKET_DATA_SERVICE_URL", "http://127.0.0.1:3033").rstrip("/")
TAPE_SYMBOLS = ("SPY", "QQQ", "IWM", "DIA")


def _is_regular_market_session(now: datetime | None = None) -> bool:
    current = now or datetime.now(ZoneInfo("America/New_York"))
    if current.weekday() >= 5:
        return False
    minutes = current.hour * 60 + current.minute
    return (9 * 60 + 30) <= minutes <= (16 * 60)


def _quote_batch(
    symbols: list[str],
    *,
    service_base_url: str,
    chunk_size: int = 120,
) -> tuple[list[dict[str, Any]], list[str], dict[str, Any]]:
    items: list[dict[str, Any]] = []
    warnings: list[str] = []
    provider_modes: list[str] = []
    provider_mode_reasons: list[str] = []
    fallback_engaged = False
    for start in range(0, len(symbols), chunk_size):
        chunk = symbols[start:start + chunk_size]
        try:
            response = requests.get(
                f"{service_base_url}/market-data/quote/batch",
                params={"symbols": ",".join(chunk), "subsystem": "intraday_breadth"},
                timeout=15,
            )
            response.raise_for_status()
            payload = response.json() or {}
        except Exception as exc:
            warnings.append(f"quote_batch_failed[{start}:{start + len(chunk)}]: {exc}")
            continue
        provider_mode = str(payload.get("providerMode", "") or "").strip()
        if provider_mode:
            provider_modes.append(provider_mode)
        provider_mode_reason = str(payload.get("providerModeReason", "") or "").strip()
        if provider_mode_reason:
            provider_mode_reasons.append(provider_mode_reason)
        fallback_engaged = fallback_engaged or bool(payload.get("fallbackEngaged", False))
        chunk_items = payload.get("data", {}).get("items", []) if isinstance(payload.get("data"), dict) else []
        if isinstance(chunk_items, list):
            items.extend([item for item in chunk_items if isinstance(item, dict)])
    unique_modes = sorted({mode for mode in provider_modes if mode})
    provider_mode = unique_modes[0] if len(unique_modes) == 1 else "multi_mode" if unique_modes else "unavailable"
    provider_mode_reason = provider_mode_reasons[0] if provider_mode_reasons else ""
    if len(unique_modes) > 1:
        provider_mode_reason = "Intraday breadth used more than one provider mode across quote batches."
    return items, warnings, {
        "provider_mode": provider_mode,
        "fallback_engaged": fallback_engaged,
        "provider_mode_reason": provider_mode_reason,
    }


def _load_base_universe_symbols(*, service_base_url: str) -> tuple[list[str], str | None]:
    try:
        response = requests.get(f"{service_base_url}/market-data/universe/base", timeout=10)
        response.raise_for_status()
        payload = response.json() or {}
    except Exception as exc:
        return [], f"base_universe_failed: {exc}"
    data = payload.get("data", {}) if isinstance(payload.get("data"), dict) else {}
    symbols = data.get("symbols", [])
    if not isinstance(symbols, list):
        return [], "base_universe_invalid"
    cleaned = []
    seen = set()
    for symbol in symbols:
        value = str(symbol or "").strip().upper()
        if value and value not in seen:
            seen.add(value)
            cleaned.append(value)
    return cleaned, None


def _collect_change_map(items: list[dict[str, Any]]) -> tuple[dict[str, float], list[str]]:
    values: dict[str, float] = {}
    warnings: list[str] = []
    for item in items:
        symbol = str(item.get("symbol", "")).strip().upper()
        data = item.get("data", {}) if isinstance(item.get("data"), dict) else {}
        change_pct = data.get("changePercent")
        if isinstance(change_pct, str):
            try:
                change_pct = float(change_pct)
            except Exception:
                change_pct = None
        if not symbol:
            continue
        if isinstance(change_pct, (int, float)):
            values[symbol] = float(change_pct)
        else:
            warnings.append(f"{symbol}: missing changePercent")
    return values, warnings


def _breadth_stats(symbols: list[str], change_map: dict[str, float]) -> dict[str, Any]:
    valid = [change_map[symbol] for symbol in symbols if symbol in change_map]
    up = sum(1 for value in valid if value > 0)
    down = sum(1 for value in valid if value < 0)
    flat = sum(1 for value in valid if value == 0)
    total = len(valid)
    pct_up = (up / total) if total else 0.0
    pct_down = (down / total) if total else 0.0
    advance_decline_ratio = (up / down) if down > 0 else (float(up) if up > 0 else 0.0)
    return {
        "total": total,
        "up": up,
        "down": down,
        "flat": flat,
        "pct_up": pct_up,
        "pct_down": pct_down,
        "advance_decline_ratio": advance_decline_ratio,
    }


def _evaluate_override(
    *,
    tape: dict[str, float],
    sp500: dict[str, Any],
    growth: dict[str, Any],
    warnings: list[str],
    multi_timeframe: dict[str, Any],
) -> tuple[str, str, str]:
    if warnings:
        return "unavailable", "live breadth inputs are stale or incomplete", "no_intraday_authority"
    if sp500["total"] == 0 or growth["total"] == 0:
        return "unavailable", "live breadth inputs are missing", "no_intraday_authority"
    spy = float(tape.get("SPY", 0.0))
    qqq = float(tape.get("QQQ", 0.0))
    if spy >= float(os.getenv("TRADING_INTRADAY_BREADTH_SPY_MIN_PCT", "1.5")) and qqq >= float(os.getenv("TRADING_INTRADAY_BREADTH_QQQ_MIN_PCT", "2.0")):
        if sp500["pct_up"] >= float(os.getenv("TRADING_INTRADAY_BREADTH_SP500_PCT_UP_MIN", "0.70")) and growth["pct_up"] >= float(os.getenv("TRADING_INTRADAY_BREADTH_GROWTH_PCT_UP_MIN", "0.65")):
            return "selective-buy", "broad intraday rally with strong participation despite the defensive daily regime", str(multi_timeframe.get("authority_cap") or "selective_buy")
        return "watch_only", "indexes are strong, but breadth is not broad enough to confirm a selective-buy posture", "watch_only"
    if sp500["pct_up"] >= 0.60 or growth["pct_up"] >= 0.60:
        return "watch_only", "breadth is constructive, but tape strength is not strong enough for selective-buy authority", "watch_only"
    return "inactive", "index strength is not strong enough to relax correction-mode discipline", "inactive"


def build_intraday_breadth_snapshot(
    *,
    service_base_url: str = SERVICE_BASE_URL,
    now: datetime | None = None,
) -> dict[str, Any]:
    if os.getenv("TRADING_INTRADAY_BREADTH_ENABLED", "1") in {"0", "false", "False"}:
        return {
            "status": "disabled",
            "override_state": "inactive",
            "override_reason": "intraday breadth override is disabled",
            "authority_cap": "inactive",
            "session_phase": "CLOSED",
            "warnings": [],
        }
    session_now = now or datetime.now(ZoneInfo("America/New_York"))
    if not _is_regular_market_session(session_now):
        return {
            "status": "inactive",
            "override_state": "inactive",
            "override_reason": "outside regular market session",
            "authority_cap": "inactive",
            "session_phase": "CLOSED" if session_now.weekday() >= 5 else "OFF_HOURS",
            "warnings": [],
        }

    base_symbols, base_error = _load_base_universe_symbols(service_base_url=service_base_url)
    growth_symbols = sorted({str(symbol).strip().upper() for symbol in GROWTH_WATCHLIST if str(symbol).strip()})
    quote_symbols = sorted({*TAPE_SYMBOLS, *base_symbols, *growth_symbols})
    batch_result = _quote_batch(quote_symbols, service_base_url=service_base_url)
    if len(batch_result) == 3:
        items, batch_warnings, provider_meta = batch_result
    else:
        items, batch_warnings = batch_result
        provider_meta = {
            "provider_mode": "unknown",
            "fallback_engaged": False,
            "provider_mode_reason": "",
        }
    change_map, change_warnings = _collect_change_map(items)

    tape = {symbol: change_map.get(symbol) for symbol in TAPE_SYMBOLS if symbol in change_map}
    sp500 = _breadth_stats(base_symbols, change_map)
    growth = _breadth_stats(growth_symbols, change_map)

    warnings = []
    if base_error:
        warnings.append(base_error)
    warnings.extend(batch_warnings)

    min_valid_ratio = float(os.getenv("TRADING_INTRADAY_BREADTH_MIN_VALID_SYMBOL_RATIO", "0.60"))
    if base_symbols and (sp500["total"] / max(len(base_symbols), 1)) < min_valid_ratio:
        warnings.append("s_and_p_coverage_too_low")
    if growth_symbols and (growth["total"] / max(len(growth_symbols), 1)) < min_valid_ratio:
        warnings.append("growth_coverage_too_low")

    multi_timeframe = build_multi_timeframe_context(
        regime_label="correction",
        tape=tape,
        weekly_confirmed=False,
        daily_confirmed=sp500["pct_up"] >= 0.70,
    )
    override_state, override_reason, authority_cap = _evaluate_override(
        tape=tape,
        sp500=sp500,
        growth=growth,
        warnings=warnings,
        multi_timeframe=multi_timeframe,
    )
    return {
        "status": "degraded" if warnings else "ok",
        "override_state": override_state,
        "override_reason": override_reason,
        "authority_cap": authority_cap,
        "session_phase": "OPEN",
        "tape": tape,
        "s_and_p": sp500,
        "growth": growth,
        "multi_timeframe_context": multi_timeframe,
        "strong_up_day_flag": bool(sp500["pct_up"] >= 0.80),
        "narrow_rally_flag": bool(
            float(tape.get("SPY", 0.0) or 0.0) >= 1.0 and sp500["pct_up"] < 0.60
        ),
        "provider_mode": str(provider_meta.get("provider_mode", "unknown") or "unknown"),
        "fallback_engaged": bool(provider_meta.get("fallback_engaged", False)),
        "provider_mode_reason": str(provider_meta.get("provider_mode_reason", "") or ""),
        "warnings": warnings,
    }


def render_intraday_breadth_lines(snapshot: dict[str, Any] | None) -> list[str]:
    if not snapshot:
        return []
    override_state = str(snapshot.get("override_state", "inactive"))
    if override_state == "inactive" and str(snapshot.get("override_reason", "")).startswith("outside regular market session"):
        return []
    lines: list[str] = []
    tape = snapshot.get("tape", {}) if isinstance(snapshot.get("tape"), dict) else {}
    sp500 = snapshot.get("s_and_p", {}) if isinstance(snapshot.get("s_and_p"), dict) else {}
    growth = snapshot.get("growth", {}) if isinstance(snapshot.get("growth"), dict) else {}
    if sp500:
        lines.append(
            "Intraday breadth: "
            f"S&P {int(round(float(sp500.get('pct_up', 0.0)) * 100))}% up"
            f" ({int(sp500.get('up', 0))}/{int(sp500.get('total', 0))}) | "
            f"growth basket {int(round(float(growth.get('pct_up', 0.0)) * 100))}% up"
            f" ({int(growth.get('up', 0))}/{int(growth.get('total', 0))})"
        )
    if tape:
        bits = [f"{symbol} {float(value):+0.2f}%" for symbol, value in tape.items() if isinstance(value, (int, float))]
        if bits:
            lines.append("Intraday tape: " + " | ".join(bits))
    reason = str(snapshot.get("override_reason", "")).strip()
    if override_state == "selective-buy":
        lines.append(f"Intraday override: selective-buy active — {reason}")
    elif override_state == "watch_only":
        lines.append(f"Intraday override: watch-only — {reason}")
    elif override_state == "unavailable":
        lines.append(f"Intraday override: unavailable — {reason}")
    else:
        lines.append(f"Intraday override: inactive — {reason}")
    return lines
