#!/usr/bin/env python3
"""Build a lightweight prediction accuracy summary for Mission Control."""

from __future__ import annotations

import argparse
import json

from evaluation.prediction_accuracy import build_prediction_accuracy_summary, settle_prediction_snapshots


def main() -> None:
    parser = argparse.ArgumentParser(description='Refresh settled prediction artifacts and emit a compact summary')
    parser.add_argument('--json', action='store_true', help='Emit the summary as JSON')
    parser.add_argument(
        '--max-snapshots-per-run',
        type=int,
        default=1,
        help='Bound how many unsettled snapshots are processed before rebuilding the summary',
    )
    args = parser.parse_args()

    settle_prediction_snapshots(max_snapshots_per_run=max(args.max_snapshots_per_run, 0))
    summary = build_prediction_accuracy_summary()

    if args.json:
        print(json.dumps(summary, indent=2))
        return

    print('Prediction accuracy summary refreshed')
    print(f"Snapshots settled: {int(summary.get('snapshot_count', 0) or 0)}")
    print(f"Records logged: {int(summary.get('record_count', 0) or 0)}")


if __name__ == '__main__':
    main()
