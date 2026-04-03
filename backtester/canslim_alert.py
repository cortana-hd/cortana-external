#!/usr/bin/env python3
"""CANSLIM daily alert runner with deterministic scanner telemetry."""

from __future__ import annotations

import argparse
import importlib
import io
import inspect
import json
import os
from pathlib import Path
import re
import sys
import time
import warnings
from collections import Counter, defaultdict
from contextlib import redirect_stderr, redirect_stdout
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

from advisor import TradingAdvisor
from data.adverse_regime import build_adverse_regime_indicator
from data.leader_baskets import load_leader_priority_symbols
from data.polymarket_context import build_alert_context_lines
from data.universe import GROWTH_WATCHLIST
from data.universe_selection import RankedUniverseSelector, UniverseSelectionResult
from evaluation.alert_posture import (
    describe_alert_posture,
    describe_calibration_note,
    load_buy_decision_calibration_summary,
)
from evaluation.failure_taxonomy import classify_strategy_outcome
from evaluation.prediction_accuracy import persist_prediction_snapshot
from evaluation.decision_review import render_decision_review
from evaluation.artifact_contracts import ARTIFACT_FAMILY_STRATEGY_ALERT, annotate_artifact
from lifecycle.entry_plan import annotate_alert_payload_with_entry_plans
from lifecycle.execution_policy import annotate_alert_payload_with_execution_policies


CANSLIM_ALERT_PRODUCER = "backtester.canslim_alert"


def _trade_quality_sort_key(record: dict) -> tuple:
    return (
        TradingAdvisor._action_priority(record.get('action', 'NO_BUY')),
        int(bool(record.get('abstain', False))),
        -float(record.get('trade_quality_score', record.get('score', 0))),
        -float(record.get('effective_confidence', 0)),
        float(record.get('uncertainty_pct', 0)),
        -float(record.get('score', 0)),
        str(record.get('symbol', '')),
    )


def _run_quiet(fn, *args, **kwargs):
    with warnings.catch_warnings(), redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
        warnings.simplefilter("ignore")
        return fn(*args, **kwargs)


def _market_headline(market) -> str:
    regime = getattr(market.regime, "value", str(market.regime)).replace("_", " ")
    if regime == "correction":
        return "Market: correction — no new positions"
    if regime == "uptrend under pressure":
        return f"Market: {regime} — reduced exposure"
    return f"Market: {regime} — position sizing {market.position_sizing:.0%}"


def _age_to_human(seconds: float) -> str:
    seconds = max(float(seconds or 0.0), 0.0)
    if seconds < 60:
        return f"{int(seconds)}s"
    if seconds < 3600:
        return f"{int(seconds // 60)}m"
    return f"{seconds / 3600:.1f}h"


def _market_degraded_warning_line(market) -> str:
    if getattr(market, "status", "ok") != "degraded":
        return ""
    reason = _dedupe_reason(
        getattr(market, "degraded_reason", "") or "Market regime inputs are degraded"
    )
    age_seconds = float(getattr(market, "snapshot_age_seconds", 0.0) or 0.0)
    if age_seconds > 0:
        reason += f" (snapshot age {_age_to_human(age_seconds)})"
    return f"Warning: degraded market regime input — {reason}"


def _market_recovery_line(market) -> str:
    if getattr(market, "status", "ok") != "degraded":
        return ""
    next_action = _dedupe_reason(getattr(market, "next_action", "") or "")
    if not next_action:
        return ""
    return f"Recovery: {next_action}"


def _top_names(records: list[dict], limit: int = 3) -> str:
    names = []
    seen = set()
    for rec in records:
        sym = rec.get("symbol")
        if sym and sym not in seen:
            seen.add(sym)
            names.append(sym)
        if len(names) >= limit:
            break
    return ", ".join(names) if names else "none"


def _persist_predictions(*, market: object, records: list[dict]) -> None:
    if os.getenv("PREDICTION_ACCURACY_ENABLED", "1") == "0":
        return
    try:
        persist_prediction_snapshot(
            strategy="canslim",
            market_regime=getattr(getattr(market, "regime", None), "value", "unknown"),
            records=records,
            producer=CANSLIM_ALERT_PRODUCER,
        )
    except Exception:
        return


