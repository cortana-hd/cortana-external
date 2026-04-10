#!/usr/bin/env python3
"""Build a compact market-brief snapshot for external cron consumers."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import requests

from advisor import TradingAdvisor
from decision_brain.surfaces import (
    build_market_brief_decision_bundle,
    build_surface_research_runtime,
    load_shadow_inputs,
)
from data.intraday_breadth import build_intraday_breadth_snapshot
from data.leader_baskets import load_leader_priority_symbols
from data.market_regime import MarketRegime, MarketStatus
from data.polymarket_context import latest_report_json_path, load_structured_context
from evaluation.artifact_contracts import ARTIFACT_FAMILY_MARKET_BRIEF, annotate_artifact
from evaluation.failure_taxonomy import classify_market_brief_outcome
from operator_surfaces.decision_contract import build_market_brief_operator_payload
from operator_surfaces.mission_control import emit_decision_trace
from operator_surfaces.renderers import describe_operator_outcome, render_operator_payload

TAPE_SYMBOLS = ("SPY", "QQQ", "IWM", "DIA", "GLD", "TLT")
SERVICE_BASE_URL = os.getenv("MARKET_DATA_SERVICE_URL", "http://127.0.0.1:3033").rstrip("/")
EXCLUDED_FOCUS_SYMBOLS = set(TAPE_SYMBOLS) | {"ARKK", "XLU", "XLV", "XLE", "JETS"}
REGIME_CACHE_PATH = Path(os.getenv("MARKET_REGIME_CACHE_PATH", ".cache/market_regime_snapshot_SPY.json")).expanduser()
MARKET_DATA_CACHE_DIR = Path(os.getenv("MARKET_DATA_CACHE_DIR", ".cache/market_data")).expanduser()
MARKET_DATA_LAUNCHD_LABEL = os.getenv("MARKET_DATA_LAUNCHD_LABEL", "com.cortana.fitness-service")
MARKET_BRIEF_PRODUCER = "backtester.market_brief_snapshot"


def classify_posture(status: MarketStatus, breadth_snapshot: dict[str, Any] | None = None) -> dict[str, str]:
    override_state = str((breadth_snapshot or {}).get("override_state", "") or "").strip().lower()
    if status.regime == MarketRegime.CORRECTION:
        if override_state == "selective-buy":
            return {
                "action": "BUY",
                "reason": (
                    "Daily regime is still defensive, but intraday breadth is broad enough "
                    "to allow only tightly selective buys."
                ),
            }
        return {
            "action": "NO_BUY",
            "reason": status.notes or "Market is defensive. Stand aside on fresh buys.",
        }
    if status.regime in {MarketRegime.UPTREND_UNDER_PRESSURE, MarketRegime.RALLY_ATTEMPT}:
        return {
            "action": "WATCH",
            "reason": status.notes or "Market is not broken, but follow-through is not strong enough for aggression.",
        }
    if status.position_sizing >= 0.75:
        return {
            "action": "BUY",
            "reason": status.notes or "Trend is supportive enough to buy selective strength.",
        }
    return {
        "action": "WATCH",
        "reason": status.notes or "Trend is improving, but stay selective until strength broadens.",
    }


def summarize_macro(report: dict[str, Any] | None) -> dict[str, Any]:
    if not report:
        return {
            "state": "unknown",
            "summary_line": "Macro overlay unavailable; lean on the tape and market regime first.",
            "theme_titles": [],
            "focus_tickers": [],
            "generated_at": None,
            "freshness_hours": None,
        }

    summary = report.get("summary", {}) if isinstance(report.get("summary"), dict) else {}
    divergence = summary.get("divergence", {}) if isinstance(summary.get("divergence"), dict) else {}
    highlights = summary.get("themeHighlights", []) if isinstance(summary.get("themeHighlights"), list) else []
    titles: list[str] = []
    focus: list[str] = []
    for item in highlights[:3]:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title", "")).strip()
        if title:
            titles.append(title)
        for ticker in item.get("watchTickers", []) if isinstance(item.get("watchTickers"), list) else []:
            symbol = str(ticker).strip().upper()
            if symbol and symbol not in focus:
                focus.append(symbol)

    generated_at = str(report.get("metadata", {}).get("generatedAt", "")).strip()
    freshness_hours = None
    if generated_at:
        try:
            dt = datetime.fromisoformat(generated_at.replace("Z", "+00:00"))
            freshness_hours = round(max((datetime.now(UTC) - dt).total_seconds(), 0.0) / 3600.0, 2)
        except Exception:
            freshness_hours = None

    conviction = str(summary.get("conviction", "")).strip() or "unknown"
    divergence_summary = str(divergence.get("summary", "")).strip() or "No divergence read available."
    if titles:
        summary_line = f"Polymarket {conviction}; {divergence_summary} Top themes: {', '.join(titles[:3])}."
    else:
        summary_line = f"Polymarket {conviction}; {divergence_summary}"
    return {
        "state": str(divergence.get("state", "")).strip() or "unknown",
        "conviction": conviction,
        "summary_line": summary_line,
        "theme_titles": titles,
        "focus_tickers": focus,
        "generated_at": generated_at or None,
        "freshness_hours": freshness_hours,
    }


def fetch_tape_quotes(service_base_url: str = SERVICE_BASE_URL, symbols: tuple[str, ...] = TAPE_SYMBOLS) -> dict[str, Any]:
    url = f"{service_base_url}/market-data/quote/batch"
    try:
        response = requests.get(url, params={"symbols": ",".join(symbols), "subsystem": "market_brief_tape"}, timeout=12)
        response.raise_for_status()
        payload = response.json() or {}
    except Exception as exc:
        return {
            "status": "error",
            "summary_line": f"Tape unavailable from TS market-data service: {exc}",
            "risk_tone": "unknown",
            "primary_source": "unavailable",
            "provider_mode": "unavailable",
            "fallback_engaged": False,
            "provider_mode_reason": "Tape could not produce a provider mode.",
            "symbols": [],
            "warnings": [f"tape_fetch_failed: {exc}"],
        }

    items = payload.get("data", {}).get("items", []) if isinstance(payload.get("data"), dict) else []
    normalized: list[dict[str, Any]] = []
    sources: list[str] = []
    warnings: list[str] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        data = item.get("data", {}) if isinstance(item.get("data"), dict) else {}
        symbol = str(item.get("symbol", data.get("symbol", ""))).strip().upper()
        source = str(item.get("source", "service")).strip() or "service"
        status = str(item.get("status", "ok")).strip() or "ok"
        degraded_reason = str(item.get("degradedReason", "") or "").strip()
        change_pct = data.get("changePercent")
        if isinstance(change_pct, str):
            try:
                change_pct = float(change_pct)
            except Exception:
                change_pct = None
        normalized.append(
            {
                "symbol": symbol,
                "source": source,
                "status": status,
                "price": data.get("price"),
                "change_percent": change_pct,
                "timestamp": data.get("timestamp"),
                "degraded_reason": degraded_reason or None,
            }
        )
        sources.append(source)
        if status != "ok" and degraded_reason:
            warnings.append(f"{symbol}: {degraded_reason}")
    return {
        "status": "degraded" if warnings else "ok",
        "summary_line": build_tape_summary(normalized),
        "risk_tone": classify_tape_risk(normalized),
        "primary_source": primary_source(sources),
        "provider_mode": str(payload.get("providerMode", "unknown") or "unknown"),
        "fallback_engaged": bool(payload.get("fallbackEngaged", False)),
        "provider_mode_reason": str(payload.get("providerModeReason", "") or ""),
        "symbols": normalized,
        "warnings": warnings,
    }


def classify_tape_risk(quotes: list[dict[str, Any]]) -> str:
    lookup = {str(item.get("symbol", "")).upper(): item for item in quotes}
    equity_changes = [lookup.get(symbol, {}).get("change_percent") for symbol in ("SPY", "QQQ", "IWM", "DIA")]
    equity_changes = [value for value in equity_changes if isinstance(value, (int, float))]
    hedge_changes = [lookup.get(symbol, {}).get("change_percent") for symbol in ("GLD", "TLT")]
    hedge_changes = [value for value in hedge_changes if isinstance(value, (int, float))]
    eq_avg = sum(equity_changes) / len(equity_changes) if equity_changes else 0.0
    hedge_avg = sum(hedge_changes) / len(hedge_changes) if hedge_changes else 0.0
    if eq_avg >= 0.4 and hedge_avg <= 0.0:
        return "risk_on"
    if eq_avg <= -0.4 and hedge_avg >= 0.0:
        return "defensive"
    if eq_avg <= 0.0 and hedge_avg > 0.0:
        return "cautious"
    return "mixed"


def build_tape_summary(quotes: list[dict[str, Any]]) -> str:
    lookup = {str(item.get("symbol", "")).upper(): item for item in quotes}

    def describe(symbol: str) -> str:
        quote = lookup.get(symbol)
        if not quote:
            return f"{symbol} unavailable"
        change_pct = quote.get("change_percent")
        if isinstance(change_pct, (int, float)):
            if change_pct >= 0.15:
                tone = "firm"
            elif change_pct <= -0.15:
                tone = "weak"
            else:
                tone = "flat"
            return f"{symbol} {tone} ({change_pct:+.2f}%)"
        return f"{symbol} stale"

    tone = classify_tape_risk(quotes).replace("_", " ")
    return f"{describe('SPY')}; {describe('QQQ')}; {describe('IWM')}; {describe('GLD')}. Risk tone {tone}."


def primary_source(sources: list[str]) -> str:
    counts: dict[str, int] = {}
    for source in sources:
        counts[source] = counts.get(source, 0) + 1
    if not counts:
        return "unknown"
    return sorted(counts.items(), key=lambda item: (-item[1], item[0]))[0][0]


def get_market_session_phase(now: datetime | None = None) -> str:
    current = now or datetime.now(ZoneInfo("America/New_York"))
    if current.weekday() >= 5:
        return "CLOSED"
    minutes = current.hour * 60 + current.minute
    if minutes < 9 * 60 + 30:
        return "PREMARKET"
    if minutes < 16 * 60:
        return "OPEN"
    if minutes < 20 * 60:
        return "AFTER_HOURS"
    return "CLOSED"


def _read_cached_tape_symbol(symbol: str) -> dict[str, Any] | None:
    for period in ("6mo", "1y"):
        safe_symbol = "".join(c if c.isalnum() else "_" for c in symbol.upper())
        safe_period = "".join(c if c.isalnum() else "_" for c in period)
        path = MARKET_DATA_CACHE_DIR / f"{safe_symbol}_{safe_period}.json"
        if not path.exists():
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            generated = datetime.fromisoformat(str(payload.get("generated_at_utc", "")).replace("Z", "+00:00"))
            age_seconds = max((datetime.now(UTC) - generated).total_seconds(), 0.0)
            max_age_hours = float(os.getenv("MARKET_BRIEF_TAPE_FALLBACK_MAX_AGE_HOURS", "72.0"))
            if age_seconds > max_age_hours * 3600.0:
                continue
            rows = payload.get("rows") or []
            if len(rows) < 2:
                continue
        except Exception:
            continue
        previous_close = float(rows[-2]["Close"])
        latest_close = float(rows[-1]["Close"])
        change_percent = ((latest_close / previous_close) - 1.0) * 100.0 if previous_close > 0 else 0.0
        timestamp = rows[-1]["date"]
        return {
            "symbol": symbol,
            "source": "cache",
            "status": "degraded",
            "price": latest_close,
            "change_percent": change_percent,
            "timestamp": str(timestamp),
            "degraded_reason": (
                f"Using previous completed-session close from cached {period} history "
                f"({age_seconds / 3600.0:.1f}h old, original_source={payload.get('source', 'unknown')})."
            ),
        }
    return None


def load_cached_tape_quotes(symbols: tuple[str, ...] = TAPE_SYMBOLS) -> dict[str, Any]:
    normalized = [item for item in (_read_cached_tape_symbol(symbol) for symbol in symbols) if item]
    if not normalized:
        return {
            "status": "error",
            "summary_line": "Previous-session tape fallback unavailable.",
            "risk_tone": "unknown",
            "primary_source": "unavailable",
            "provider_mode": "unavailable",
            "fallback_engaged": False,
            "provider_mode_reason": "Previous-session tape fallback could not produce a provider mode.",
            "symbols": [],
            "warnings": ["tape_cached_fallback_unavailable"],
        }
    return {
        "status": "degraded",
        "summary_line": build_tape_summary(normalized) + " Previous session fallback.",
        "risk_tone": classify_tape_risk(normalized),
        "primary_source": "cache",
        "provider_mode": "cache_fallback",
        "fallback_engaged": True,
        "provider_mode_reason": "Tape used the previous-session cache fallback lane.",
        "symbols": normalized,
        "warnings": ["tape_previous_session_fallback"],
    }


def build_focus_names(leader_symbols: list[str], macro_focus: list[str], limit: int = 3) -> dict[str, Any]:
    names: list[str] = []
    sources: list[str] = []
    for symbol in leader_symbols:
        if symbol and symbol not in EXCLUDED_FOCUS_SYMBOLS and symbol not in names:
            names.append(symbol)
            sources.append("leader_priority")
        if len(names) >= limit:
            break
    if len(names) < limit:
        for symbol in macro_focus:
            if symbol and symbol not in EXCLUDED_FOCUS_SYMBOLS and symbol not in names:
                names.append(symbol)
                sources.append("polymarket")
            if len(names) >= limit:
                break
    unique_sources: list[str] = []
    for source in sources:
        if source not in unique_sources:
            unique_sources.append(source)
    if names:
        if "leader_priority" in sources and "polymarket" in sources:
            reason = "Leader-priority names came first, then macro watchlist names filled the remaining slots."
        elif "leader_priority" in sources:
            reason = "Focus names came from the leader-priority list."
        else:
            reason = "Focus names came from the Polymarket macro watchlist."
    else:
        reason = "No focus names qualified."
    return {"symbols": names, "sources": unique_sources, "reason": reason}


def _format_age_seconds(value: float | None) -> str:
    if value is None:
        return "unknown age"
    if value < 3600:
        return f"{value / 60.0:.0f}m old"
    return f"{value / 3600.0:.1f}h old"


def _format_age_hours(value: float | None) -> str:
    if value is None:
        return "unknown age"
    if value < 1.0:
        return f"{value * 60.0:.0f}m old"
    return f"{value:.1f}h old"


def _extract_underlying_regime_age(regime: dict[str, Any]) -> str | None:
    text_candidates = [
        str(regime.get("notes") or ""),
        str(regime.get("degraded_reason") or ""),
    ]
    for text in text_candidates:
        if not text:
            continue
        match = re.search(r"age=([0-9]+(?:\.[0-9]+)?[smhd])", text)
        if match:
            return match.group(1)
        match = re.search(r"\(([0-9]+(?:\.[0-9]+)?[smhd]) old", text)
        if match:
            return match.group(1)
    return None


def is_local_service_base_url(service_base_url: str) -> bool:
    host = (urlparse(service_base_url).hostname or "").strip().lower()
    return host in {"127.0.0.1", "localhost"}


def probe_market_data_service(service_base_url: str = SERVICE_BASE_URL) -> dict[str, Any]:
    url = f"{service_base_url.rstrip('/')}/market-data/ready"
    try:
        response = requests.get(url, timeout=4)
        return {
            "reachable": True,
            "status_code": response.status_code,
            "reason": None if response.status_code < 500 else f"service returned HTTP {response.status_code} from /market-data/ready",
        }
    except Exception as exc:
        return {"reachable": False, "status_code": None, "reason": str(exc)}


def maybe_self_heal_market_data_service(service_base_url: str = SERVICE_BASE_URL) -> dict[str, Any]:
    if os.getenv("MARKET_DATA_SELF_HEAL", "1") != "1":
        return {"attempted": False, "recovered": False, "reason": None}
    if not is_local_service_base_url(service_base_url):
        return {"attempted": False, "recovered": False, "reason": None}

    initial = probe_market_data_service(service_base_url)
    if initial["reachable"] and int(initial.get("status_code") or 0) < 500:
        return {"attempted": False, "recovered": False, "reason": None}

    launchd_target = f"gui/{os.getuid()}/{MARKET_DATA_LAUNCHD_LABEL}"
    try:
        restart = subprocess.run(
            ["launchctl", "kickstart", "-k", launchd_target],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
    except Exception as exc:
        reason = initial["reason"] or "fresh live market data is temporarily unavailable"
        return {
            "attempted": True,
            "recovered": False,
            "reason": f"{reason}. Automatic restart attempt failed: {exc}",
        }

    if restart.returncode != 0:
        reason = initial["reason"] or "fresh live market data is temporarily unavailable"
        stderr = (restart.stderr or "").strip() or (restart.stdout or "").strip()
        if stderr:
            return {
                "attempted": True,
                "recovered": False,
                "reason": f"{reason}. Automatic restart attempt failed: {stderr}",
            }
        return {
            "attempted": True,
            "recovered": False,
            "reason": f"{reason}. Automatic restart attempt failed.",
        }

    retries = max(1, int(os.getenv("MARKET_DATA_SELF_HEAL_PROBE_RETRIES", "4")))
    wait_seconds = max(1.0, float(os.getenv("MARKET_DATA_SELF_HEAL_WAIT_SECONDS", "2.0")))
    for _ in range(retries):
        time.sleep(wait_seconds)
        probe = probe_market_data_service(service_base_url)
        if probe["reachable"] and int(probe.get("status_code") or 0) < 500:
            return {"attempted": True, "recovered": True, "reason": None}

    reason = initial["reason"] or "fresh live market data is temporarily unavailable"
    return {
        "attempted": True,
        "recovered": False,
        "reason": f"{reason}. Automatic restart did not restore the local market-data service.",
    }


def humanize_market_issue(reason: str | None) -> str | None:
    text = str(reason or "").strip()
    if not text:
        return None
    lowered = text.lower()
    if "cooldown" in lowered:
        return "Schwab market data is in a brief cooldown"
    if "token" in lowered and "refresh" in lowered:
        return "Schwab token refresh is failing"
    if "401" in lowered or "403" in lowered or "auth" in lowered:
        return "Schwab authentication needs attention"
    if "failed to establish a new connection" in lowered or "connection refused" in lowered:
        return "the local market-data service is unreachable"
    if "automatic restart did not restore the local market-data service" in lowered:
        return "the local market-data service did not recover after an automatic restart attempt"
    if "automatic restart attempt failed" in lowered:
        return "the local market-data service could not be restarted automatically"
    if "timed out" in lowered or "timeout" in lowered:
        return "the live market-data request timed out"
    if "service unavailable" in lowered or "503" in lowered:
        return "the live market-data service is temporarily unavailable"
    return "fresh live market data is temporarily unavailable"


def build_operator_summary(
    *,
    session_phase: str,
    posture: dict[str, str],
    regime: dict[str, Any],
    tape: dict[str, Any],
    macro: dict[str, Any],
    breadth: dict[str, Any],
    focus: dict[str, Any],
    research_runtime: dict[str, Any] | None = None,
    shadow_review: dict[str, Any] | None = None,
    narrative_overlay: dict[str, Any] | None = None,
) -> dict[str, Any]:
    tape_source = str(tape.get("primary_source") or "unknown")
    tape_mode = str(tape.get("provider_mode") or "unknown")
    breadth_state = str(breadth.get("override_state") or "unknown")
    breadth_mode = str(breadth.get("provider_mode") or "unknown")
    macro_age = _format_age_hours(macro.get("freshness_hours"))
    focus_names = focus.get("symbols") or []
    if focus_names:
        focus_line = f"{', '.join(focus_names)}. {focus.get('reason', '')}".strip()
    else:
        focus_line = "None yet. No names qualified for focus."

    if tape_mode == "alpaca_fallback":
        tape_read = "Tape is using the declared Alpaca fallback lane, not the live Schwab quote lane."
    elif tape_source == "cache":
        tape_read = "Tape is using previous-session fallback data, not fresh live quotes."
    elif tape_source == "unavailable":
        tape_read = "Tape is unavailable right now."
    else:
        tape_read = "Tape is using fresh live quotes."

    if breadth_mode == "alpaca_fallback":
        breadth_read = (
            f"Intraday breadth is using the declared Alpaca fallback lane because "
            f"{breadth.get('override_reason', 'the live Schwab quote lane is unavailable')}."
        )
    elif breadth_state == "inactive":
        breadth_read = f"Intraday breadth is inactive because {breadth.get('override_reason', 'the market is not in a live session')}."
    elif breadth_state == "unavailable":
        breadth_read = f"Intraday breadth is unavailable because {breadth.get('override_reason', 'live breadth inputs are missing')}."
    elif breadth_state == "selective-buy":
        breadth_read = "Intraday breadth is strong enough to allow tightly selective buys."
    elif breadth_state == "watch_only":
        breadth_read = "Intraday breadth is constructive, but only supports watch-only posture."
    else:
        breadth_read = f"Intraday breadth state: {breadth_state}."

    regime_status = str(regime.get("status") or "unknown")
    regime_source = str(regime.get("data_source") or "unknown")
    regime_mode = str(regime.get("provider_mode") or "unknown")
    underlying_age = _extract_underlying_regime_age(regime)
    if regime_status == "degraded" and regime_source == "unknown":
        regime_read = (
            f"Market regime is {regime['display']}. Fresh live regime is unavailable; "
            "using conservative emergency fallback."
        )
    elif regime_mode == "alpaca_fallback":
        regime_read = f"Market regime is {regime['display']} using the declared Alpaca fallback lane."
    elif regime_source == "cache":
        if underlying_age:
            regime_read = (
                f"Market regime is {regime['display']} using cached history "
                f"(underlying inputs ~{underlying_age} old)."
            )
        else:
            regime_age = _format_age_seconds(regime.get("snapshot_age_seconds"))
            regime_read = f"Market regime is {regime['display']} using cached snapshot ({regime_age})."
    else:
        regime_age = _format_age_seconds(regime.get("snapshot_age_seconds"))
        regime_read = f"Market regime is {regime['display']} ({regime_age})."

    research_summary = (research_runtime or {}).get("summary", {}) if isinstance(research_runtime, dict) else {}
    research_read = str(
        research_summary.get("summary_line") or "Research plane has no hot-path artifacts yet; decisions are not blocked."
    ).strip()

    narrative_priority = []
    if isinstance(narrative_overlay, dict):
        narrative_priority = [str(symbol).strip().upper() for symbol in (narrative_overlay.get("priority_symbols") or []) if str(symbol).strip()]
        crowding = narrative_overlay.get("crowding_warnings") or []
        confidence_nudges = narrative_overlay.get("confidence_nudges") or []
        if crowding:
            crowded_symbols = [str(item.get("symbol") or "").strip().upper() for item in crowding[:3] if str(item.get("symbol") or "").strip()]
            if crowded_symbols:
                narrative_read = (
                    f"Narrative overlay is bounded; crowding is suppressing confidence on {', '.join(crowded_symbols)}."
                )
            else:
                narrative_read = "Narrative overlay is bounded and crowding-aware."
        elif narrative_priority:
            narrative_read = f"Narrative overlay is prioritizing {', '.join(narrative_priority[:3])} for discovery only."
        elif confidence_nudges:
            nudged = []
            for item in confidence_nudges:
                symbol = str(item.get("symbol") or "").strip().upper()
                if symbol and symbol not in nudged:
                    nudged.append(symbol)
            if nudged:
                narrative_read = (
                    f"Narrative overlay is nudging confidence toward {', '.join(nudged[:3])} from bounded theme support."
                )
            else:
                narrative_read = "Narrative overlay is quiet; no bounded discovery nudges are active."
        else:
            narrative_read = "Narrative overlay is quiet; no bounded discovery nudges are active."
    else:
        narrative_read = "Narrative overlay is unavailable."

    shadow_summary = (shadow_review or {}).get("summary_line", "") if isinstance(shadow_review, dict) else ""
    if shadow_summary:
        shadow_read = shadow_summary
    else:
        shadow_read = "Shadow review unavailable."

    headline = f"{session_phase}: {posture['action']} | {regime['display']} | size {regime['position_sizing_pct']:.0f}%"
    return {
        "headline": headline,
        "what_this_means": posture["reason"],
        "read_this_as": {
            "session": f"This is an {session_phase.lower().replace('_', ' ')} snapshot.",
            "regime": regime_read,
            "tape": tape_read,
            "macro": f"Macro overlay is {macro.get('state', 'unknown')} ({macro_age}).",
            "breadth": breadth_read,
            "narrative": narrative_read,
            "research": research_read,
            "shadow": shadow_read,
            "focus": focus_line,
        },
    }


def describe_operator_status(payload: dict[str, Any]) -> str:
    operator_payload = payload.get("operator_payload")
    if isinstance(operator_payload, dict):
        return describe_operator_outcome(operator_payload)
    return describe_operator_outcome(payload)


def normalize_regime(status: MarketStatus) -> dict[str, Any]:
    return {
        "label": status.regime.value,
        "display": status.regime.value.replace("_", " ").upper(),
        "position_sizing_pct": round(status.position_sizing * 100, 1),
        "distribution_days": status.distribution_days,
        "regime_score": status.regime_score,
        "notes": status.notes,
        "status": status.status,
        "data_source": status.data_source,
        "provider_mode": status.provider_mode,
        "fallback_engaged": status.fallback_engaged,
        "provider_mode_reason": status.provider_mode_reason or None,
        "degraded_reason": status.degraded_reason or None,
        "snapshot_age_seconds": status.snapshot_age_seconds,
    }


def load_last_known_regime_status(
    cache_path: Path = REGIME_CACHE_PATH,
    *,
    max_age_hours: float | None = None,
    session_baseline: bool = False,
) -> MarketStatus | None:
    if not cache_path.exists():
        return None
    try:
        payload = json.loads(cache_path.read_text(encoding="utf-8"))
        market_status = payload.get("market_status", {})
        generated_at = datetime.fromisoformat(str(payload.get("generated_at_utc", "")).replace("Z", "+00:00"))
        age_seconds = max((datetime.now(UTC) - generated_at).total_seconds(), 0.0)
        if max_age_hours is not None and age_seconds > max_age_hours * 3600.0:
            return None
        regime = MarketRegime(str(market_status.get("regime", MarketRegime.CORRECTION.value)))
        stale_hours = age_seconds / 3600.0
        return MarketStatus(
            regime=regime,
            distribution_days=int(market_status.get("distribution_days", 0)),
            last_ftd=str(market_status.get("last_ftd") or ""),
            trend_direction=str(market_status.get("trend_direction", "unknown")),
            position_sizing=float(market_status.get("position_sizing", 0.0)),
            notes=(
                str(market_status.get("notes", "")).strip()
                if session_baseline
                else f"{market_status.get('notes', '')} [LAST KNOWN SNAPSHOT {stale_hours:.1f}h old]".strip()
            ),
            data_source=str(market_status.get("data_source", "cache")),
            provider_mode=str(market_status.get("provider_mode", "cache_fallback")),
            fallback_engaged=bool(market_status.get("fallback_engaged", True)),
            provider_mode_reason=str(
                market_status.get("provider_mode_reason", "Market regime used the cached snapshot fallback lane.")
            ),
            status="ok" if session_baseline else "degraded",
            degraded_reason=(
                ""
                if session_baseline
                else f"Using last known market snapshot from {generated_at.isoformat()} because live regime refresh failed."
            ),
            snapshot_age_seconds=age_seconds,
            next_action="" if session_baseline else "Retry live market regime refresh after provider recovery.",
            regime_score=int(market_status.get("regime_score", 0)),
            drawdown_pct=float(market_status.get("drawdown_pct", 0.0)),
            recent_return_pct=float(market_status.get("recent_return_pct", 0.0)),
            price_vs_21d_pct=float(market_status.get("price_vs_21d_pct", 0.0)),
            price_vs_50d_pct=float(market_status.get("price_vs_50d_pct", 0.0)),
            follow_through_active=bool(market_status.get("follow_through_active", False)),
        )
    except Exception:
        return None


def load_last_known_macro_report(max_age_hours: float = 72.0) -> dict[str, Any] | None:
    path = latest_report_json_path()
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    generated_at = str(payload.get("metadata", {}).get("generatedAt", "")).strip()
    if not generated_at:
        return None
    try:
        generated = datetime.fromisoformat(generated_at.replace("Z", "+00:00"))
    except Exception:
        return None
    age_hours = max((datetime.now(UTC) - generated).total_seconds(), 0.0) / 3600.0
    if age_hours > max_age_hours:
        return None
    payload["_stale_age_hours"] = round(age_hours, 1)
    return payload


def build_snapshot(service_base_url: str = SERVICE_BASE_URL, now: datetime | None = None) -> dict[str, Any]:
    warnings: list[str] = []
    generated_at = datetime.now(UTC).isoformat()
    session_phase = get_market_session_phase(now)
    service_recovery = maybe_self_heal_market_data_service(service_base_url)
    if service_recovery["attempted"] and not service_recovery["recovered"] and service_recovery["reason"]:
        warnings.append(f"market_data_service_self_heal_failed: {service_recovery['reason']}")

    regime_error = None
    status = None
    if session_phase != "OPEN":
        status = load_last_known_regime_status(
            max_age_hours=float(os.getenv("MARKET_BRIEF_SESSION_REGIME_MAX_AGE_HOURS", "48.0")),
            session_baseline=True,
        )
        if status is not None:
            warnings.append(f"market_regime_session_baseline:{session_phase.lower()}")

    if status is None:
        try:
            status = TradingAdvisor().get_market_status(refresh=True)
        except Exception as exc:  # pragma: no cover - exercised in tests via monkeypatch
            regime_error = str(exc)
            fallback_status = load_last_known_regime_status()
            if fallback_status is not None:
                warnings.append(f"market_regime_stale_cache: {exc}")
                status = fallback_status
            else:
                warnings.append(f"market_regime_unavailable: {exc}")
                status = MarketStatus(
                    regime=MarketRegime.CORRECTION,
                    distribution_days=0,
                    last_ftd="",
                    trend_direction="unknown",
                    position_sizing=0.0,
                    notes="Market regime unavailable; defaulting to a conservative no-buy posture.",
                    data_source="unavailable",
                    status="degraded",
                    degraded_reason=str(exc),
                    next_action="Retry market regime refresh after the provider recovers.",
                )

    breadth = build_intraday_breadth_snapshot(service_base_url=service_base_url)
    posture = classify_posture(status, breadth_snapshot=breadth)
    macro_report = load_structured_context(max_age_hours=30.0)
    if macro_report is None and session_phase != "OPEN":
        macro_report = load_last_known_macro_report(
            max_age_hours=float(os.getenv("MARKET_BRIEF_STALE_MACRO_MAX_AGE_HOURS", "72.0"))
        )
    macro = summarize_macro(macro_report)
    if macro["state"] == "unknown":
        warnings.append("polymarket_context_unavailable")
    elif macro_report and macro_report.get("_stale_age_hours") is not None:
        macro["summary_line"] += f" [stale {float(macro_report['_stale_age_hours']):.1f}h]"
        warnings.append(f"polymarket_context_stale:{float(macro_report['_stale_age_hours']):.1f}h")

    tape = fetch_tape_quotes(service_base_url=service_base_url)
    tape_warnings = list(tape.pop("warnings", []))
    if tape["status"] == "error" and session_phase != "OPEN":
        cached_tape = load_cached_tape_quotes()
        warnings.extend(tape_warnings)
        if cached_tape["status"] != "error":
            tape = cached_tape
        else:
            warnings.extend(cached_tape.pop("warnings", []))
    else:
        warnings.extend(tape_warnings)
    warnings.extend([f"intraday_breadth_{warning}" for warning in breadth.get("warnings", [])])

    if status.status == "degraded" and str(status.data_source or "").strip().lower() in {"unknown", "unavailable"}:
        issue = humanize_market_issue(service_recovery.get("reason") or getattr(status, "degraded_reason", None))
        issue_clause = f" ({issue})" if issue else ""
        if str(tape.get("primary_source") or "").strip().lower() == "cache":
            posture = {
                **posture,
                "reason": (
                    f"Fresh live market regime is unavailable{issue_clause}. Using previous-session market context and "
                    "staying defensive until live data returns."
                ),
            }
        else:
            posture = {
                **posture,
                "reason": (
                    f"Fresh live market data is unavailable{issue_clause}. "
                    "Defaulting to defensive posture until live data returns."
                ),
            }

    leader_symbols = load_leader_priority_symbols(max_age_hours=72.0)
    focus = build_focus_names(leader_symbols, macro.get("focus_tickers", []))
    regime_payload = normalize_regime(status)
    subsystem_modes = {
        "market_regime": str(regime_payload.get("provider_mode", "unknown") or "unknown"),
        "market_brief_tape": str(tape.get("provider_mode", "unknown") or "unknown"),
        "intraday_breadth": str(breadth.get("provider_mode", "unknown") or "unknown"),
    }
    unique_provider_modes = sorted({mode for mode in subsystem_modes.values() if mode})
    overall_provider_mode = (
        unique_provider_modes[0]
        if len(unique_provider_modes) == 1
        else "multi_mode"
        if unique_provider_modes
        else "unknown"
    )
    comparison_artifact, calibration_artifact, shadow_input_warnings = load_shadow_inputs()
    warnings.extend(shadow_input_warnings)
    research_runtime = build_surface_research_runtime(generated_at=generated_at)
    decision_bundle = build_market_brief_decision_bundle(
        generated_at=generated_at,
        known_at=generated_at,
        producer=MARKET_BRIEF_PRODUCER,
        session_phase=session_phase,
        regime=regime_payload,
        posture=posture,
        breadth=breadth,
        tape=tape,
        macro_report=macro_report,
        focus=focus,
        comparison_artifact=comparison_artifact,
        calibration_artifact=calibration_artifact,
        research_runtime=research_runtime,
    )
    operator_summary = build_operator_summary(
        session_phase=session_phase,
        posture=posture,
        regime=regime_payload,
        tape=tape,
        macro=macro,
        breadth=breadth,
        focus=focus,
        research_runtime=research_runtime,
        shadow_review=decision_bundle.get("shadow_review"),
        narrative_overlay=decision_bundle.get("narrative_overlay"),
    )

    taxonomy = classify_market_brief_outcome(
        posture_action=posture.get("action", ""),
        regime_status=status.status,
        regime_data_source=status.data_source,
        tape_status=tape.get("status", "ok"),
        tape_primary_source=tape.get("primary_source", "unknown"),
    )
    payload = {
        "generated_at": generated_at,
        "session": {
            "phase": session_phase,
            "is_regular_hours": session_phase == "OPEN",
        },
        "status": taxonomy.status,
        "provider_mode": overall_provider_mode,
        "subsystem_provider_modes": subsystem_modes,
        "operator_summary": operator_summary,
        "warnings": warnings,
        "regime": regime_payload,
        "posture": posture,
        "macro": macro,
        "tape": tape,
        "intraday_breadth": breadth,
        "focus": focus,
        "decision_state": decision_bundle.get("decision_state"),
        "adaptive_weights": decision_bundle.get("adaptive_weights"),
        "narrative_overlay": decision_bundle.get("narrative_overlay"),
        "research_runtime": research_runtime,
        "shadow_review": decision_bundle.get("shadow_review"),
        "freshness": {
            "regime_snapshot_age_seconds": status.snapshot_age_seconds,
            "polymarket_age_hours": macro.get("freshness_hours"),
            "tape_primary_source": tape.get("primary_source"),
            "provider_mode": overall_provider_mode,
        },
    }
    annotated = annotate_artifact(
        payload,
        artifact_family=ARTIFACT_FAMILY_MARKET_BRIEF,
        producer=MARKET_BRIEF_PRODUCER,
        generated_at=generated_at,
        known_at=generated_at,
        status=taxonomy.status,
        degraded_status=taxonomy.degraded_status,
        outcome_class=taxonomy.outcome_class,
        freshness=payload["freshness"],
    )
    annotated["operator_payload"] = build_market_brief_operator_payload(annotated)
    return annotated


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a compact market-brief snapshot.")
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON.")
    parser.add_argument("--operator", action="store_true", help="Print a concise operator-facing summary instead of raw JSON.")
    parser.add_argument("--output", type=Path, help="Optional output path for the artifact.")
    parser.add_argument("--service-base-url", default=SERVICE_BASE_URL, help="TS market-data service base URL.")
    return parser.parse_args()


def format_operator_text(payload: dict[str, Any]) -> str:
    operator_payload = payload.get("operator_payload") if isinstance(payload.get("operator_payload"), dict) else None
    if operator_payload:
        return render_operator_payload(operator_payload)
    summary = payload.get("operator_summary", {}) if isinstance(payload.get("operator_summary"), dict) else {}
    read_this_as = summary.get("read_this_as", {}) if isinstance(summary.get("read_this_as"), dict) else {}
    lines = [
        str(summary.get("headline", "Market snapshot unavailable")).strip(),
        describe_operator_status(payload),
        str(summary.get("what_this_means", "")).strip(),
        f"Session: {read_this_as.get('session', 'Unavailable')}",
        f"Regime: {read_this_as.get('regime', 'Unavailable')}",
        f"Tape: {read_this_as.get('tape', 'Unavailable')}",
        f"Macro: {read_this_as.get('macro', 'Unavailable')}",
        f"Breadth: {read_this_as.get('breadth', 'Unavailable')}",
        f"Narrative: {read_this_as.get('narrative', 'Unavailable')}",
        f"Research: {read_this_as.get('research', 'Unavailable')}",
        f"Shadow: {read_this_as.get('shadow', 'Unavailable')}",
        f"Focus: {read_this_as.get('focus', 'Unavailable')}",
    ]
    warnings = payload.get("warnings", [])
    if isinstance(warnings, list) and warnings:
        lines.append(f"Warnings: {', '.join(str(item) for item in warnings[:3])}")
    return "\n".join(line for line in lines if line)


def main() -> None:
    args = parse_args()
    payload = build_snapshot(service_base_url=args.service_base_url)
    decision_state = payload.get("decision_state")
    if isinstance(decision_state, dict):
        session = payload.get("session") if isinstance(payload.get("session"), dict) else {}
        emit_decision_trace(
            decision_state,
            trigger_type="market_brief",
            action_type="market_posture",
            metadata={
                "session_phase": session.get("phase"),
                "status": payload.get("status"),
                "service_base_url": args.service_base_url,
            },
        )
    text = format_operator_text(payload) if args.operator else json.dumps(payload, indent=2 if args.pretty else None, sort_keys=True)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text + "\n", encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
