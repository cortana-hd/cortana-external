"""Compatibility builders for liquidity/execution overlays.

This module exists so the alert/advisor loader can resolve a stable builder
without depending on the underlying cache model directly.
"""

from __future__ import annotations

from typing import Any, Optional

from data.liquidity_model import LiquidityOverlayModel


def _normalize_overlay(record: Optional[dict[str, Any]]) -> dict[str, Any]:
    if not record:
        return {}

    out = dict(record)
    tier = str(
        out.get("liquidity_tier")
        or out.get("liquidity_label")
        or out.get("liquidity_posture")
        or out.get("liquidity")
        or ""
    ).strip().lower()
    quality = str(
        out.get("execution_quality")
        or out.get("quality_label")
        or out.get("liquidity_quality")
        or tier
        or ""
    ).strip().lower()
    slippage = str(
        out.get("slippage_risk")
        or out.get("slippage_label")
        or out.get("slippage_band")
        or ""
    ).strip().lower()

    if not quality:
        quality = "unknown"
    if not tier:
        tier = "unknown"
    if not slippage:
        slippage = "unknown"

    annotation = str(out.get("annotation") or out.get("summary") or out.get("note") or "").strip()
    if not annotation:
        annotation = f"quality {quality} | liquidity {tier} | slippage {slippage}"

    out.update(
        {
            "execution_quality": quality,
            "quality_label": quality,
            "liquidity_quality": quality,
            "liquidity_posture": tier,
            "liquidity_label": tier,
            "liquidity": tier,
            "slippage_risk": slippage,
            "slippage_label": slippage,
            "slippage_band": slippage,
            "annotation": annotation,
            "summary": annotation,
            "note": annotation,
        }
    )
    return out


def _resolve_record(*, symbol: Optional[str] = None, symbol_hint: Optional[str] = None, model: Optional[LiquidityOverlayModel] = None) -> dict[str, Any]:
    overlay_model = model or LiquidityOverlayModel()
    _, overlay_map = overlay_model.load_overlay_map()
    target = str(symbol or symbol_hint or "").strip().upper()
    if not target:
        return {}
    return _normalize_overlay(overlay_map.get(target))


def _resolve_first_available(
    *,
    symbols: Optional[object] = None,
    symbol: Optional[str] = None,
    symbol_hint: Optional[str] = None,
    model: Optional[LiquidityOverlayModel] = None,
) -> dict[str, Any]:
    overlay_model = model or LiquidityOverlayModel()
    _, overlay_map = overlay_model.load_overlay_map()
    candidates: list[str] = []
    for raw in (symbol, symbol_hint):
        value = str(raw or "").strip().upper()
        if value:
            candidates.append(value)
    if symbols is not None:
        try:
            for raw in symbols:
                value = str(raw or "").strip().upper()
                if value:
                    candidates.append(value)
        except TypeError:
            value = str(symbols or "").strip().upper()
            if value:
                candidates.append(value)

    seen: set[str] = set()
    for candidate in candidates:
        if candidate in seen:
            continue
        seen.add(candidate)
        record = overlay_map.get(candidate)
        if record is not None:
            return _normalize_overlay(record)
    return {}


def build_liquidity_overlay(
    *,
    symbol: Optional[str] = None,
    symbol_hint: Optional[str] = None,
    symbols: Optional[object] = None,
    model: Optional[LiquidityOverlayModel] = None,
    **_: object,
) -> dict[str, Any]:
    return _resolve_first_available(symbols=symbols, symbol=symbol, symbol_hint=symbol_hint, model=model)


def build_execution_quality_overlay(
    *,
    symbol: Optional[str] = None,
    symbol_hint: Optional[str] = None,
    symbols: Optional[object] = None,
    model: Optional[LiquidityOverlayModel] = None,
    **kwargs: object,
) -> dict[str, Any]:
    return build_liquidity_overlay(symbol=symbol, symbol_hint=symbol_hint, symbols=symbols, model=model, **kwargs)


def build_execution_overlay(
    *,
    symbol: Optional[str] = None,
    symbol_hint: Optional[str] = None,
    symbols: Optional[object] = None,
    model: Optional[LiquidityOverlayModel] = None,
    **kwargs: object,
) -> dict[str, Any]:
    return build_liquidity_overlay(symbol=symbol, symbol_hint=symbol_hint, symbols=symbols, model=model, **kwargs)
