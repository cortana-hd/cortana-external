"""Release-unit packaging helpers for the V4 governed rollout loop."""

from __future__ import annotations

import json
import subprocess
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Mapping, Sequence

from evaluation.artifact_contracts import (
    ARTIFACT_FAMILY_TRADING_RELEASE_UNIT,
    annotate_artifact,
)

DEFAULT_RELEASE_UNIT_PATH = Path(__file__).resolve().parents[1] / ".cache" / "trade_lifecycle" / "release_unit.json"
REPO_ROOT = Path(__file__).resolve().parents[2]
VALID_CANARY_STAGES = {"steady", "shadow", "canary", "staged", "rollback"}


def build_release_unit_artifact(
    *,
    generated_at: str,
    release_key: str,
    code_ref: str | None = None,
    strategy_refs: Sequence[object] | None = None,
    config_refs: Sequence[object] | None = None,
    canary_state: Mapping[str, Any] | None = None,
    rollback_state: Mapping[str, Any] | None = None,
    health_summary: Mapping[str, Any] | None = None,
    mode: str = "steady",
) -> dict[str, Any]:
    normalized_generated_at = _normalize_timestamp(generated_at)
    normalized_code_ref = str(code_ref or _current_code_ref() or "").strip()
    normalized_strategy_refs = [str(item).strip() for item in strategy_refs or [] if str(item).strip()]
    normalized_config_refs = [str(item).strip() for item in config_refs or [] if str(item).strip()]
    normalized_canary = {
        "mode": str((canary_state or {}).get("mode") or mode or "steady"),
        "stage": str((canary_state or {}).get("stage") or mode or "steady"),
        "status": str((canary_state or {}).get("status") or "ok"),
        "summary": str((canary_state or {}).get("summary") or f"{mode} rollout"),
    }
    validation_errors: list[str] = []
    if not normalized_code_ref:
        validation_errors.append("missing_code_ref")
    if not normalized_strategy_refs:
        validation_errors.append("missing_strategy_refs")
    if not normalized_config_refs:
        validation_errors.append("missing_config_refs")
    if normalized_canary["stage"] not in VALID_CANARY_STAGES:
        validation_errors.append("invalid_canary_stage")

    validation = {
        "is_valid": not validation_errors,
        "errors": validation_errors,
    }
    normalized_rollback = {
        "rollback_ready": bool((rollback_state or {}).get("rollback_ready", not validation_errors)),
        "restore_release_key": str((rollback_state or {}).get("restore_release_key") or release_key),
        "summary": str((rollback_state or {}).get("summary") or "Rollback target recorded."),
    }
    normalized_health = {
        "status": str((health_summary or {}).get("status") or ("ok" if not validation_errors else "degraded")),
        "warnings": [str(item).strip() for item in (health_summary or {}).get("warnings") or [] if str(item).strip()],
    }
    warnings = [*validation_errors, *normalized_health["warnings"]]
    status = "ok"
    degraded_status = "healthy"
    if validation_errors or normalized_canary["status"] not in {"ok", "healthy"}:
        status = "degraded"
        degraded_status = "degraded_safe"

    return annotate_artifact(
        {
            "release_key": str(release_key).strip(),
            "code_ref": normalized_code_ref,
            "strategy_refs": normalized_strategy_refs,
            "config_refs": normalized_config_refs,
            "validation": validation,
            "canary_state": normalized_canary,
            "rollback_state": normalized_rollback,
            "health_summary": normalized_health,
            "warnings": warnings,
        },
        artifact_family=ARTIFACT_FAMILY_TRADING_RELEASE_UNIT,
        producer="backtester.release.release_units",
        generated_at=normalized_generated_at,
        known_at=normalized_generated_at,
        status=status,
        degraded_status=degraded_status,
        outcome_class="run_completed",
    )


def save_release_unit_artifact(
    artifact: Mapping[str, Any],
    *,
    path: Path | None = None,
) -> Path:
    target = (path or DEFAULT_RELEASE_UNIT_PATH).expanduser()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(dict(artifact), indent=2) + "\n", encoding="utf-8")
    return target


def load_release_unit_artifact(path: Path | None = None) -> dict[str, Any]:
    target = (path or DEFAULT_RELEASE_UNIT_PATH).expanduser()
    if not target.exists():
        return {}
    payload = json.loads(target.read_text(encoding="utf-8"))
    return dict(payload) if isinstance(payload, dict) else {}


def _current_code_ref() -> str | None:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
    except Exception:
        return None
    if result.returncode != 0:
        return None
    return str(result.stdout).strip() or None


def _normalize_timestamp(value: object) -> str:
    if isinstance(value, str) and value.strip():
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            parsed = datetime.now(UTC)
    else:
        parsed = datetime.now(UTC)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC).isoformat()
