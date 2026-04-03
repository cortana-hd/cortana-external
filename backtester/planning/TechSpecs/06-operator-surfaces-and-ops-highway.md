# Technical Specification - Unified Operator Surfaces And Ops Highway

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Owner(s) | TBD |
| Epic | BT-W6 Unified Operator Surfaces And Ops Highway |

---

## Development Overview

This workstream unifies the machine-readable decision contract consumed by:
- market brief
- strategy alerts
- daytime flow
- nighttime flow
- trading cron
- future lifecycle and governance summaries

It also formalizes the future Ops Highway for the Mac mini deployment, covering runtime inventory, supervision, health, retention, backup and restore, incident runbooks, capacity thresholds, and change management.

The result should be a system where:
- every operator surface tells the same story using the same machine truth
- each surface differs only in level of detail, not in underlying state
- the operator can inspect runtime health, storage growth, and incident status without guessing
- future operational hardening has a defined execution lane rather than being left to ad hoc fixes

This Development Overview must stay in sync with the matching PRD.

---

## Data Storage Changes

### Database Changes

#### [NEW] public.operator_payloads_v1

| Constraints | Column Name | Column Type | Notes |
|-------------|-------------|-------------|-------|
| PK | id | uuid | |
| Not Null | payload_key | text | Stable key per rendered/operator-consumable payload. |
| Not Null | schema_version | text | |
| Not Null | producer | text | `market_brief_snapshot`, `daytime_flow`, `trading_cron`, etc. |
| Not Null | generated_at | timestamptz | |
| Nullable | decision_contract_ref | text | Canonical machine-truth source. |
| Nullable | surface_type | text | `brief`, `daytime`, `nighttime`, `trading_cron`, `lifecycle_review`. |
| Nullable | summary_payload | jsonb | Surface-specific rendered content. |
| Nullable | health_status | text | Mirrors source truth. |
| Nullable | degraded_reason | jsonb | Mirrors source truth. |

#### [NEW] public.runtime_inventory_v1

| Constraints | Column Name | Column Type | Notes |
|-------------|-------------|-------------|-------|
| PK | id | uuid | |
| Not Null | component_key | text | |
| Not Null | schema_version | text | |
| Not Null | component_type | text | Service, script, launchd job, database, artifact family, etc. |
| Not Null | ownership | text | |
| Nullable | must_be_running | boolean | |
| Nullable | health_probe | jsonb | |
| Nullable | restart_policy | jsonb | |
| Nullable | notes | jsonb | |

#### [NEW] public.runtime_health_snapshots_v1

| Constraints | Column Name | Column Type | Notes |
|-------------|-------------|-------------|-------|
| PK | id | uuid | |
| Not Null | generated_at | timestamptz | |
| Not Null | schema_version | text | |
| Nullable | pre_open_gate_status | text | |
| Nullable | service_health | jsonb | |
| Nullable | cron_health | jsonb | |
| Nullable | watchdog_health | jsonb | |
| Nullable | delivery_health | jsonb | |
| Nullable | notes | jsonb | |

#### [NEW] public.retention_backup_metadata_v1

| Constraints | Column Name | Column Type | Notes |
|-------------|-------------|-------------|-------|
| PK | id | uuid | |
| Not Null | schema_version | text | |
| Not Null | artifact_family | text | |
| Nullable | retention_days | integer | |
| Nullable | prune_policy | text | |
| Nullable | backup_policy | text | |
| Nullable | archive_eligibility | text | Local only vs future object storage. |
| Nullable | restore_priority | text | |

#### [NEW] public.incident_markers_v1

| Constraints | Column Name | Column Type | Notes |
|-------------|-------------|-------------|-------|
| PK | id | uuid | |
| Not Null | occurred_at | timestamptz | |
| Not Null | schema_version | text | |
| Not Null | incident_type | text | |
| Nullable | severity | text | |
| Nullable | related_artifact_refs | jsonb | |
| Nullable | runbook_ref | text | |
| Nullable | resolution_summary | jsonb | |

---

## Infrastructure Changes (if any?)

### SNS Topic Changes

No AWS SNS changes are required.

### SQS Queue Changes

No AWS SQS changes are required.

### Cache Changes

- Surface renderers may cache rendered summaries, but cache entries must never become the source of truth.
- Runtime-health snapshots should preserve collection timestamps and not be reused past their declared freshness windows.

### S3 Changes

No immediate S3 integration is required. This workstream should document the object-storage archive boundary and leave actual activation to later Ops Highway execution.

### Secrets Changes

