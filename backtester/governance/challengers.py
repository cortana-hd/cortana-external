"""Challenger lifecycle transitions and operator-facing governance summaries."""

from __future__ import annotations

import json
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Mapping, Sequence

from governance.registry import (
    DEFAULT_GOVERNANCE_ROOT,
    load_experiment_registry_from_payload,
    transition_registry_entry,
)

DEFAULT_GOVERNANCE_REPORT_PATH = DEFAULT_GOVERNANCE_ROOT.parent / "reports" / "governance-status-latest.json"
DEFAULT_GOVERNANCE_DECISIONS_PATH = DEFAULT_GOVERNANCE_ROOT / "governance_decisions.json"


def apply_governance_decision(
    *,
    registry_payload: Mapping[str, Any],
    decision_artifact: Mapping[str, Any],
    compare_only: bool = True,
    decided_at: str | None = None,
) -> dict[str, Any]:
    registry = load_experiment_registry_from_payload(registry_payload)
    experiments = [dict(item) for item in registry.get("experiments") or []]
    by_key = {str(item.get("experiment_key") or ""): item for item in experiments}
    experiment_key = str(decision_artifact.get("experiment_key") or "").strip().lower()
    entry = by_key.get(experiment_key)
    if entry is None:
        raise ValueError(f"unknown experiment_key: {experiment_key}")

    decision_type = str(decision_artifact.get("decision_type") or "").strip().lower()
    decision_result = str(decision_artifact.get("decision_result") or "").strip().lower()
    if decision_result not in {"pass", "advisory"}:
        return registry

    now = _normalize_timestamp(decided_at or decision_artifact.get("decided_at") or datetime.now(UTC).isoformat())
    artifact_family = str(entry.get("artifact_family") or "")
    if decision_type == "promotion":
        if compare_only:
            updated = transition_registry_entry(
                entry,
                to_status="challenger",
                reason="promotion decision passed in compare-only mode",
                decided_at=now,
                incumbent_key=_find_incumbent_key(experiments, artifact_family=artifact_family),
                activation={"mode": "compare_only", "enforced": False, "eligible_for_live_authority": False},
            )
            by_key[experiment_key] = updated
        else:
            prior_incumbent_key = _find_incumbent_key(experiments, artifact_family=artifact_family)
            if prior_incumbent_key and prior_incumbent_key != experiment_key:
                incumbent_entry = by_key[prior_incumbent_key]
                by_key[prior_incumbent_key] = transition_registry_entry(
                    incumbent_entry,
                    to_status="challenger",
                    reason=f"replaced by challenger {experiment_key}",
                    decided_at=now,
                    incumbent_key=experiment_key,
                    activation={"mode": "compare_only", "enforced": False, "eligible_for_live_authority": False},
                )
            candidate_entry = entry
            if str(candidate_entry.get("status") or "") == "shadow":
                candidate_entry = transition_registry_entry(
                    candidate_entry,
                    to_status="challenger",
                    reason="candidate advanced to challenger before incumbency",
                    decided_at=now,
                    incumbent_key=prior_incumbent_key,
                    activation={"mode": "compare_only", "enforced": False, "eligible_for_live_authority": False},
                )
            by_key[experiment_key] = transition_registry_entry(
                candidate_entry,
                to_status="incumbent",
                reason="promotion decision passed",
                decided_at=now,
                incumbent_key=None,
                activation={"mode": "enforced", "enforced": True, "eligible_for_live_authority": True},
            )
    elif decision_type == "demotion":
        to_status = "blocked" if _decision_has_block_reason(decision_artifact) else "challenger"
        by_key[experiment_key] = transition_registry_entry(
            entry,
            to_status=to_status,
            reason="demotion decision passed",
            decided_at=now,
            incumbent_key=None,
            activation={"mode": "compare_only", "enforced": False, "eligible_for_live_authority": False},
        )
    elif decision_type == "retirement":
        by_key[experiment_key] = transition_registry_entry(
            entry,
            to_status="retired",
            reason="retirement decision passed",
            decided_at=now,
            incumbent_key=None,
            activation={"mode": "disabled", "enforced": False, "eligible_for_live_authority": False},
        )
    elif decision_type == "block":
        by_key[experiment_key] = transition_registry_entry(
            entry,
            to_status="blocked",
            reason="governance block applied",
            decided_at=now,
            incumbent_key=None,
            activation={"mode": "disabled", "enforced": False, "eligible_for_live_authority": False},
        )
    registry["experiments"] = sorted(by_key.values(), key=lambda item: str(item.get("experiment_key") or ""))
    registry["generated_at"] = now
    return registry


def append_governance_decision(
    *,
    decision_artifact: Mapping[str, Any],
    path: str | Path | None = None,
) -> Path:
    target = Path(path or DEFAULT_GOVERNANCE_DECISIONS_PATH).expanduser()
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = {"schema_version": 1, "decisions": []}
    if target.exists():
        loaded = json.loads(target.read_text(encoding="utf-8"))
        if isinstance(loaded, dict):
            payload = {"schema_version": 1, "decisions": list(loaded.get("decisions") or [])}
    payload["decisions"].append(deepcopy(dict(decision_artifact)))
    target.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return target