def _build_prediction_record(
    *,
    symbol: str,
    score: int,
    action: str,
    reason: str,
    market_regime: str,
    analysis: dict[str, Any] | None = None,
    recommendation: dict[str, Any] | None = None,
    execution_overlay: dict[str, Any] | None = None,
    vetoes: list[str] | None = None,
) -> dict[str, Any]:
    rec = dict(recommendation or {})
    context = dict(analysis or {})
    if vetoes is not None:
        context["vetoes"] = list(vetoes)
    contract_fields = TradingAdvisor.build_prediction_contract_context(
        strategy="canslim",
        recommendation={**rec, "action": action, "reason": reason},
        analysis={**context, "market_regime": market_regime},
        execution_overlay=execution_overlay,
    )
    has_risk_telemetry = any(
        key in rec or key in context
        for key in (
            "trade_quality_score",
            "effective_confidence",
            "uncertainty_pct",
            "downside_penalty",
            "churn_penalty",
            "adverse_regime_score",
            "adverse_regime_label",
        )
    ) or bool(rec.get("abstain", context.get("abstain", False)))
    return {
        "symbol": symbol,
        "score": score,
        "action": action,
        "reason": reason,
        "rec": rec,
        "price": rec.get("entry", context.get("price")),
        "confidence": contract_fields.get("confidence"),
        "risk": contract_fields.get("risk"),
        "market_regime": contract_fields.get("market_regime"),
        "breadth_state": contract_fields.get("breadth_state"),
        "entry_plan_ref": contract_fields.get("entry_plan_ref"),
        "execution_policy_ref": contract_fields.get("execution_policy_ref"),
        "vetoes": list(contract_fields.get("vetoes") or []),
        "trade_quality_score": rec.get("trade_quality_score", context.get("trade_quality_score", score)),
        "effective_confidence": rec.get("effective_confidence", context.get("effective_confidence", context.get("confidence", 0))),
        "uncertainty_pct": rec.get("uncertainty_pct", context.get("uncertainty_pct", 0)),
        "downside_penalty": rec.get("downside_penalty", context.get("downside_penalty", 0.0)),
        "churn_penalty": rec.get("churn_penalty", context.get("churn_penalty", 0.0)),
        "adverse_regime_score": rec.get("adverse_regime_score", context.get("adverse_regime_score", context.get("adverse_regime", {}).get("score", 0.0))),
        "adverse_regime_label": rec.get("adverse_regime_label", context.get("adverse_regime_label", context.get("adverse_regime", {}).get("label", "normal"))),
        "abstain": rec.get("abstain", context.get("abstain", False)),
        "abstain_reasons": rec.get("abstain_reasons", context.get("abstain_reasons", [])),
        "abstain_reason_codes": rec.get("abstain_reason_codes", context.get("abstain_reason_codes", [])),
        "sentiment_veto": bool(context.get("sentiment_overlay", {}).get("veto", False)),
        "exit_risk_veto": bool(context.get("exit_risk", {}).get("veto", False)),
        "market_regime_blocked": "market_regime" in (contract_fields.get("vetoes") or []),
        "has_risk_telemetry": has_risk_telemetry,
        "data_source": context.get("data_source", "unknown"),
        "data_staleness_seconds": float(context.get("data_staleness_seconds", 0.0) or 0.0),
    }


def _dedupe_reason(reason: str) -> str:
    reason = re.sub(r"\s+", " ", (reason or "").strip())
    return reason.rstrip(".")


def _leader_risk_line(records: list[dict], limit: int = 3) -> str:
    chunks = []
    for rec in records[:limit]:
        if not rec.get("has_risk_telemetry"):
            continue

        parts = [str(rec.get("symbol", ""))]
        if rec.get("trade_quality_score") is not None:
            parts.append(f"tq {float(rec['trade_quality_score']):.1f}")
        if rec.get("effective_confidence"):
            parts.append(f"conf {float(rec['effective_confidence']):.0f}%")
        if rec.get("uncertainty_pct") is not None:
            parts.append(f"u {float(rec['uncertainty_pct']):.0f}%")
        downside_penalty = rec.get("downside_penalty")
        churn_penalty = rec.get("churn_penalty")
        if downside_penalty is not None or churn_penalty is not None:
            parts.append(
                f"down/churn {float(downside_penalty or 0.0):.1f}/{float(churn_penalty or 0.0):.1f}"
            )
        adverse_label = rec.get("adverse_regime_label")
        adverse_score = rec.get("adverse_regime_score")
        if (adverse_label and str(adverse_label).lower() != "normal") or float(adverse_score or 0.0) > 0:
            label = adverse_label or "normal"
            parts.append(f"stress {label}({float(adverse_score or 0.0):.0f})")
        if rec.get("abstain"):
            parts.append("ABSTAIN")
        chunks.append(" | ".join(parts))

    return f"Leader telemetry: {'; '.join(chunks)}" if chunks else ""