- No new secret type is required for the initial documentation and contract work.
- Backup/runbook documentation must identify which auth and token material require special handling without embedding secret values in artifacts.

### Network/Security Changes

- No new network architecture is required for the Mac mini target.
- If future object storage or remote backup is added, it must remain outside hot-path runtime dependencies.

---

## Behavior Changes

- All operator surfaces will render from one shared decision contract and shared health semantics.
- Compact surfaces such as `cbreadth` or trading cron alerts will remain concise, but they will no longer imply different underlying truths than detailed surfaces.
- Operators will gain a clearer operational picture of:
  - what services and jobs matter
  - when the system is ready before market open
  - what recurring incidents exist
  - when storage, runtime, or backups need attention

---

## Application/Script Changes

Primary modules expected to change:

- `backtester/market_brief_snapshot.py`
  - read and render canonical operator decision contract
- `backtester/scripts/local_output_formatter.py`
  - align with shared rendering rules
- `backtester/scripts/daytime_flow.sh`
  - use shared payload and health semantics
- `backtester/scripts/nighttime_flow.sh`
  - same
- `backtester/README.md`
  - may need updated operator references once surfaces converge
- `watchdog/watchdog.sh`
  - runtime-health alignment and incident/runbook linkage
- `watchdog/README.md`
  - runtime-health and runbook integration

Potential new modules or docs:

- `backtester/operator/decision_contract.py`
  - shared operator payload contract
- `backtester/operator/renderers.py`
  - surface-specific read-only formatters
- `backtester/planning/ops/` or future operational docs/scripts
  - runtime inventory
  - retention table
  - backup checklist
  - incident runbooks

Potential cross-repo integration points:

- `cortana` trading cron and market-brief consumers
- any OpenClaw agent or Telegram formatter that consumes these payloads

---

## API Changes

### [NEW] Internal operator decision payload contract

| Field | Value |
|-------|-------|
| **API** | File and/or structured DB artifact contract |
| **Description** | Shared payload that operator surfaces use to render posture, candidates, lifecycle summaries, health state, and degraded status. |
| **Additional Notes** | Renderers are surface-specific, but the payload is canonical. |

| Field | Detail |
|-------|--------|
| **Authentication** | Internal only |
| **URL Params** | N/A |
| **Request** | N/A |
| **Success Response** | Surface-ready machine payload with references to canonical decision state and run manifest. |
| **Error Responses** | Schema mismatch, missing source artifact, or render contract validation failure. |

### [NEW] Internal runtime-health snapshot contract

| Field | Value |
|-------|-------|
| **API** | File and/or structured DB artifact contract |
| **Description** | Shared snapshot of Mac-mini runtime readiness, health, and operational status. |
| **Additional Notes** | Supports future Ops Highway execution. |

| Field | Detail |
|-------|--------|
| **Authentication** | Internal only |
| **URL Params** | N/A |
| **Request** | N/A |
| **Success Response** | Health payload with pre-open gate, component status, and freshness. |
| **Error Responses** | Snapshot-generation failure or missing critical component evidence. |

---

## Process Changes

- Surface changes must update the shared operator contract first, then the renderer.
- `cortana` and `cortana-external` should explicitly version cross-repo surface contracts to prevent silent drift.
- Ops Highway documentation should be kept in planning state until W1-W3 maturity is strong enough to activate implementation.
- Post-merge verification should include:
  - surface-consistency smoke tests
  - readiness snapshot checks
  - alert truthfulness checks

---

## Orchestration Changes

- Surface renderers must be read-only consumers of canonical decision and lifecycle artifacts.
- Pre-open gate and runtime-health snapshots should become shared inputs for watchdog, operator tools, and later incident automation.
- Retention, backup, and incident markers should use the same runtime inventory model instead of separate ad hoc scripts.

---

## Test Plan

Unit tests:
- shared operator payload validation
- renderer consistency tests
- runtime inventory contract validation
- runtime-health snapshot freshness checks

Integration tests:
- same run rendered through multiple surfaces remains semantically consistent
- `healthy_no_candidates`, `market_gate_blocked`, `degraded_safe`, `failed` render differently but truthfully
- runtime inventory and health snapshots reflect current service ownership and readiness inputs

Replay / regression tests:
- cross-repo schema mismatch detection
- stale health snapshot handling
- retention metadata and incident markers remain machine-readable across versions
- no-surface contradiction tests using historical run fixtures

Manual validation:
- inspect one market brief, one daytime flow, and one trading cron payload for the same run
- inspect one runtime-health snapshot and incident marker bundle
- confirm operator wording remains concise while preserving machine truth
