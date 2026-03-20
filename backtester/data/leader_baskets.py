"""Persist nightly leader history and expose stable priority buckets."""

from __future__ import annotations

import json
import os
from collections import Counter
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Iterable, Optional


DEFAULT_ROOT = Path(__file__).resolve().parent.parent / ".cache" / "leader_baskets"
DEFAULT_LATEST_PATH = DEFAULT_ROOT / "leader-baskets-latest.json"
DEFAULT_SNAPSHOT_PATH = DEFAULT_ROOT / "latest-snapshot.json"
DEFAULT_HISTORY_DIR = DEFAULT_ROOT / "history"


def _coerce_timestamp(value: Optional[str], *, fallback: Optional[datetime] = None) -> datetime:
    if value:
        try:
            parsed = datetime.fromisoformat(str(value))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=UTC)
            return parsed.astimezone(UTC)
        except Exception:
            pass
    return (fallback or datetime.now(UTC)).astimezone(UTC)


def _artifact_paths(root: Optional[str | Path] = None) -> tuple[Path, Path, Path]:
    base = Path(root or os.getenv("TRADING_LEADER_BASKET_ROOT") or DEFAULT_ROOT).expanduser()
    return base, base / "latest-snapshot.json", base / "history"


def _dedupe(symbols: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for raw in symbols:
        symbol = str(raw or "").strip().upper()
        if symbol and symbol not in seen:
            seen.add(symbol)
            ordered.append(symbol)
    return ordered


def _stable_bucket_records(records: list[dict], *, latest_order: list[str] | None = None) -> list[dict]:
    if latest_order:
        order = {symbol: index for index, symbol in enumerate(latest_order)}
        return sorted(records, key=lambda item: (order.get(item["symbol"], len(order)), item["symbol"]))
    return sorted(
        records,
        key=lambda item: (
            -int(item.get("appearances", 0) or 0),
            -float(item.get("avg_rank_score", 0.0) or 0.0),
            -float(item.get("latest_rank_score", 0.0) or 0.0),
            item["symbol"],
        ),
    )


def persist_leader_snapshot(
    *,
    leaders: list[dict],
    generated_at: Optional[str] = None,
    market_regime: str = "unknown",
    universe_size: int = 0,
    root: Optional[str | Path] = None,
) -> tuple[dict, Path]:
    """Write the latest nightly leader snapshot and append to history."""
    ts = _coerce_timestamp(generated_at)
    base_root, snapshot_path, history_dir = _artifact_paths(root)
    base_root.mkdir(parents=True, exist_ok=True)
    history_dir.mkdir(parents=True, exist_ok=True)

    normalized = []
    for item in leaders:
        if not isinstance(item, dict):
            continue
        symbol = str(item.get("symbol", "")).strip().upper()
        if not symbol:
            continue
        normalized.append(
            {
                "symbol": symbol,
                "price": float(item.get("price", 0.0) or 0.0),
                "action": str(item.get("action", "NO_BUY") or "NO_BUY"),
                "rank_score": float(item.get("rank_score", 0.0) or 0.0),
                "confidence": int(item.get("confidence", 0) or 0),
                "technical_score": int(item.get("technical_score", 0) or 0),
                "total_score": int(item.get("total_score", 0) or 0),
                "reason": str(item.get("reason", "") or ""),
            }
        )

    snapshot = {
        "schema_version": 1,
        "artifact_type": "leader_snapshot",
        "generated_at": ts.isoformat(),
        "market_regime": str(market_regime or "unknown"),
        "universe_size": int(universe_size or 0),
        "leader_count": len(normalized),
        "leaders": normalized,
    }
    text = json.dumps(snapshot, indent=2) + "\n"
    snapshot_path.write_text(text, encoding="utf-8")
    history_path = history_dir / f"{ts.strftime('%Y-%m-%dT%H-%M-%S-%fZ')}.json"
    history_path.write_text(text, encoding="utf-8")
    return snapshot, history_path


def build_leader_baskets(
    *,
    root: Optional[str | Path] = None,
    generated_at: Optional[str] = None,
    now: Optional[datetime] = None,
) -> tuple[dict, Path]:
    """Aggregate daily/weekly/monthly leader buckets from nightly snapshots."""
    base_root, snapshot_path, history_dir = _artifact_paths(root)
    base_root.mkdir(parents=True, exist_ok=True)
    history_dir.mkdir(parents=True, exist_ok=True)
    current_ts = _coerce_timestamp(generated_at, fallback=now)

    snapshots: list[dict] = []
    cutoff = current_ts - timedelta(days=31)
    for path in sorted(history_dir.glob("*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(payload, dict):
            continue
        ts = _coerce_timestamp(payload.get("generated_at"))
        if ts < cutoff:
            continue
        leaders = payload.get("leaders")
        if not isinstance(leaders, list):
            continue
        snapshots.append({"path": str(path), "generated_at": ts, "leaders": leaders})

    latest_snapshot = None
    if snapshot_path.exists():
        try:
            latest_snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
        except Exception:
            latest_snapshot = None

    latest_symbols = _dedupe(
        item.get("symbol", "")
        for item in (latest_snapshot or {}).get("leaders", [])
        if isinstance(item, dict)
    )

    def _bucket(window_days: int, *, limit: int, latest_only: bool = False) -> list[dict]:
        if latest_only and latest_snapshot:
            leaders = latest_snapshot.get("leaders", [])
            ordered = []
            for item in leaders:
                if not isinstance(item, dict):
                    continue
                ordered.append(
                    {
                        "symbol": str(item.get("symbol", "")).upper(),
                        "appearances": 1,
                        "latest_price": float(item.get("price", 0.0) or 0.0),
                        "window_return_pct": _recent_change_pct(snapshots=snapshots, symbol=str(item.get("symbol", "")).upper()),
                        "avg_rank_score": float(item.get("rank_score", 0.0) or 0.0),
                        "latest_rank_score": float(item.get("rank_score", 0.0) or 0.0),
                        "avg_confidence": float(item.get("confidence", 0) or 0),
                        "actions": [str(item.get("action", "NO_BUY") or "NO_BUY")],
                    }
                )
            return _stable_bucket_records(ordered, latest_order=latest_symbols)[:limit]

        bucket_cutoff = current_ts - timedelta(days=window_days)
        appearances: Counter[str] = Counter()
        rank_scores: dict[str, list[float]] = {}
        confidences: dict[str, list[float]] = {}
        actions: dict[str, set[str]] = {}
        latest_rank: dict[str, float] = {}
        latest_price: dict[str, float] = {}
        earliest_price: dict[str, float] = {}

        for snapshot in snapshots:
            if snapshot["generated_at"] < bucket_cutoff:
                continue
            for item in snapshot["leaders"]:
                if not isinstance(item, dict):
                    continue
                symbol = str(item.get("symbol", "")).strip().upper()
                if not symbol:
                    continue
                appearances[symbol] += 1
                rank_scores.setdefault(symbol, []).append(float(item.get("rank_score", 0.0) or 0.0))
                confidences.setdefault(symbol, []).append(float(item.get("confidence", 0) or 0))
                actions.setdefault(symbol, set()).add(str(item.get("action", "NO_BUY") or "NO_BUY"))
                latest_rank[symbol] = float(item.get("rank_score", 0.0) or 0.0)
                price = float(item.get("price", 0.0) or 0.0)
                if price > 0:
                    earliest_price.setdefault(symbol, price)
                    latest_price[symbol] = price

        records = []
        for symbol, count in appearances.items():
            scores = rank_scores.get(symbol, [0.0])
            confidence_values = confidences.get(symbol, [0.0])
            current_price = float(latest_price.get(symbol, 0.0) or 0.0)
            start_price = float(earliest_price.get(symbol, 0.0) or 0.0)
            window_return_pct = None
            if start_price > 0 and current_price > 0 and count > 1:
                window_return_pct = round(((current_price / start_price) - 1.0) * 100.0, 1)
            records.append(
                {
                    "symbol": symbol,
                    "appearances": int(count),
                    "latest_price": round(current_price, 2) if current_price > 0 else None,
                    "window_return_pct": window_return_pct,
                    "avg_rank_score": round(sum(scores) / max(len(scores), 1), 2),
                    "latest_rank_score": round(float(latest_rank.get(symbol, 0.0)), 2),
                    "avg_confidence": round(sum(confidence_values) / max(len(confidence_values), 1), 1),
                    "actions": sorted(actions.get(symbol, {"NO_BUY"})),
                }
            )
        return _stable_bucket_records(records)[:limit]

    daily = _bucket(1, limit=12, latest_only=True)
    weekly = _bucket(7, limit=16)
    monthly = _bucket(30, limit=20)

    priority_symbols = _dedupe(
        [
            *(item["symbol"] for item in daily[:4]),
            *(item["symbol"] for item in weekly[:6]),
            *(item["symbol"] for item in monthly[:8]),
        ]
    )

    artifact = {
        "schema_version": 1,
        "artifact_type": "leader_baskets",
        "generated_at": current_ts.isoformat(),
        "source": {
            "snapshot_path": str(snapshot_path),
            "history_dir": str(history_dir),
            "history_count": len(snapshots),
        },
        "windows": {
            "daily_days": 1,
            "weekly_days": 7,
            "monthly_days": 30,
        },
        "buckets": {
            "daily": daily,
            "weekly": weekly,
            "monthly": monthly,
        },
        "priority": {
            "symbols": priority_symbols,
            "daily": [item["symbol"] for item in daily[:4]],
            "weekly": [item["symbol"] for item in weekly[:6]],
            "monthly": [item["symbol"] for item in monthly[:8]],
        },
    }
    latest_path = base_root / "leader-baskets-latest.json"
    latest_path.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")
    _write_bucket_text_files(base_root=base_root, artifact=artifact)
    return artifact, latest_path


def refresh_leader_baskets(
    *,
    leaders: list[dict],
    generated_at: Optional[str] = None,
    market_regime: str = "unknown",
    universe_size: int = 0,
    root: Optional[str | Path] = None,
) -> tuple[dict, Path]:
    """Persist a fresh snapshot then rebuild the aggregated leader baskets artifact."""
    snapshot, _ = persist_leader_snapshot(
        leaders=leaders,
        generated_at=generated_at,
        market_regime=market_regime,
        universe_size=universe_size,
        root=root,
    )
    return build_leader_baskets(root=root, generated_at=snapshot.get("generated_at"))


def load_leader_priority_symbols(
    *,
    path: Optional[str | Path] = None,
    max_age_hours: Optional[float] = None,
    bucket: Optional[str] = None,
) -> list[str]:
    """Load the recommended priority list from the latest leader baskets artifact."""
    latest_path = Path(path or os.getenv("TRADING_LEADER_BASKET_PATH") or DEFAULT_LATEST_PATH).expanduser()
    if not latest_path.exists():
        return []
    try:
        payload = json.loads(latest_path.read_text(encoding="utf-8"))
    except Exception:
        return []
    if not isinstance(payload, dict):
        return []

    age_limit = float(
        max_age_hours
        if max_age_hours is not None
        else os.getenv("TRADING_LEADER_BASKET_MAX_AGE_HOURS", "48")
    )
    generated_at = _coerce_timestamp(payload.get("generated_at"))
    age_hours = max((datetime.now(UTC) - generated_at).total_seconds(), 0.0) / 3600.0
    if age_limit >= 0 and age_hours > age_limit:
        return []

    priority = payload.get("priority")
    bucket_name = str(
        bucket
        or os.getenv("TRADING_LEADER_BASKET_PRIORITY_WINDOW", "combined")
    ).strip().lower()
    if bucket_name in {"daily", "weekly", "monthly"}:
        if isinstance(priority, dict):
            return _dedupe(priority.get(bucket_name, []))
        return []
    if not isinstance(priority, dict):
        return []
    return _dedupe(priority.get("symbols", []))


def _write_bucket_text_files(*, base_root: Path, artifact: dict) -> None:
    buckets = artifact.get("buckets") if isinstance(artifact.get("buckets"), dict) else {}
    priority = artifact.get("priority") if isinstance(artifact.get("priority"), dict) else {}

    def _symbols(items: object) -> list[str]:
        if not isinstance(items, list):
            return []
        return _dedupe(
            item.get("symbol", "")
            for item in items
            if isinstance(item, dict)
        )

    def _lines(items: object) -> list[str]:
        if not isinstance(items, list):
            return []
        out: list[str] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            symbol = str(item.get("symbol", "")).strip().upper()
            if not symbol:
                continue
            change = item.get("window_return_pct")
            appearances = int(item.get("appearances", 0) or 0)
            if change is None:
                out.append(f"{symbol} n/a ({appearances}x)")
            else:
                out.append(f"{symbol} {float(change):+.1f}% ({appearances}x)")
        return out

    files = {
        "daily.txt": _lines(buckets.get("daily")),
        "weekly.txt": _lines(buckets.get("weekly")),
        "monthly.txt": _lines(buckets.get("monthly")),
        "priority.txt": _dedupe(priority.get("symbols", [])) if isinstance(priority, dict) else [],
    }
    for name, symbols in files.items():
        content = "\n".join(symbols).strip()
        path = base_root / name
        path.write_text((content + "\n") if content else "", encoding="utf-8")


def _recent_change_pct(*, snapshots: list[dict], symbol: str) -> float | None:
    prices: list[float] = []
    for snapshot in snapshots:
        for item in snapshot["leaders"]:
            if not isinstance(item, dict):
                continue
            if str(item.get("symbol", "")).strip().upper() != symbol:
                continue
            price = float(item.get("price", 0.0) or 0.0)
            if price > 0:
                prices.append(price)
    if len(prices) < 2:
        return None
    start_price = float(prices[-2])
    latest_price = float(prices[-1])
    if start_price <= 0 or latest_price <= 0:
        return None
    return round(((latest_price / start_price) - 1.0) * 100.0, 1)
