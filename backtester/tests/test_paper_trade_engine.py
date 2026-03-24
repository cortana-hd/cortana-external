from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd

from evaluation.paper_trade_engine import PaperTradeEngine


class _HistoryResult:
    def __init__(self, frame: pd.DataFrame):
        self.frame = frame


class _FakeMarketData:
    def __init__(self, histories: dict[str, pd.DataFrame]):
        self._histories = histories

    def get_history(self, symbol: str, period: str = "6mo"):
        return _HistoryResult(self._histories[symbol].copy())


class _FakeAdvisor:
    def __init__(
        self,
        *,
        canslim_analysis: dict[str, dict] | None = None,
        dip_analysis: dict[str, dict] | None = None,
        histories: dict[str, pd.DataFrame] | None = None,
    ):
        self._canslim_analysis = canslim_analysis or {}
        self._dip_analysis = dip_analysis or {}
        self.market_data = _FakeMarketData(histories or {})

    def analyze_stock(self, symbol: str, quiet: bool = True, analysis_profile: str = "bulk_scan") -> dict:
        return dict(self._canslim_analysis[symbol])

    def analyze_dip_stock(self, symbol: str, quiet: bool = True) -> dict:
        return dict(self._dip_analysis[symbol])


def _write_snapshot(root: Path, *, strategy: str, generated_at: datetime, records: list[dict]) -> None:
    snapshots_dir = root / "snapshots"
    snapshots_dir.mkdir(parents=True, exist_ok=True)
    path = snapshots_dir / f"{generated_at.strftime('%Y%m%d-%H%M%S-%f')}-{strategy}.json"
    path.write_text(
        json.dumps(
            {
                "strategy": strategy,
                "market_regime": "confirmed_uptrend",
                "generated_at": generated_at.isoformat(),
                "records": records,
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def test_paper_trade_cycle_opens_position_from_latest_buy_snapshot(tmp_path, monkeypatch):
    now = datetime(2026, 3, 24, 15, 0, tzinfo=timezone.utc)
    signal_root = tmp_path / "prediction_accuracy"
    _write_snapshot(
        signal_root,
        strategy="canslim",
        generated_at=now - timedelta(minutes=5),
        records=[
            {
                "symbol": "AAPL",
                "action": "BUY",
                "score": 9,
                "trade_quality_score": 8.4,
                "confidence": 72,
                "uncertainty_pct": 18,
                "reason": "clean breakout",
            }
        ],
    )

    history = pd.DataFrame(
        {"Close": [100.0, 101.0]},
        index=pd.to_datetime(
            [datetime(2026, 3, 23, tzinfo=timezone.utc), datetime(2026, 3, 24, tzinfo=timezone.utc)]
        ),
    )
    advisor = _FakeAdvisor(
        canslim_analysis={
            "AAPL": {
                "symbol": "AAPL",
                "price": 100.0,
                "market_regime": "confirmed_uptrend",
                "effective_confidence": 72,
                "uncertainty_pct": 18,
                "trade_quality_score": 8.4,
                "recommendation": {
                    "action": "BUY",
                    "entry": 100.0,
                    "stop_loss": 92.0,
                    "position_size_pct": 5.0,
                    "size_label": "STANDARD",
                    "effective_confidence": 72,
                    "uncertainty_pct": 18,
                    "score": 9,
                    "trade_quality_score": 8.4,
                    "reason": "clean breakout",
                    "reasons": ["breakout confirmed"],
                },
            }
        },
        histories={"AAPL": history},
    )

    monkeypatch.setenv("PAPER_TRADE_MAX_OPEN_POSITIONS", "5")
    monkeypatch.setenv("PAPER_TRADE_MAX_NEW_POSITIONS_PER_CYCLE", "2")
    engine = PaperTradeEngine(advisor=advisor, root=tmp_path / "paper_trades", signal_root=signal_root, now=now)

    cycle = engine.run(mode="daytime")

    assert len(cycle["opened"]) == 1
    assert cycle["opened"][0]["symbol"] == "AAPL"
    assert cycle["opened"][0]["target_price"] == 115.0
    assert cycle["closed"] == []
    assert len(cycle["open_positions"]) == 1


def test_paper_trade_cycle_closes_position_when_target_hits(tmp_path):
    now = datetime(2026, 3, 24, 15, 0, tzinfo=timezone.utc)
    root = tmp_path / "paper_trades"
    root.mkdir(parents=True, exist_ok=True)
    (root / "open_positions.json").write_text(
        json.dumps(
            [
                {
                    "id": "canslim:AAPL:20260319150000",
                    "status": "OPEN",
                    "strategy": "canslim",
                    "symbol": "AAPL",
                    "entered_at": (now - timedelta(days=5)).isoformat(),
                    "entry_price": 100.0,
                    "stop_price": 92.0,
                    "target_price": 110.0,
                    "position_size_pct": 5.0,
                    "size_label": "STANDARD",
                    "last_signal_action": "BUY",
                    "last_signal_reason": "clean breakout",
                    "max_hold_days": 20,
                }
            ],
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    history = pd.DataFrame(
        {"Close": [100.0, 95.0, 112.0]},
        index=pd.to_datetime(
            [
                now - timedelta(days=5),
                now - timedelta(days=3),
                now - timedelta(days=1),
            ],
            utc=True,
        ),
    )
    advisor = _FakeAdvisor(
        canslim_analysis={
            "AAPL": {
                "symbol": "AAPL",
                "price": 112.0,
                "market_regime": "confirmed_uptrend",
                "recommendation": {"action": "BUY", "reason": "still constructive"},
            }
        },
        histories={"AAPL": history},
    )
    engine = PaperTradeEngine(advisor=advisor, root=root, signal_root=tmp_path / "prediction_accuracy", now=now)

    cycle = engine.run(mode="nighttime", entries_enabled=False)

    assert len(cycle["closed"]) == 1
    assert cycle["closed"][0]["exit_reason"] == "target_hit"
    assert cycle["closed"][0]["realized_return_pct"] == 12.0
    assert cycle["open_positions"] == []
    assert cycle["performance"]["overall"]["closed_trades"] == 1
    assert cycle["performance"]["overall"]["win_rate"] == 1.0
