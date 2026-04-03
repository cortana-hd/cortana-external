#!/usr/bin/env python3
"""Emit a runtime-health snapshot artifact."""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path

from operator_surfaces.runtime_health import build_runtime_health_snapshot


def main() -> None:
    parser = argparse.ArgumentParser(description="Build runtime health snapshot.")
    parser.add_argument("--pretty", action="store_true")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--service-base-url", default="http://127.0.0.1:3033")
    args = parser.parse_args()

    payload = build_runtime_health_snapshot(
        generated_at=datetime.now(UTC).isoformat(),
        service_base_url=args.service_base_url,
    )
    text = json.dumps(payload, indent=2 if args.pretty else None, sort_keys=True)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text + "\n", encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