def load_governance_decisions(path: str | Path | None = None) -> list[dict[str, Any]]:
    target = Path(path or DEFAULT_GOVERNANCE_DECISIONS_PATH).expanduser()
    if not target.exists():
        return []
    payload = json.loads(target.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        return []
    return [dict(item) for item in payload.get("decisions") or [] if isinstance(item, Mapping)]


def build_governance_status_artifact(
    *,
    registry_payload: Mapping[str, Any],
    decisions: Sequence[Mapping[str, Any]] | None = None,
    compare_only: bool = True,
    generated_at: str | None = None,
) -> dict[str, Any]:
    registry = load_experiment_registry_from_payload(registry_payload)
    experiments = [dict(item) for item in registry.get("experiments") or []]
    decision_rows = [dict(item) for item in (decisions or []) if isinstance(item, Mapping)]
    counts = _status_counts(experiments)
    recent_changes = [
        {
            "experiment_key": str(item.get("experiment_key") or ""),
            "decision_type": str(item.get("decision_type") or ""),
            "decision_result": str(item.get("decision_result") or ""),
            "decided_at": item.get("decided_at"),
            "reasons": list(item.get("reasons") or []),
        }
        for item in sorted(decision_rows, key=lambda row: str(row.get("decided_at") or ""), reverse=True)[:10]
    ]
    active_incumbents = [
        _active_row(entry)
        for entry in experiments
        if str(entry.get("status") or "") == "incumbent" and bool((entry.get("activation") or {}).get("eligible_for_live_authority", True))
    ]
    active_challengers = [
        _active_row(entry)
        for entry in experiments
        if str(entry.get("status") or "") == "challenger"
    ]
    artifact = {
        "artifact_family": "governance_status_summary",
        "schema_version": 1,
        "generated_at": _normalize_timestamp(generated_at or datetime.now(UTC).isoformat()),
        "compare_only_mode": bool(compare_only),
        "status_counts": counts,
        "active_incumbents": active_incumbents,
        "active_challengers": active_challengers,
        "recent_authority_changes": recent_changes,
        "activation_hooks": {
            "mode": "compare_only" if compare_only else "enforced",
            "enforced": not compare_only,
            "eligible_incumbent_count": len(active_incumbents),
        },
        "trust_tier_summary": _build_trust_tier_summary(experiments),
    }
    return artifact


def save_governance_status_artifact(
    artifact: Mapping[str, Any],
    *,
    path: str | Path | None = None,
) -> Path:
    target = Path(path or DEFAULT_GOVERNANCE_REPORT_PATH).expanduser()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(dict(artifact), indent=2) + "\n", encoding="utf-8")
    return target


def build_governance_operator_lines(artifact: Mapping[str, Any]) -> list[str]:
    lines = ["Governance status"]
    hooks = dict(artifact.get("activation_hooks") or {})
    mode = str(hooks.get("mode") or "compare_only")
    enforced = bool(hooks.get("enforced", False))
    lines.append(
        f"Mode: {mode} | enforced {'yes' if enforced else 'no'} | eligible incumbents {int(hooks.get('eligible_incumbent_count', 0) or 0)}"
    )
    counts = dict(artifact.get("status_counts") or {})
    if counts:
        parts = [f"{key} {int(value or 0)}" for key, value in sorted(counts.items())]
        lines.append("Trust tiers: " + " | ".join(parts))
    incumbents = list(artifact.get("active_incumbents") or [])
    if incumbents:
        preview = ", ".join(str(item.get("experiment_key") or "") for item in incumbents[:5])
        lines.append("Incumbents: " + preview)
    challengers = list(artifact.get("active_challengers") or [])
    if challengers:
        preview = ", ".join(str(item.get("experiment_key") or "") for item in challengers[:5])
        lines.append("Challengers: " + preview)
    recent = list(artifact.get("recent_authority_changes") or [])
    if recent:
        latest = recent[0]
        lines.append(
            f"Latest change: {latest.get('experiment_key')} {latest.get('decision_type')} {latest.get('decision_result')}"
        )
    return lines


def _find_incumbent_key(experiments: Sequence[Mapping[str, Any]], *, artifact_family: str) -> str | None:
    for entry in experiments:
        if str(entry.get("artifact_family") or "") != artifact_family:
            continue
        if str(entry.get("status") or "") == "incumbent":
            return str(entry.get("experiment_key") or "")
    return None


def _decision_has_block_reason(decision_artifact: Mapping[str, Any]) -> bool:
    triggers = list((decision_artifact.get("gate_results") or {}).get("demotion_triggers") or [])
    return "governance_block_pass" in triggers or any("block" in str(reason).lower() for reason in decision_artifact.get("reasons") or [])


def _status_counts(experiments: Sequence[Mapping[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for entry in experiments:
        status = str(entry.get("status") or "unknown")
        counts[status] = counts.get(status, 0) + 1
    return counts


def _build_trust_tier_summary(experiments: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    rows = []
    for entry in experiments:
        status = str(entry.get("status") or "")
        rows.append(
            {
                "experiment_key": str(entry.get("experiment_key") or ""),
                "artifact_family": str(entry.get("artifact_family") or ""),
                "status": status,
                "trust_tier": _status_to_trust_tier(status, entry.get("activation") or {}),
                "owner": str(entry.get("owner") or ""),
            }
        )
    return sorted(rows, key=lambda item: (item["artifact_family"], item["experiment_key"]))


def _status_to_trust_tier(status: str, activation: Mapping[str, Any]) -> str:
    if status == "incumbent" and bool(activation.get("enforced", False)):
        return "production"
    if status in {"challenger", "shadow"}:
        return "compare_only"
    if status == "blocked":
        return "blocked"
    if status == "retired":
        return "retired"
    return "draft"


def _active_row(entry: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "experiment_key": str(entry.get("experiment_key") or ""),
        "artifact_family": str(entry.get("artifact_family") or ""),
        "status": str(entry.get("status") or ""),
        "owner": str(entry.get("owner") or ""),
        "activation": deepcopy(dict(entry.get("activation") or {})),
        "updated_at": entry.get("updated_at"),
    }


def _normalize_timestamp(value: object) -> str:
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC).isoformat()
