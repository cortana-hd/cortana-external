#!/usr/bin/env python3
"""Run the paper-trade lifecycle and print operator-facing actions."""

from __future__ import annotations

import argparse

from evaluation.paper_trade_engine import PaperTradeEngine


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the paper-trade lifecycle")
    parser.add_argument("--mode", choices=["daytime", "nighttime", "manual"], default="manual")
    parser.add_argument("--entries-enabled", action="store_true", help="Allow new paper entries")
    parser.add_argument("--entries-disabled", action="store_true", help="Disable new paper entries")
    parser.add_argument("--json", action="store_true", help="Emit the cycle artifact as JSON")
    args = parser.parse_args()

    entries_enabled = None
    if args.entries_enabled:
        entries_enabled = True
    if args.entries_disabled:
        entries_enabled = False

    engine = PaperTradeEngine()
    cycle = engine.run(mode=args.mode, entries_enabled=entries_enabled)

    if args.json:
        import json

        print(json.dumps(cycle, indent=2))
        return

    print(format_cycle(cycle))


def format_cycle(cycle: dict) -> str:
    performance = cycle.get("performance") or {}
    overall = performance.get("overall") or {}
    lines = [
        "Paper trade cycle",
        f"- Mode: {cycle.get('mode')}",
        f"- Entries enabled: {'yes' if cycle.get('entries_enabled') else 'no'}",
        f"- Open positions: {len(cycle.get('open_positions') or [])} | Closed trades: {int(performance.get('closed_trades', 0) or 0)}",
        (
            "- Closed-trade performance: "
            f"win rate {float(overall.get('win_rate', 0.0) or 0.0):.0%} | "
            f"avg return {float(overall.get('avg_return_pct', 0.0) or 0.0):+.2f}% | "
            f"profit factor {_fmt_profit_factor(overall.get('profit_factor'))}"
        ),
    ]

    signal_summary = cycle.get("signals_used") or {}
    if signal_summary:
        bits = []
        for strategy, payload in sorted(signal_summary.items()):
            bits.append(f"{strategy} {int(payload.get('buy_signals', 0) or 0)} BUY")
        lines.append("- Latest entry signals: " + " | ".join(bits))

    opened = cycle.get("opened") or []
    if opened:
        lines.append("- Opened now:")
        for item in opened:
            lines.append(
                "  "
                + f"{item['symbol']} {item['strategy']} | entry ${float(item.get('entry_price', 0.0)):.2f} | "
                + f"stop ${float(item.get('stop_price', 0.0)):.2f} | target ${float(item.get('target_price', 0.0)):.2f} | "
                + f"size {float(item.get('position_size_pct', 0.0) or 0.0):.1f}% {item.get('size_label', 'STANDARD')}"
            )
    else:
        lines.append("- Opened now: none")

    closed = cycle.get("closed") or []
    if closed:
        lines.append("- Sell now / closed now:")
        for item in closed:
            lines.append(
                "  "
                + f"{item['symbol']} {item['strategy']} | exit {item.get('exit_reason')} | "
                + f"return {float(item.get('realized_return_pct', 0.0) or 0.0):+.2f}% | "
                + f"held {int(item.get('holding_days', 0) or 0)}d"
            )
    else:
        lines.append("- Sell now / closed now: none")

    open_positions = cycle.get("open_positions") or []
    if open_positions:
        lines.append("- Open positions:")
        for item in open_positions[:5]:
            lines.append(
                "  "
                + f"{item['symbol']} {item['strategy']} | "
                + f"{float(item.get('current_return_pct', 0.0) or 0.0):+.2f}% | "
                + f"stop ${float(item.get('stop_price', 0.0) or 0.0):.2f} | "
                + f"target ${float(item.get('target_price', 0.0) or 0.0):.2f} | "
                + f"latest {item.get('last_signal_action', 'UNKNOWN')}"
            )
    return "\n".join(lines)


def _fmt_profit_factor(value: object) -> str:
    if isinstance(value, (int, float)):
        return f"{float(value):.2f}"
    return "n/a"


if __name__ == "__main__":
    main()
