"""Experiment registry and governance artifact helpers."""

from __future__ import annotations

import json
import os
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Mapping

DEFAULT_GOVERNANCE_ROOT = Path(__file__).resolve().parent
DEFAULT_REGISTRY_PATH = DEFAULT_GOVERNANCE_ROOT / "experiment_registry.json"
DEFAULT_PROMOTION_GATES_PATH = DEFAULT_GOVERNANCE_ROOT / "promotion_gates.json"
DEFAULT_DEMOTION_RULES_PATH = DEFAULT_GOVERNANCE_ROOT / "demotion_rules.json"

REGISTRY_SCHEMA_VERSION = 1
GOVERNANCE_DECISION_SCHEMA_VERSION = 1
VALID_REGISTRY_STATUSES = {"draft", "shadow", "challenger", "incumbent", "retired", "blocked"}
VALID_DECISION_TYPES = {"promotion", "demotion", "retirement", "block"}
VALID_DECISION_RESULTS = {"pass", "fail", "advisory", "pending"}
ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "draft": {"shadow", "blocked", "retired"},
    "shadow": {"challenger", "blocked", "retired"},
    "challenger": {"incumbent", "shadow", "blocked", "retired"},
    "incumbent": {"challenger", "retired", "blocked"},
    "retired": set(),
    "blocked": {"shadow", "retired"},
}


class GovernanceRegistryError(ValueError):
    """Raised when governance registry state is malformed or invalid."""


def build_registry_entry(
    *,
    experiment_key: str,
    artifact_family: str,
    owner: str,
    status: str,
    title: str | None = None,
    incumbent_key: str | None = None,
    config_refs: Mapping[str, Any] | None = None,
    lineage: Mapping[str, Any] | None = None,
    notes: Mapping[str, Any] | None = None,
    activation: Mapping[str, Any] | None = None,
    created_at: str | None = None,
    updated_at: str | None = None,
) -> dict[str, Any]:
    now = _normalize_timestamp(updated_at or created_at or datetime.now(UTC).isoformat())
    entry = {
        "schema_version": REGISTRY_SCHEMA_VERSION,
        "experiment_key": _normalize_key(experiment_key),
        "artifact_family": str(artifact_family or "").strip(),
        "title": str(title or experiment_key).strip(),
        "owner": str(owner or "").strip(),
        "status": str(status or "").strip().lower(),
        "incumbent_key": _normalize_optional_key(incumbent_key),
        "config_refs": dict(config_refs or {}),
        "lineage": dict(lineage or {}),
        "notes": dict(notes or {}),
        "activation": dict(activation or {"mode": "compare_only", "enforced": False}),
        "created_at": _normalize_timestamp(created_at or now),
        "updated_at": now,
        "audit": {
            "last_transition_at": now,
            "last_transition_reason": str((notes or {}).get("reason") or "created").strip(),
            "transition_count": 0,
        },
    }
    validate_registry_entry(entry)
    return entry


def validate_registry_entry(entry: Mapping[str, Any]) -> dict[str, Any]:
    experiment_key = _normalize_key(entry.get("experiment_key"))
    artifact_family = str(entry.get("artifact_family") or "").strip()
    owner = str(entry.get("owner") or "").strip()
    status = str(entry.get("status") or "").strip().lower()
    if not artifact_family:
        raise GovernanceRegistryError("registry entry requires artifact_family")
    if not owner:
        raise GovernanceRegistryError(f"{experiment_key}: registry entry requires owner")
    if status not in VALID_REGISTRY_STATUSES:
        raise GovernanceRegistryError(f"{experiment_key}: unsupported status {status}")
    if not isinstance(entry.get("config_refs") or {}, dict):
        raise GovernanceRegistryError(f"{experiment_key}: config_refs must be a dict")
    if not isinstance(entry.get("lineage") or {}, dict):
        raise GovernanceRegistryError(f"{experiment_key}: lineage must be a dict")
    if not isinstance(entry.get("activation") or {}, dict):
        raise GovernanceRegistryError(f"{experiment_key}: activation must be a dict")
    _normalize_timestamp(entry.get("created_at"))
    _normalize_timestamp(entry.get("updated_at"))
    return dict(entry)


