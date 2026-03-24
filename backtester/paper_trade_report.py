#!/usr/bin/env python3
"""Render the latest paper-trade ledger and performance summary."""

from __future__ import annotations

from evaluation.paper_trade_ledger import (
    load_closed_positions,
    load_latest_cycle,
    load_open_positions,
    load_performance_summary,
)


def main() -> None:
    cycle = load_latest_cycle()
    open_positions = load_open_positions()
    closed_positions = load_closed_positions()
    performance = load_performance_summary()

    print("Paper trade report")
    print(f"- Open positions: {len(open_positions)}")
    print(f"- Closed trades: {len(closed_positions)}")

    if cycle:
        print(f"- Latest cycle: {cycle.get('mode')} | {cycle.get('generated_at')}")

    if performance:
        overall = performance.get("overall") or {}
        profit_factor = overall.get("profit_factor")
        profit_text = f"{float(profit_factor):.2f}" if isinstance(profit_factor, (int, float)) else "n/a"
        print(
            "- Overall performance: "
            f"win rate {float(overall.get('win_rate', 0.0) or 0.0):.0%} | "
            f"avg return {float(overall.get('avg_return_pct', 0.0) or 0.0):+.2f}% | "
            f"profit factor {profit_text}"
        )
        by_strategy = performance.get("by_strategy") or {}
        if by_strategy:
            print("- By strategy:")
            for strategy, metrics in sorted(by_strategy.items()):
                profit_factor = metrics.get("profit_factor")
                profit_text = f"{float(profit_factor):.2f}" if isinstance(profit_factor, (int, float)) else "n/a"
                print(
                    "  "
                    + f"{strategy}: {int(metrics.get('closed_trades', 0) or 0)} trades | "
                    + f"win rate {float(metrics.get('win_rate', 0.0) or 0.0):.0%} | "
                    + f"avg return {float(metrics.get('avg_return_pct', 0.0) or 0.0):+.2f}% | "
                    + f"profit factor {profit_text}"
                )

    if open_positions:
        print("- Open positions:")
        for item in open_positions[:10]:
            print(
                "  "
                + f"{item['symbol']} {item['strategy']} | "
                + f"entry ${float(item.get('entry_price', 0.0) or 0.0):.2f} | "
                + f"current {float(item.get('current_return_pct', 0.0) or 0.0):+.2f}% | "
                + f"stop ${float(item.get('stop_price', 0.0) or 0.0):.2f} | "
                + f"target ${float(item.get('target_price', 0.0) or 0.0):.2f}"
            )

    if closed_positions:
        print("- Recent closed trades:")
        for item in closed_positions[-10:]:
            print(
                "  "
                + f"{item['symbol']} {item['strategy']} | "
                + f"exit {item.get('exit_reason')} | "
                + f"return {float(item.get('realized_return_pct', 0.0) or 0.0):+.2f}% | "
                + f"held {int(item.get('holding_days', 0) or 0)}d"
            )


if __name__ == "__main__":
    main()
