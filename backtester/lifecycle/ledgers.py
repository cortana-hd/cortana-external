"""Deterministic file-backed ledgers for lifecycle artifacts."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from lifecycle.trade_objects import ClosedPosition, LifecycleStateError, OpenPosition


def default_lifecycle_root() -> Path:
    return Path(__file__).resolve().parents[1] / ".cache" / "trade_lifecycle"


class LifecycleLedgerStore:
    def __init__(self, *, root: Path | None = None):
        self.root = (root or default_lifecycle_root()).expanduser().resolve()
        self.open_positions_path = self.root / "open_positions.json"
        self.closed_positions_path = self.root / "closed_positions.json"
        self.position_reviews_path = self.root / "position_reviews.json"
        self.execution_policies_path = self.root / "execution_policies.json"
        self.portfolio_snapshot_path = self.root / "portfolio_snapshot.json"
        self.cycle_summary_path = self.root / "cycle_summary.json"

    def load_open_positions(self) -> list[OpenPosition]:
        payload = self._load_payload(self.open_positions_path)
        return [OpenPosition.from_dict(item) for item in payload.get("positions", [])]

    def load_closed_positions(self) -> list[ClosedPosition]:
        payload = self._load_payload(self.closed_positions_path)
        return [ClosedPosition.from_dict(item) for item in payload.get("positions", [])]

    def write_open_positions(self, positions: Iterable[OpenPosition]) -> Path:
        payload = {
            "artifact_family": "paper_open_positions_ledger",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "positions": [position.to_dict() for position in positions],
        }
        return self._write_payload(self.open_positions_path, payload)

    def write_closed_positions(self, positions: Iterable[ClosedPosition]) -> Path:
        payload = {
            "artifact_family": "paper_closed_positions_ledger",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "positions": [position.to_dict() for position in positions],
        }
        return self._write_payload(self.closed_positions_path, payload)

    def append_open_position(self, position: OpenPosition) -> Path:
        open_positions = self.load_open_positions()
        if any(item.position_key == position.position_key for item in open_positions):
            raise LifecycleStateError(f"Open position already exists for {position.position_key}")
        if any(item.position_key == position.position_key for item in self.load_closed_positions()):
            raise LifecycleStateError(f"Closed lineage already exists for {position.position_key}")
        open_positions.append(position)
        return self.write_open_positions(open_positions)

    def close_position(self, closed_position: ClosedPosition) -> tuple[Path, Path]:
        open_positions = self.load_open_positions()
        matching = [position for position in open_positions if position.position_key == closed_position.position_key]
        if not matching:
            raise LifecycleStateError(f"No open position exists for {closed_position.position_key}")
        remaining = [position for position in open_positions if position.position_key != closed_position.position_key]
        closed_positions = self.load_closed_positions()
        if any(item.position_key == closed_position.position_key for item in closed_positions):
            raise LifecycleStateError(f"Closed position already exists for {closed_position.position_key}")
        closed_positions.append(closed_position)
        open_path = self.write_open_positions(remaining)
        closed_path = self.write_closed_positions(closed_positions)
        return open_path, closed_path

    def _load_payload(self, path: Path) -> dict:
        if not path.exists():
            return {"positions": []}
        return json.loads(path.read_text(encoding="utf-8"))

    def _write_payload(self, path: Path, payload: dict) -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = path.with_suffix(path.suffix + ".tmp")
        tmp_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        tmp_path.replace(path)
        return path

    def write_artifact(self, relative_name: str, payload: dict) -> Path:
        return self._write_payload(self.root / relative_name, payload)

    def load_artifact(self, relative_name: str) -> dict:
        return self._load_payload(self.root / relative_name)