def _append_pipeline_contract_summary(
    lines: list[str],
    *,
    scanned: int,
    evaluated: int,
    threshold_passed: int,
    buy_count: int,
    watch_count: int,
    no_buy_count: int,
) -> None:
    lines.append(
        "Summary: "
        f"scanned {scanned} | "
        f"evaluated {evaluated} | "
        f"threshold-passed {threshold_passed} | "
        f"BUY {buy_count} | WATCH {watch_count} | NO_BUY {no_buy_count}"
    )


def _append_pipeline_contract_signals(lines: list[str], records: list[dict]) -> None:
    for record in records:
        symbol = str(record.get("symbol", "")).strip().upper()
        if not symbol:
            continue
        score = int(record.get("score", 0) or 0)
        action = str(record.get("action", "NO_BUY")).strip().upper()
        reason = str(record.get("reason", "No reason provided.")).strip() or "No reason provided."
        lines.append(f"• {symbol} ({score}/12) → {action}")
        lines.append(reason)


def _load_priority_symbols() -> list[str]:
    out: list[str] = []
    csv_symbols = os.getenv("TRADING_PRIORITY_SYMBOLS", "")
    if csv_symbols:
        out.extend([s.strip().upper() for s in csv_symbols.split(",") if s.strip()])

    file_path = os.getenv("TRADING_PRIORITY_FILE")
    if file_path and os.path.exists(file_path):
        with open(file_path, "r", encoding="utf-8") as f:
            for line in f:
                sym = line.strip().upper()
                if sym and not sym.startswith("#"):
                    out.append(sym)

    if os.getenv("TRADING_INCLUDE_LEADER_BASKET_PRIORITY", "1") != "0":
        leader_limit = max(int(os.getenv("TRADING_LEADER_BASKET_PRIORITY_LIMIT", "12")), 0)
        out.extend(load_leader_priority_symbols()[:leader_limit])

    if os.getenv("TRADING_INCLUDE_WATCHLIST_PRIORITY", "1") != "0":
        watchlist_limit = max(int(os.getenv("TRADING_WATCHLIST_PRIORITY_LIMIT", "12")), 0)
        out.extend([s.upper() for s in GROWTH_WATCHLIST[:watchlist_limit]])

    seen = set()
    deduped = []
    for sym in out:
        if sym not in seen:
            seen.add(sym)
            deduped.append(sym)
    return deduped


def _deterministic_universe(advisor: TradingAdvisor, universe_size: int, market_regime: str = "unknown") -> tuple[list[str], int, UniverseSelectionResult | None]:
    if hasattr(advisor, "screener"):
        base = _run_quiet(advisor.screener.get_universe)
    else:
        scan_df = _run_quiet(advisor.scan_for_opportunities, True, 0)
        base = list(scan_df.get("symbol", []).tolist()) if hasattr(scan_df, "get") else []
    priority = _load_priority_symbols()
    if hasattr(advisor, "market_data"):
        selection = RankedUniverseSelector().select_live_universe(
            base_symbols=base,
            priority_symbols=priority,
            universe_size=universe_size,
            market_regime=market_regime,
        )
        return selection.symbols, len(selection.priority_symbols), selection
    ordered = []
    seen = set()
    for sym in [*priority, *base]:
        if sym not in seen:
            seen.add(sym)
            ordered.append(sym)
    return ordered[:universe_size], len(priority), None


def _selection_line(selection: UniverseSelectionResult | None, scanned_count: int) -> str:
    if selection is None:
        return ""
    ranked_count = max(scanned_count - len(selection.priority_symbols), 0)
    line = (
        "Universe selection: "
        f"{len(selection.priority_symbols)} pinned | {ranked_count} ranked | source {selection.source}"
    )
    if selection.generated_at and selection.cache_age_hours is not None:
        line += f" | cache age {selection.cache_age_hours:.1f}h"
    return line


def _overlay_as_dict(payload: object) -> dict:
    if isinstance(payload, dict):
        return dict(payload)
    as_dict = getattr(payload, "as_dict", None)
    if callable(as_dict):
        converted = as_dict()
        if isinstance(converted, dict):
            return dict(converted)
    raw = getattr(payload, "__dict__", None)
    if isinstance(raw, dict):
        return dict(raw)
    return {}


def _call_overlay_builder(
    *,
    modules: list[str],
    function_names: list[str],
    kwargs: dict[str, object],
) -> dict:
    for module_name in modules:
        try:
            module = importlib.import_module(module_name)
        except Exception:
            continue
        for function_name in function_names:
            builder = getattr(module, function_name, None)
            if not callable(builder):
                continue
            try:
                signature = inspect.signature(builder)
                accepted = {
                    key: value
                    for key, value in kwargs.items()
                    if key in signature.parameters and value is not None
                }
                return _overlay_as_dict(builder(**accepted))
            except Exception:
                try:
                    return _overlay_as_dict(builder(kwargs.get("market")))
                except Exception:
                    continue
    return {}


