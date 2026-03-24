from __future__ import annotations

import paper_trade_report


def test_paper_trade_report_renders_positions_and_strategy_metrics(monkeypatch, capsys):
    monkeypatch.setattr(
        paper_trade_report,
        "load_latest_cycle",
        lambda: {"mode": "daytime", "generated_at": "2026-03-24T15:00:00+00:00"},
    )
    monkeypatch.setattr(
        paper_trade_report,
        "load_open_positions",
        lambda: [
            {
                "symbol": "AAPL",
                "strategy": "canslim",
                "entry_price": 100.0,
                "current_return_pct": 4.2,
                "stop_price": 92.0,
                "target_price": 115.0,
            }
        ],
    )
    monkeypatch.setattr(
        paper_trade_report,
        "load_closed_positions",
        lambda: [
            {
                "symbol": "MSFT",
                "strategy": "dip_buyer",
                "exit_reason": "target_hit",
                "realized_return_pct": 8.5,
                "holding_days": 6,
            }
        ],
    )
    monkeypatch.setattr(
        paper_trade_report,
        "load_performance_summary",
        lambda: {
            "overall": {"win_rate": 1.0, "avg_return_pct": 8.5, "profit_factor": None},
            "by_strategy": {
                "dip_buyer": {"closed_trades": 1, "win_rate": 1.0, "avg_return_pct": 8.5, "profit_factor": None}
            },
        },
    )

    paper_trade_report.main()

    out = capsys.readouterr().out
    assert "Paper trade report" in out
    assert "- Latest cycle: daytime | 2026-03-24T15:00:00+00:00" in out
    assert "AAPL canslim | entry $100.00 | current +4.20%" in out
    assert "MSFT dip_buyer | exit target_hit | return +8.50% | held 6d" in out
    assert "dip_buyer: 1 trades | win rate 100% | avg return +8.50% | profit factor n/a" in out
