"""Read-only renderers for canonical operator payloads."""

from __future__ import annotations

from typing import Any, Mapping

from operator_surfaces.decision_contract import validate_operator_payload


def describe_operator_outcome(payload: Mapping[str, Any]) -> str:
    outcome_class = str(payload.get("outcome_class") or "").strip().lower()
    degraded_status = str(payload.get("degraded_status") or "").strip().lower()
    if outcome_class == "market_gate_blocked":
        return "Status: valid defensive snapshot; market regime is blocking new risk."
    if outcome_class == "healthy_no_candidates":
        return "Status: healthy snapshot; no candidates qualified."
    if degraded_status == "degraded_safe":
        return "Status: degraded-safe snapshot; bounded fallback inputs are active."
    if degraded_status == "degraded_risky":
        return "Status: degraded-risky snapshot; live market inputs are missing or incomplete."
    if outcome_class == "analysis_failed":
        return "Status: failed snapshot; analysis could not complete."
    if outcome_class == "healthy_candidates_found":
        return "Status: healthy snapshot; machine inputs are aligned."
    return "Status: snapshot state unavailable."


def render_operator_payload(payload: Mapping[str, Any]) -> str:
    normalized = validate_operator_payload(payload)
    summary = dict(normalized.get("summary") or {})
    read_this_as = dict(summary.get("read_this_as") or {})
    lines = [
        str(summary.get("headline") or "Operator snapshot unavailable").strip(),
        describe_operator_outcome(normalized),
        str(summary.get("what_this_means") or "").strip(),
    ]
    for label in ("session", "regime", "tape", "macro", "breadth", "narrative", "research", "shadow", "focus"):
        value = str(read_this_as.get(label) or "").strip()
        if value:
            lines.append(f"{label.capitalize()}: {value}")
    warnings = normalized.get("warnings")
    if isinstance(warnings, list) and warnings:
        lines.append(f"Warnings: {', '.join(str(item) for item in warnings[:3])}")
    return "\n".join(line for line in lines if line)