def _resolve_context_overlays(
    *,
    market: object,
    risk_snapshot: dict[str, object] | None = None,
    symbol_hint: str | None = None,
    selected_symbols: list[str] | None = None,
) -> tuple[dict, dict]:
    payload = {
        "market": market,
        "risk_inputs": risk_snapshot or {},
        "risk_snapshot": risk_snapshot or {},
        "symbol": symbol_hint,
        "symbol_hint": symbol_hint,
        "symbols": selected_symbols or [],
    }
    risk_overlay = _call_overlay_builder(
        modules=["data.risk_budget"],
        function_names=["build_risk_budget_overlay", "build_risk_budget", "compute_risk_budget_overlay"],
        kwargs=payload,
    )
    execution_overlay = _call_overlay_builder(
        modules=["data.execution_quality", "data.liquidity_overlay", "data.execution_overlay"],
        function_names=["build_execution_quality_overlay", "build_liquidity_overlay", "build_execution_overlay"],
        kwargs=payload,
    )
    return risk_overlay, execution_overlay


def _format_pct(value: Any) -> str:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return ""
    if numeric != numeric:
        return ""
    if numeric <= 1.0:
        numeric *= 100.0
    return f"{numeric:.0f}%"


def _risk_budget_line(overlay: dict) -> str:
    if not overlay:
        return ""

    remaining = _format_pct(overlay.get("risk_budget_remaining"))
    cap = _format_pct(overlay.get("exposure_cap_hint"))
    aggression = str(
        overlay.get("aggression_dial")
        or overlay.get("aggression")
        or overlay.get("posture")
        or ""
    ).strip()
    reasons = overlay.get("reasons") if isinstance(overlay.get("reasons"), (list, tuple)) else []
    reason_note = str(reasons[0]).strip() if reasons else ""
    if not (remaining or cap or aggression or reason_note):
        return ""

    bits = []
    if remaining:
        bits.append(f"remaining {remaining}")
    if cap:
        bits.append(f"cap {cap}")
    if aggression:
        bits.append(f"aggression {aggression.replace('_', ' ')}")
    if reason_note:
        bits.append(f"note {reason_note[:72]}")
    return "Risk budget: " + " | ".join(bits)


def _execution_quality_line(overlay: dict) -> str:
    if not overlay:
        return ""

    quality = str(
        overlay.get("execution_quality")
        or overlay.get("quality_label")
        or overlay.get("liquidity_quality")
        or ""
    ).strip()
    liquidity = str(
        overlay.get("liquidity_posture")
        or overlay.get("liquidity_label")
        or overlay.get("liquidity")
        or ""
    ).strip()
    slippage = str(
        overlay.get("slippage_risk")
        or overlay.get("slippage_label")
        or overlay.get("slippage_band")
        or ""
    ).strip()
    annotation = str(
        overlay.get("annotation")
        or overlay.get("summary")
        or overlay.get("note")
        or ""
    ).strip()
    if not (quality or liquidity or slippage or annotation):
        return ""

    bits = []
    if quality:
        bits.append(f"quality {quality.replace('_', ' ')}")
    if liquidity:
        bits.append(f"liquidity {liquidity.replace('_', ' ')}")
    if slippage:
        bits.append(f"slippage {slippage.replace('_', ' ')}")
    if annotation:
        bits.append(annotation[:72])
    return "Execution quality: " + " | ".join(bits)


def _analyze_for_alert(advisor: TradingAdvisor, symbol: str) -> dict:
    try:
        return _run_quiet(advisor.analyze_stock, symbol, False, "bulk_scan")
    except TypeError:
        # Test doubles and older signatures may not accept analysis_profile yet.
        return _run_quiet(advisor.analyze_stock, symbol)


def _format_timing_line(phase_timings: dict[str, float], nested_timings: dict[str, float]) -> str:
    phase_bits = [f"{key} {value:.2f}s" for key, value in phase_timings.items()]
    top_nested = sorted(nested_timings.items(), key=lambda item: item[1], reverse=True)[:4]
    if top_nested:
        nested_bits = ", ".join(f"{key} {value:.2f}s" for key, value in top_nested)
        return "Timing: " + " | ".join(phase_bits) + f" | slowest nested: {nested_bits}"
    return "Timing: " + " | ".join(phase_bits)


