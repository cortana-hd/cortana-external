#!/usr/bin/env python3
"""Emit the runtime inventory artifact."""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path

from operator_surfaces.runtime_inventory import build_runtime_inventory_artifact


def main() -> None:
    parser = argparse.ArgumentParser(description="Build runtime inventory artifact.")
    parser.add_argument("--pretty", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    payload = build_runtime_inventory_artifact(generated_at=datetime.now(UTC).isoformat())
    text = json.dumps(payload, indent=2 if args.pretty else None, sort_keys=True)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text + "\n", encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
