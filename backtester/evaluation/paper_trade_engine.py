"""Paper-trade lifecycle engine for entry, review, and exit decisions."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import pandas as pd

from advisor import TradingAdvisor
from evaluation.paper_trade_ledger import (
    build_performance_summary,
    default_paper_trade_root,
    load_closed_positions,
    load_open_positions,
    save_closed_positions,
    save_latest_cycle,
    save_open_positions,
    save_performance_summary,
)
from evaluation.prediction_accuracy import default_prediction_root
from strategies.dip_buyer import DIPBUYER_CONFIG


class PaperTradeEngine:
    def __init__(
        self,
        *,
        advisor: Optional[TradingAdvisor] = None,
        root: Optional[Path] = None,
        signal_root: Optional[Path] = None,
        now: Optional[datetime] = None,
    ):
        self.advisor = advisor or TradingAdvisor()
        self.root = root or default_paper_trade_root()
        self.signal_root = signal_root or default_prediction_root()
        self.now = _ensure_utc(now or datetime.now(timezone.utc))

    def run(self, *, mode: str = "manual", entries_enabled: Optional[bool] = None) -> dict:
        mode_value = str(mode or "manual").strip().lower()
        if entries_enabled is None:
            entries_enabled = mode_value in {"daytime", "manual"}

        open_positions = load_open_positions(self.root)
        closed_positions = load_closed_positions(self.root)

        reviewed_open, closed_now = self._review_open_positions(open_positions)
        closed_positions.extend(closed_now)

        opened_now: list[dict] = []
        skipped_entries: list[dict] = []
        if entries_enabled:
            entry_candidates, skipped_entries = self._load_entry_candidates(open_positions=reviewed_open)
            opened_now = self._open_positions(entry_candidates, open_positions=reviewed_open)

        performance = build_performance_summary(closed_positions)
        save_open_positions(reviewed_open, self.root)
        save_closed_positions(closed_positions, self.root)
        save_performance_summary(performance, self.root)

        cycle = {
            "generated_at": self.now.isoformat(),
            "mode": mode_value,
            "entries_enabled": entries_enabled,
            "signals_used": self._signal_summary(),
            "opened": opened_now,
            "closed": closed_now,
            "open_positions": reviewed_open,
            "skipped_entries": skipped_entries,
            "performance": performance,
        }
        save_latest_cycle(cycle, self.root)
        return cycle

    def _review_open_positions(self, open_positions: list[dict]) -> tuple[list[dict], list[dict]]:
        kept: list[dict] = []
        closed: list[dict] = []
        for position in open_positions:
            refreshed = dict(position)
            refreshed["last_reviewed_at"] = self.now.isoformat()

            analysis = self._analyze_symbol(refreshed["strategy"], refreshed["symbol"])
            if analysis.get("error"):
                refreshed["last_signal_action"] = "UNAVAILABLE"
                refreshed["last_signal_reason"] = str(analysis.get("error"))
                kept.append(refreshed)
                continue

            price = _extract_price(analysis)
            refreshed["current_price"] = price
            refreshed["current_return_pct"] = _pct_change(refreshed["entry_price"], price)
            refreshed["holding_days"] = _holding_days(refreshed["entered_at"], self.now)

            rec = analysis.get("recommendation") or {}
            refreshed["last_signal_action"] = str(rec.get("action") or "UNKNOWN").upper()
            refreshed["last_signal_reason"] = str(rec.get("reason") or "").strip()
            refreshed["market_regime_now"] = str(analysis.get("market_regime") or "unknown")

            path_metrics = self._position_path_metrics(
                symbol=refreshed["symbol"],
                entered_at=refreshed["entered_at"],
                entry_price=float(refreshed["entry_price"]),
            )
            refreshed["max_drawdown_pct"] = path_metrics.get("max_drawdown_pct")
            refreshed["max_runup_pct"] = path_metrics.get("max_runup_pct")

            exit_decision = self._exit_decision(position=refreshed)
            if exit_decision is None:
                kept.append(refreshed)
                continue

            closed.append(
                {
                    **refreshed,
                    "status": "CLOSED",
                    "exited_at": self.now.isoformat(),
                    "exit_price": price,
                    "exit_reason": exit_decision["reason"],
                    "realized_return_pct": refreshed["current_return_pct"],
                }
            )
        return kept, closed

    def _load_entry_candidates(self, *, open_positions: list[dict]) -> tuple[list[dict], list[dict]]:
        latest_snapshots = self._load_latest_prediction_snapshots()
        max_open_positions = int(os.getenv("PAPER_TRADE_MAX_OPEN_POSITIONS", "5"))
        open_symbols = {str(item.get("symbol") or "").upper() for item in open_positions}

        candidates: list[dict] = []
        skipped: list[dict] = []
        for strategy, snapshot in latest_snapshots.items():
            for record in snapshot.get("records") or []:
                symbol = str(record.get("symbol") or "").upper()
                action = str(record.get("action") or "UNKNOWN").upper()
                if action != "BUY":
                    continue
                if symbol in open_symbols:
                    skipped.append({"symbol": symbol, "strategy": strategy, "reason": "already_open"})
                    continue
                candidates.append(
                    {
                        "strategy": strategy,
                        "symbol": symbol,
                        "generated_at": snapshot.get("generated_at"),
                        "score": record.get("score"),
                        "trade_quality_score": record.get("trade_quality_score"),
                        "effective_confidence": record.get("confidence"),
                        "uncertainty_pct": record.get("uncertainty_pct"),
                        "reason": record.get("reason"),
                    }
                )

        ordered = sorted(
            candidates,
            key=lambda item: (
                -float(item.get("trade_quality_score") or item.get("score") or 0.0),
                -float(item.get("effective_confidence") or 0.0),
                float(item.get("uncertainty_pct") or 0.0),
                str(item.get("symbol") or ""),
            ),
        )

        seen_symbols: set[str] = set()
        unique_candidates: list[dict] = []
        available_slots = max(max_open_positions - len(open_symbols), 0)
        max_new_positions = int(os.getenv("PAPER_TRADE_MAX_NEW_POSITIONS_PER_CYCLE", str(max_open_positions)))
        for item in ordered:
            symbol = str(item.get("symbol") or "")
            if symbol in seen_symbols:
                skipped.append({"symbol": symbol, "strategy": item["strategy"], "reason": "duplicate_signal"})
                continue
            seen_symbols.add(symbol)
            unique_candidates.append(item)
            if len(unique_candidates) >= min(available_slots, max_new_positions):
                break
        return unique_candidates, skipped

    def _open_positions(self, candidates: list[dict], *, open_positions: list[dict]) -> list[dict]:
        opened: list[dict] = []
        for candidate in candidates:
            strategy = candidate["strategy"]
            symbol = candidate["symbol"]
            analysis = self._analyze_symbol(strategy, symbol)
            if analysis.get("error"):
                continue
            rec = analysis.get("recommendation") or {}
            if str(rec.get("action") or "").upper() != "BUY":
                continue
            entry_price = _extract_price(analysis)
            stop_price = _extract_stop_price(strategy, analysis, entry_price)
            target_price = _extract_target_price(strategy, entry_price)
            position = {
                "id": f"{strategy}:{symbol}:{self.now.strftime('%Y%m%d%H%M%S')}",
                "status": "OPEN",
                "strategy": strategy,
                "symbol": symbol,
                "entered_at": self.now.isoformat(),
                "entry_price": entry_price,
                "stop_price": stop_price,
                "target_price": target_price,
                "position_size_pct": float(rec.get("position_size_pct") or 0.0),
                "size_label": str(rec.get("size_label") or "STANDARD"),
                "market_regime_at_entry": str(analysis.get("market_regime") or "unknown"),
                "confidence_at_entry": float(rec.get("effective_confidence") or analysis.get("effective_confidence") or 0.0),
                "uncertainty_pct_at_entry": float(rec.get("uncertainty_pct") or analysis.get("uncertainty_pct") or 0.0),
                "score_at_entry": float(rec.get("score") or analysis.get("total_score") or 0.0),
                "trade_quality_score_at_entry": float(
                    rec.get("trade_quality_score") or analysis.get("trade_quality_score") or analysis.get("total_score") or 0.0
                ),
                "entry_reason": str(rec.get("reason") or candidate.get("reason") or ""),
                "entry_reasons": list(rec.get("reasons") or []),
                "entry_signal_generated_at": candidate.get("generated_at"),
                "last_reviewed_at": self.now.isoformat(),
                "current_price": entry_price,
                "current_return_pct": 0.0,
                "max_drawdown_pct": 0.0,
                "max_runup_pct": 0.0,
                "holding_days": 0,
                "last_signal_action": "BUY",
                "last_signal_reason": str(rec.get("reason") or ""),
                "max_hold_days": _max_hold_days(strategy),
            }
            open_positions.append(position)
            opened.append(position)
        return opened

    def _exit_decision(self, *, position: dict) -> dict | None:
        current_price = float(position.get("current_price") or position["entry_price"])
        stop_price = position.get("stop_price")
        target_price = position.get("target_price")
        holding_days = int(position.get("holding_days") or 0)
        max_hold_days = int(position.get("max_hold_days") or _max_hold_days(position["strategy"]))
        last_signal_action = str(position.get("last_signal_action") or "UNKNOWN").upper()

        if isinstance(stop_price, (int, float)) and current_price <= float(stop_price):
            return {"reason": "stop_hit"}
        if isinstance(target_price, (int, float)) and current_price >= float(target_price):
            return {"reason": "target_hit"}
        if holding_days >= max_hold_days:
            return {"reason": "max_hold"}
        if last_signal_action == "NO_BUY":
            return {"reason": "signal_downgrade"}
        return None

    def _position_path_metrics(
        self,
        *,
        symbol: str,
        entered_at: str,
        entry_price: float,
    ) -> dict:
        try:
            history = self.advisor.market_data.get_history(symbol, period="6mo").frame.copy()
        except Exception:
            return {"max_drawdown_pct": 0.0, "max_runup_pct": 0.0}

        if history.empty:
            return {"max_drawdown_pct": 0.0, "max_runup_pct": 0.0}

        history.index = pd.to_datetime(history.index, utc=True)
        entry_dt = _ensure_utc(datetime.fromisoformat(entered_at))
        window = history.loc[history.index >= entry_dt]
        if window.empty:
            return {"max_drawdown_pct": 0.0, "max_runup_pct": 0.0}
        closes = pd.to_numeric(window["Close"], errors="coerce").dropna()
        if closes.empty or not entry_price:
            return {"max_drawdown_pct": 0.0, "max_runup_pct": 0.0}
        return {
            "max_drawdown_pct": round(((float(closes.min()) - entry_price) / entry_price) * 100.0, 3),
            "max_runup_pct": round(((float(closes.max()) - entry_price) / entry_price) * 100.0, 3),
        }

    def _load_latest_prediction_snapshots(self) -> dict[str, dict]:
        snapshots_dir = self.signal_root / "snapshots"
        latest: dict[str, dict] = {}
        if not snapshots_dir.exists():
            return latest
        max_age_hours = float(os.getenv("PAPER_TRADE_SIGNAL_MAX_AGE_HOURS", "18"))
        eligible_strategies = {
            item.strip()
            for item in os.getenv("PAPER_TRADE_ENTRY_STRATEGIES", "canslim,dip_buyer").split(",")
            if item.strip()
        }
        for path in sorted(snapshots_dir.glob("*.json")):
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                continue
            strategy = str(payload.get("strategy") or "").strip()
            if strategy not in eligible_strategies:
                continue
            generated_at = payload.get("generated_at")
            if not generated_at:
                continue
            try:
                generated_dt = _ensure_utc(datetime.fromisoformat(str(generated_at)))
            except ValueError:
                continue
            age_hours = (self.now - generated_dt).total_seconds() / 3600.0
            if age_hours > max_age_hours:
                continue
            existing = latest.get(strategy)
            if existing is None or str(existing.get("generated_at") or "") < str(generated_at):
                latest[strategy] = payload
        return latest

    def _signal_summary(self) -> dict:
        latest = self._load_latest_prediction_snapshots()
        summary = {}
        for strategy, payload in latest.items():
            records = payload.get("records") or []
            buy_count = sum(1 for item in records if str(item.get("action") or "").upper() == "BUY")
            summary[strategy] = {
                "generated_at": payload.get("generated_at"),
                "buy_signals": buy_count,
                "record_count": len(records),
            }
        return summary

    def _analyze_symbol(self, strategy: str, symbol: str) -> dict:
        if strategy == "dip_buyer":
            return self.advisor.analyze_dip_stock(symbol, quiet=True)
        return self.advisor.analyze_stock(symbol, quiet=True, analysis_profile="bulk_scan")


def _extract_price(analysis: dict) -> float:
    rec = analysis.get("recommendation") or {}
    for value in (rec.get("entry"), analysis.get("price")):
        if isinstance(value, (int, float)):
            return float(value)
    return 0.0


def _extract_stop_price(strategy: str, analysis: dict, entry_price: float) -> float:
    rec = analysis.get("recommendation") or {}
    stop = rec.get("stop_loss")
    if isinstance(stop, (int, float)):
        return float(stop)
    if strategy == "dip_buyer":
        stop_pct = float(DIPBUYER_CONFIG["exits"]["hard_stop"])
    else:
        stop_pct = float(os.getenv("PAPER_TRADE_CANSLIM_STOP_PCT", "0.08"))
    return round(entry_price * (1 - stop_pct), 4)


def _extract_target_price(strategy: str, entry_price: float) -> float:
    if strategy == "dip_buyer":
        target_pct = float(os.getenv("PAPER_TRADE_DIPBUYER_TARGET_PCT", str(DIPBUYER_CONFIG["exits"]["trim_2"])))
    else:
        target_pct = float(os.getenv("PAPER_TRADE_CANSLIM_TARGET_PCT", "0.15"))
    return round(entry_price * (1 + target_pct), 4)


def _max_hold_days(strategy: str) -> int:
    if strategy == "dip_buyer":
        return int(os.getenv("PAPER_TRADE_DIPBUYER_MAX_HOLD_DAYS", "10"))
    return int(os.getenv("PAPER_TRADE_CANSLIM_MAX_HOLD_DAYS", "20"))


def _pct_change(entry_price: float, current_price: float) -> float:
    if not entry_price:
        return 0.0
    return round(((current_price - entry_price) / entry_price) * 100.0, 3)


def _holding_days(entered_at: str, now: datetime) -> int:
    entered = _ensure_utc(datetime.fromisoformat(entered_at))
    delta = now - entered
    return max(int(delta.total_seconds() // 86400), 0)


def _ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)