def _serialize_market_state(market: object) -> dict[str, Any]:
    regime = getattr(getattr(market, "regime", None), "value", str(getattr(market, "regime", "unknown")))
    return {
        "regime": str(regime),
        "position_sizing": float(getattr(market, "position_sizing", 0.0) or 0.0),
        "notes": str(getattr(market, "notes", "") or ""),
        "status": str(getattr(market, "status", "ok") or "ok"),
        "data_source": str(getattr(market, "data_source", "unknown") or "unknown"),
        "degraded_reason": str(getattr(market, "degraded_reason", "") or "") or None,
        "snapshot_age_seconds": float(getattr(market, "snapshot_age_seconds", 0.0) or 0.0),
        "next_action": str(getattr(market, "next_action", "") or "") or None,
    }


def _serialize_selection(selection: UniverseSelectionResult | None, priority_count: int) -> dict[str, Any]:
    if selection is None:
        return {
            "status": "unavailable",
            "priority_count": int(priority_count),
            "source": "fallback",
            "generated_at": None,
            "cache_age_hours": None,
        }
    return {
        "status": "ok",
        "priority_count": int(priority_count),
        "source": str(selection.source),
        "generated_at": selection.generated_at,
        "cache_age_hours": selection.cache_age_hours,
    }


def _serialize_signal_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    serialized: list[dict[str, Any]] = []
    for record in records:
        serialized.append(
            {
                "symbol": str(record.get("symbol", "") or ""),
                "score": int(record.get("score", 0) or 0),
                "action": str(record.get("action", "NO_BUY") or "NO_BUY"),
                "reason": str(record.get("reason", "") or ""),
                "price": float(record.get("price", 0.0) or 0.0),
                "confidence": float(record.get("confidence", record.get("effective_confidence", 0.0)) or 0.0),
                "risk": str(record.get("risk", "unknown") or "unknown"),
                "market_regime": str(record.get("market_regime", "unknown") or "unknown"),
                "breadth_state": record.get("breadth_state"),
                "entry_plan_ref": record.get("entry_plan_ref"),
                "execution_policy_ref": record.get("execution_policy_ref"),
                "vetoes": list(record.get("vetoes", []) or []),
                "trade_quality_score": float(record.get("trade_quality_score", 0.0) or 0.0),
                "effective_confidence": float(record.get("effective_confidence", 0.0) or 0.0),
                "uncertainty_pct": float(record.get("uncertainty_pct", 0.0) or 0.0),
                "data_source": str(record.get("data_source", "unknown") or "unknown"),
                "data_staleness_seconds": float(record.get("data_staleness_seconds", 0.0) or 0.0),
                "abstain": bool(record.get("abstain", False)),
                "abstain_reason_codes": list(record.get("abstain_reason_codes", []) or []),
                "abstain_reasons": list(record.get("abstain_reasons", []) or []),
                "sentiment_veto": bool(record.get("sentiment_veto", False)),
                "exit_risk_veto": bool(record.get("exit_risk_veto", False)),
                "market_regime_blocked": bool(record.get("market_regime_blocked", False)),
                "has_risk_telemetry": bool(record.get("has_risk_telemetry", False)),
            }
        )
    return serialized


def _finalize_alert_payload(
    *,
    generated_at: str,
    strategy: str,
    market: object,
    summary: dict[str, Any],
    signals: list[dict[str, Any]],
    source_counts: Counter | dict[str, int],
    max_input_staleness_seconds: float,
    selection: UniverseSelectionResult | None,
    priority_count: int,
    risk_overlay: dict[str, Any],
    execution_overlay: dict[str, Any],
    calibration_note: str,
    gate_active: bool,
    analysis_error_count: int,
    lines: list[str],
    review_detail_limit: int,
    limit: int,
    min_score: int,
    universe_size: int,
    phase_timings: dict[str, float] | None = None,
    nested_timings: dict[str, float] | None = None,
) -> dict[str, Any]:
    market_payload = _serialize_market_state(market)
    taxonomy = classify_strategy_outcome(
        market_status=market_payload["status"],
        gate_active=gate_active,
        evaluated=int(summary.get("evaluated", 0) or 0),
        threshold_passed=int(summary.get("threshold_passed", 0) or 0),
        analysis_error_count=int(analysis_error_count or 0),
        risky_degraded=market_payload["data_source"] in {"unknown", "unavailable"},
    )
    payload = {
        "strategy": strategy,
        "summary": dict(summary),
        "signals": _serialize_signal_records(signals),
        "market": market_payload,
        "inputs": {
            "source_counts": dict(source_counts),
            "max_input_staleness_seconds": float(max_input_staleness_seconds or 0.0),
            "analysis_error_count": int(analysis_error_count or 0),
        },
        "selection": _serialize_selection(selection, priority_count),
        "overlays": {
            "risk": dict(risk_overlay or {}),
            "execution": dict(execution_overlay or {}),
            "calibration_note": calibration_note or "",
        },
        "parameters": {
            "limit": int(limit),
            "min_score": int(min_score),
            "universe_size": int(universe_size),
            "review_detail_limit": int(review_detail_limit),
        },
        "render_lines": list(lines),
    }
    if phase_timings or nested_timings:
        payload["timing"] = {
            "phase_timings": dict(phase_timings or {}),
            "nested_timings": dict(nested_timings or {}),
        }
    payload = annotate_alert_payload_with_entry_plans(
        strategy=strategy,
        payload=payload,
        generated_at=generated_at,
    )
    payload = annotate_alert_payload_with_execution_policies(
        strategy=strategy,
        payload=payload,
        generated_at=generated_at,
    )
    return annotate_artifact(
        payload,
        artifact_family=ARTIFACT_FAMILY_STRATEGY_ALERT,
        producer=CANSLIM_ALERT_PRODUCER,
        generated_at=generated_at,
        known_at=generated_at,
        status=taxonomy.status,
        degraded_status=taxonomy.degraded_status,
        outcome_class=taxonomy.outcome_class,
        freshness={"max_input_staleness_seconds": float(max_input_staleness_seconds or 0.0)},
    )