def transition_registry_entry(
    entry: Mapping[str, Any],
    *,
    to_status: str,
    reason: str,
    decided_at: str | None = None,
    incumbent_key: str | None = None,
    activation: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    validate_registry_entry(entry)
    current_status = str(entry.get("status") or "").strip().lower()
    target_status = str(to_status or "").strip().lower()
    if target_status not in VALID_REGISTRY_STATUSES:
        raise GovernanceRegistryError(f"{entry.get('experiment_key')}: unsupported transition target {target_status}")
    if current_status != target_status and target_status not in ALLOWED_TRANSITIONS.get(current_status, set()):
        raise GovernanceRegistryError(
            f"{entry.get('experiment_key')}: invalid transition {current_status} -> {target_status}"
        )
    now = _normalize_timestamp(decided_at or datetime.now(UTC).isoformat())
    updated = deepcopy(dict(entry))
    updated["status"] = target_status
    if incumbent_key is not None:
        updated["incumbent_key"] = _normalize_optional_key(incumbent_key)
    if activation is not None:
        updated["activation"] = dict(activation)
    audit = dict(updated.get("audit") or {})
    audit["last_transition_at"] = now
    audit["last_transition_reason"] = str(reason or "").strip() or "transition"
    audit["transition_count"] = int(audit.get("transition_count", 0) or 0) + 1
    updated["audit"] = audit
    updated["updated_at"] = now
    validate_registry_entry(updated)
    return updated


def load_experiment_registry(path: str | Path | None = None) -> dict[str, Any]:
    target = Path(path or DEFAULT_REGISTRY_PATH).expanduser()
    if not target.exists():
        return {"schema_version": REGISTRY_SCHEMA_VERSION, "generated_at": None, "experiments": []}
    payload = json.loads(target.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise GovernanceRegistryError("experiment registry must be a JSON object")
    experiments = payload.get("experiments") or []
    if not isinstance(experiments, list):
        raise GovernanceRegistryError("experiment registry experiments must be a list")
    seen: set[str] = set()
    normalized: list[dict[str, Any]] = []
    for item in experiments:
        if not isinstance(item, dict):
            raise GovernanceRegistryError("experiment registry entry must be an object")
        entry = validate_registry_entry(item)
        key = str(entry["experiment_key"])
        if key in seen:
            raise GovernanceRegistryError(f"duplicate experiment_key: {key}")
        seen.add(key)
        normalized.append(entry)
    return {
        "schema_version": int(payload.get("schema_version", REGISTRY_SCHEMA_VERSION)),
        "generated_at": payload.get("generated_at"),
        "experiments": normalized,
    }


def save_experiment_registry(payload: Mapping[str, Any], path: str | Path | None = None) -> Path:
    target = Path(path or DEFAULT_REGISTRY_PATH).expanduser()
    target.parent.mkdir(parents=True, exist_ok=True)
    registry = load_experiment_registry_from_payload(payload)
    registry["generated_at"] = datetime.now(UTC).isoformat()
    _write_json(target, registry)
    return target


def load_experiment_registry_from_payload(payload: Mapping[str, Any]) -> dict[str, Any]:
    experiments = payload.get("experiments") or []
    if not isinstance(experiments, list):
        raise GovernanceRegistryError("experiment registry experiments must be a list")
    seen: set[str] = set()
    normalized: list[dict[str, Any]] = []
    for item in experiments:
        if not isinstance(item, Mapping):
            raise GovernanceRegistryError("experiment registry entry must be an object")
        entry = validate_registry_entry(dict(item))
        key = str(entry["experiment_key"])
        if key in seen:
            raise GovernanceRegistryError(f"duplicate experiment_key: {key}")
        seen.add(key)
        normalized.append(entry)
    return {
        "schema_version": int(payload.get("schema_version", REGISTRY_SCHEMA_VERSION)),
        "generated_at": payload.get("generated_at"),
        "experiments": normalized,
    }


def build_governance_decision_artifact(
    *,
    experiment_key: str,
    decision_type: str,
    decision_result: str,
    gate_results: Mapping[str, Any],
    reasons: list[str],
    effective_from: str | None = None,
    effective_until: str | None = None,
    lineage: Mapping[str, Any] | None = None,
    generated_at: str | None = None,
) -> dict[str, Any]:
    normalized_type = str(decision_type or "").strip().lower()
    normalized_result = str(decision_result or "").strip().lower()
    if normalized_type not in VALID_DECISION_TYPES:
        raise GovernanceRegistryError(f"unsupported decision_type {decision_type}")
    if normalized_result not in VALID_DECISION_RESULTS:
        raise GovernanceRegistryError(f"unsupported decision_result {decision_result}")
    now = _normalize_timestamp(generated_at or datetime.now(UTC).isoformat())
    return {
        "artifact_family": "governance_decision",
        "schema_version": GOVERNANCE_DECISION_SCHEMA_VERSION,
        "experiment_key": _normalize_key(experiment_key),
        "decision_type": normalized_type,
        "decision_result": normalized_result,
        "decided_at": now,
        "gate_results": deepcopy(dict(gate_results or {})),
        "reasons": [str(reason).strip() for reason in reasons if str(reason).strip()],
        "effective_from": _normalize_optional_timestamp(effective_from),
        "effective_until": _normalize_optional_timestamp(effective_until),
        "lineage": deepcopy(dict(lineage or {})),
    }


def load_promotion_gates(path: str | Path | None = None) -> dict[str, Any]:
    return _load_config(path or DEFAULT_PROMOTION_GATES_PATH)


def load_demotion_rules(path: str | Path | None = None) -> dict[str, Any]:
    return _load_config(path or DEFAULT_DEMOTION_RULES_PATH)


def _load_config(path: str | Path) -> dict[str, Any]:
    target = Path(path).expanduser()
    payload = json.loads(target.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise GovernanceRegistryError(f"config {target} must be a JSON object")
    return payload


def _write_json(path: Path, payload: Mapping[str, Any]) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(dict(payload), indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def _normalize_key(value: object) -> str:
    text = str(value or "").strip().lower().replace(" ", "_")
    if not text:
        raise GovernanceRegistryError("registry entry requires experiment_key")
    return text


def _normalize_optional_key(value: object) -> str | None:
    text = str(value or "").strip().lower().replace(" ", "_")
    return text or None


def _normalize_timestamp(value: object) -> str:
    text = str(value or "").strip()
    if not text:
        raise GovernanceRegistryError("timestamp is required")
    parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC).isoformat()


def _normalize_optional_timestamp(value: object) -> str | None:
    if value in {None, ""}:
        return None
    return _normalize_timestamp(value)