def render_alert_payload(payload: dict[str, Any]) -> str:
    return "\n".join(str(line) for line in payload.get("render_lines", []) if str(line))


def _analysis_failed_line(scanned: int, analysis_error_count: int) -> str:
    failed_count = max(int(analysis_error_count or 0), int(scanned or 0))
    return (
        f"Why no buys: analysis failed for {failed_count} scanned names, "
        "so no valid CANSLIM setups were produced"
    )


def build_alert_payload(
    limit: int = 8,
    min_score: int = 6,
    universe_size: int = 120,
    review_detail_limit: int = 2,
) -> dict[str, Any]:
    timing_enabled = os.getenv("BACKTESTER_TIMING", "0") not in {"", "0", "false", "False"}
    phase_timings: dict[str, float] = {}
    nested_timings: defaultdict[str, float] = defaultdict(float)
    generated_at = datetime.now(UTC).isoformat()

    start = time.perf_counter()
    advisor = TradingAdvisor()
    market = _run_quiet(advisor.get_market_status, True)
    if timing_enabled:
        phase_timings["market"] = time.perf_counter() - start

    start = time.perf_counter()
    stress = build_adverse_regime_indicator(market=market)
    regime_value = getattr(getattr(market, "regime", None), "value", "unknown")
    symbols, priority_count, selection = _deterministic_universe(advisor, universe_size, regime_value)
    risk_snapshot: dict[str, object] = {}
    if hasattr(advisor, "risk_fetcher") and hasattr(advisor.risk_fetcher, "get_snapshot"):
        fetched_snapshot = _run_quiet(advisor.risk_fetcher.get_snapshot)
        if isinstance(fetched_snapshot, dict):
            risk_snapshot = fetched_snapshot
    risk_overlay, execution_overlay = _resolve_context_overlays(
        market=market,
        risk_snapshot=risk_snapshot,
        symbol_hint=symbols[0] if symbols else None,
        selected_symbols=symbols,
    )
    calibration_note = describe_calibration_note(load_buy_decision_calibration_summary())
    if timing_enabled:
        phase_timings["universe"] = time.perf_counter() - start

    lines = [
        "CANSLIM Scan",
        _market_headline(market),
    ]
    degraded_warning = _market_degraded_warning_line(market)
    if degraded_warning:
        lines.append(degraded_warning)
    lines.extend(_run_quiet(build_alert_context_lines, GROWTH_WATCHLIST))
    risk_line = _risk_budget_line(risk_overlay)
    if risk_line:
        lines.append(risk_line)
    execution_line = _execution_quality_line(execution_overlay)
    if execution_line:
        lines.append(execution_line)
    if calibration_note:
        lines.append(calibration_note)
    selection_summary = _selection_line(selection, len(symbols))
    if selection_summary:
        lines.append(selection_summary)
    if stress.get("label") != "normal" and getattr(getattr(market, 'regime', None), 'value', '') != 'correction':
        lines.append(f"Adverse regime: {stress['label']} ({float(stress['score']):.0f}) -- {stress['reason']}")

    if getattr(getattr(market, "regime", None), "value", "") == "correction":
        blocked = [
            _build_prediction_record(
                symbol=s,
                score=0,
                action="NO_BUY",
                reason=market.notes or "market correction gate",
                market_regime=regime_value,
                execution_overlay=execution_overlay,
                vetoes=["market_regime"],
            )
            for s in symbols[:limit]
        ]
        _persist_predictions(market=market, records=blocked)
        posture_line = describe_alert_posture(market_regime=regime_value, buy_count=0, watch_count=0)
        if posture_line:
            lines.append(posture_line)
        _append_pipeline_contract_summary(
            lines,
            scanned=len(symbols),
            evaluated=0,
            threshold_passed=0,
            buy_count=0,
            watch_count=0,
            no_buy_count=0,
        )
        lines.append(f"Scanned {len(symbols)} | market gate active | 0 BUY | 0 WATCH")
        lines.append(f"Top names considered: {_top_names([{'symbol': s} for s in symbols], 3)}")
        lines.append(f"Why no buys: {_dedupe_reason(market.notes or 'market correction gate')}")
        recovery_line = _market_recovery_line(market)
        if recovery_line:
            lines.append(recovery_line)
        if timing_enabled:
            lines.append(_format_timing_line(phase_timings, nested_timings))
        return _finalize_alert_payload(
            generated_at=generated_at,
            strategy="canslim",
            market=market,
            summary={
                "scanned": len(symbols),
                "evaluated": 0,
                "threshold_passed": 0,
                "buy_count": 0,
                "watch_count": 0,
                "no_buy_count": 0,
            },
            signals=blocked,
            source_counts={},
            max_input_staleness_seconds=0.0,
            selection=selection,
            priority_count=priority_count,
            risk_overlay=risk_overlay,
            execution_overlay=execution_overlay,
            calibration_note=calibration_note,
            gate_active=True,
            analysis_error_count=0,
            lines=lines,
            review_detail_limit=review_detail_limit,
            limit=limit,
            min_score=min_score,
            universe_size=universe_size,
            phase_timings=phase_timings,
            nested_timings=nested_timings,
        )

    evaluated = 0
    passed = []
    rejected = []
    analysis_error_count = 0
    source_counts = Counter()
    max_input_staleness = 0.0

    analyze_start = time.perf_counter()
    for symbol in symbols:
        analysis = _analyze_for_alert(advisor, symbol)
        if analysis.get("error"):
            analysis_error_count += 1
            continue

        if timing_enabled:
            for key, value in (analysis.get("timing") or {}).items():
                nested_timings[key] += float(value)

        evaluated += 1
        source_counts[analysis.get("data_source", "unknown")] += 1
        max_input_staleness = max(max_input_staleness, float(analysis.get("data_staleness_seconds", 0.0) or 0.0))
        score = int(analysis.get("total_score", 0))
        rec = analysis.get("recommendation", {})
        action = rec.get("action", "NO_BUY")
        reason = rec.get("reason") or "No reason provided."

        record = _build_prediction_record(
            symbol=symbol,
            score=score,
            action=action,
            reason=reason,
            market_regime=regime_value,
            analysis={
                **analysis,
                "market_regime_blocked": action == "NO_BUY" and "market in correction" in reason.lower(),
            },
            recommendation=rec,
            execution_overlay=execution_overlay,
        )
        if score >= min_score:
            passed.append(record)
        else:
            record["reason"] = f"Below min-score filter ({score}<{min_score})"
            rejected.append(record)

        if action == "NO_BUY":
            rejected.append(record)
    if timing_enabled:
        phase_timings["analysis"] = time.perf_counter() - analyze_start

    if not passed:
        _persist_predictions(market=market, records=rejected[:limit])
        _append_pipeline_contract_summary(
            lines,
            scanned=len(symbols),
            evaluated=evaluated,
            threshold_passed=0,
            buy_count=0,
            watch_count=0,
            no_buy_count=0,
        )
        lines.append(f"Scanned {len(symbols)} | 0 passed threshold | 0 BUY | 0 WATCH")
        lines.append(f"Top names considered: {_top_names([{'symbol': s} for s in symbols], 3)}")
        if analysis_error_count > 0 and evaluated == 0:
            lines.append(_analysis_failed_line(len(symbols), analysis_error_count))
        else:
            lines.append("Why no buys: no names cleared the CANSLIM threshold")
        if timing_enabled:
            lines.append(_format_timing_line(phase_timings, nested_timings))
        return _finalize_alert_payload(
            generated_at=generated_at,
            strategy="canslim",
            market=market,
            summary={
                "scanned": len(symbols),
                "evaluated": evaluated,
                "threshold_passed": 0,
                "buy_count": 0,
                "watch_count": 0,
                "no_buy_count": 0,
            },
            signals=rejected[:limit],
            source_counts=source_counts,
            max_input_staleness_seconds=max_input_staleness,
            selection=selection,
            priority_count=priority_count,
            risk_overlay=risk_overlay,
            execution_overlay=execution_overlay,
            calibration_note=calibration_note,
            gate_active=False,
            analysis_error_count=analysis_error_count,
            lines=lines,
            review_detail_limit=review_detail_limit,
            limit=limit,
            min_score=min_score,
            universe_size=universe_size,
            phase_timings=phase_timings,
            nested_timings=nested_timings,
        )

    ranked = sorted(passed, key=_trade_quality_sort_key)
    candidates = ranked[:limit]
    _persist_predictions(market=market, records=candidates)

    buy_count = sum(1 for c in candidates if c["action"] == "BUY")
    watch_count = sum(1 for c in candidates if c["action"] == "WATCH")
    no_buy_count = sum(1 for c in candidates if c["action"] == "NO_BUY")

    posture_line = describe_alert_posture(market_regime=regime_value, buy_count=buy_count, watch_count=watch_count)
    if posture_line:
        lines.append(posture_line)
    _append_pipeline_contract_summary(
        lines,
        scanned=len(symbols),
        evaluated=evaluated,
        threshold_passed=len(passed),
        buy_count=buy_count,
        watch_count=watch_count,
        no_buy_count=no_buy_count,
    )
    lines.append(f"Scanned {len(symbols)} | {len(passed)} passed threshold | {buy_count} BUY | {watch_count} WATCH")
    lines.append(f"Top names considered: {_top_names(candidates, 3)}")

    if buy_count == 0 and watch_count == 0:
        why = _dedupe_reason(market.notes or "market correction gate")
        lines.append(f"Why no buys: {why}")
    elif candidates:
        _append_pipeline_contract_signals(lines, candidates)
        preview = []
        for c in candidates[: min(limit, 3)]:
            preview.append(f"{c['symbol']} {c['action']} ({c['score']}/12)")
        lines.append("Leaders: " + " | ".join(preview))
        review_pool = candidates[: min(limit, max(review_detail_limit, 5))]
        lines.extend(render_decision_review(review_pool, detail_limit=review_detail_limit))

    recovery_line = _market_recovery_line(market)
    if recovery_line:
        lines.append(recovery_line)
    if timing_enabled:
        lines.append(_format_timing_line(phase_timings, nested_timings))
    return _finalize_alert_payload(
        generated_at=generated_at,
        strategy="canslim",
        market=market,
        summary={
            "scanned": len(symbols),
            "evaluated": evaluated,
            "threshold_passed": len(passed),
            "buy_count": buy_count,
            "watch_count": watch_count,
            "no_buy_count": no_buy_count,
        },
        signals=candidates,
        source_counts=source_counts,
        max_input_staleness_seconds=max_input_staleness,
        selection=selection,
        priority_count=priority_count,
        risk_overlay=risk_overlay,
        execution_overlay=execution_overlay,
        calibration_note=calibration_note,
        gate_active=False,
        analysis_error_count=analysis_error_count,
        lines=lines,
        review_detail_limit=review_detail_limit,
        limit=limit,
        min_score=min_score,
        universe_size=universe_size,
        phase_timings=phase_timings,
        nested_timings=nested_timings,
    )


def format_alert(
    limit: int = 8,
    min_score: int = 6,
    universe_size: int = 120,
    review_detail_limit: int = 2,
) -> str:
    return render_alert_payload(
        build_alert_payload(
            limit=limit,
            min_score=min_score,
            universe_size=universe_size,
            review_detail_limit=review_detail_limit,
        )
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Run CANSLIM alert scan")
    parser.add_argument("--limit", type=int, default=8)
    parser.add_argument("--min-score", type=int, default=6)
    parser.add_argument("--universe-size", type=int, default=int(os.getenv("TRADING_UNIVERSE_SIZE", "120")))
    parser.add_argument("--json", action="store_true", help="Emit the structured alert payload as JSON.")
    parser.add_argument("--output-json", type=Path, help="Optional output path for the structured alert payload.")
    parser.add_argument(
        "--review-detail-limit",
        type=int,
        default=int(os.getenv("DECISION_REVIEW_DETAIL_LIMIT", "2")),
        help="Maximum number of decision-review details to show per group",
    )
    args = parser.parse_args()
    payload = build_alert_payload(
        limit=args.limit,
        min_score=args.min_score,
        universe_size=args.universe_size,
        review_detail_limit=max(1, int(args.review_detail_limit)),
    )
    if args.output_json:
        args.output_json.parent.mkdir(parents=True, exist_ok=True)
        args.output_json.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(payload, indent=2, sort_keys=True) if args.json else render_alert_payload(payload))


if __name__ == "__main__":
    main()
