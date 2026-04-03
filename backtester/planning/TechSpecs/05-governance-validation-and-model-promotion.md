# Technical Specification - Governance, Validation, And Model Promotion

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Owner(s) | TBD |
| Epic | BT-W5 Governance, Validation, And Model Promotion |

---

## Development Overview

This workstream introduces the experiment registry and model-governance layer that controls how new ideas move from “interesting” to “trusted.” It includes walk-forward validation, benchmark and null-model comparisons, robustness sweeps, leakage and point-in-time guardrails, promotion gates, demotion rules, and challenger lifecycle tracking.

The result should be a system that can answer:
- what is the incumbent and what is the challenger
- whether the challenger is truly better out of sample
- whether the result survives modestly worse fill assumptions
- whether the model is causally valid and point-in-time safe
- whether current production logic should be demoted, softened, or retired

This Development Overview must stay in sync with the matching PRD.

---

## Data Storage Changes

### Database Changes

#### [NEW] public.experiment_registry_v1

| Constraints | Column Name | Column Type | Notes |
|-------------|-------------|-------------|-------|
| PK | id | uuid | |
| Unique | experiment_key | text | Stable key for strategy/overlay/rule candidate. |
| Not Null | schema_version | text | |
| Not Null | artifact_family | text | Strategy, overlay, veto, weight model, etc. |
| Not Null | owner | text | |
| Not Null | status | text | `draft`, `shadow`, `challenger`, `incumbent`, `retired`, `blocked`. |
| Nullable | incumbent_key | text | For challenger lineage. |
| Nullable | notes | jsonb | |
| Not Null | created_at | timestamptz | |
| Nullable | updated_at | timestamptz | |

#### [NEW] public.walk_forward_results_v1

| Constraints | Column Name | Column Type | Notes |
|-------------|-------------|-------------|-------|
| PK | id | uuid | |
| Not Null | experiment_key | text | |
| Not Null | schema_version | text | |
| Not Null | generated_at | timestamptz | |
| Not Null | window_definition | jsonb | Train/validation/OOS slices. |
| Nullable | regime_segment_summary | jsonb | |
| Nullable | parameter_stability_summary | jsonb | |
| Nullable | stress_test_summary | jsonb | |
| Nullable | benchmark_summary | jsonb | |
| Nullable | pass_fail_summary | jsonb | |

#### [NEW] public.benchmark_results_v1

| Constraints | Column Name | Column Type | Notes |
|-------------|-------------|-------------|-------|
| PK | id | uuid | |
| Not Null | experiment_key | text | |
| Not Null | schema_version | text | |
| Not Null | generated_at | timestamptz | |
| Not Null | benchmark_name | text | |
| Not Null | comparable_window_key | text | Guarantees same evaluation span. |
| Nullable | result_summary | jsonb | |
| Nullable | assumptions | jsonb | Fill/slippage/fee assumptions. |

#### [NEW] public.governance_decisions_v1

| Constraints | Column Name | Column Type | Notes |
|-------------|-------------|-------------|-------|
| PK | id | uuid | |
| Not Null | experiment_key | text | |
| Not Null | schema_version | text | |
| Not Null | decision_type | text | `promotion`, `demotion`, `retirement`, `block`. |
| Not Null | decided_at | timestamptz | |
| Not Null | decision_result | text | `pass`, `fail`, `advisory`, `pending`. |
| Nullable | gate_results | jsonb | |
| Nullable | reasons | jsonb | Machine-readable pass/fail reasons. |
| Nullable | effective_from | timestamptz | |
| Nullable | effective_until | timestamptz | |

#### [NEW] public.point_in_time_audit_results_v1

| Constraints | Column Name | Column Type | Notes |
|-------------|-------------|-------------|-------|
| PK | id | uuid | |
| Not Null | experiment_key | text | |
| Not Null | schema_version | text | |
| Not Null | generated_at | timestamptz | |
| Nullable | universe_membership_audit | jsonb | |
| Nullable | corporate_actions_audit | jsonb | |
| Nullable | known_at_order_audit | jsonb | |
| Nullable | leakage_findings | jsonb | |
| Nullable | pass_fail_summary | jsonb | |

---

## Infrastructure Changes (if any?)

### SNS Topic Changes

No AWS SNS changes are required.

### SQS Queue Changes

No AWS SQS changes are required.

### Cache Changes

- Governance jobs may cache replay windows or benchmark summaries for speed, but cached outputs must always retain:
  - experiment key
  - schema version
  - comparable window definition
  - assumptions hash
- Cached governance outputs may never be mistaken for live production signals.

### S3 Changes

No immediate S3 changes are required, though governance artifacts are strong candidates for later cold archive due to audit value.

### Secrets Changes

No new secrets are required for the governance engine itself.

### Network/Security Changes

No new external network changes are required. Governance should operate on local replayable artifacts and normalized contracts.

---

## Behavior Changes

- Strategies, overlays, and weighting rules gain explicit registry identities and lifecycle states.
- Promotion and demotion become machine-readable decisions with pass/fail reasons rather than implicit merge choices.
- Walk-forward, leakage, and benchmark outputs become mandatory context for authority changes.
- Governance can begin compare-only, then later graduate to explicit enforcement through registry status and decision artifacts.

---

## Application/Script Changes

Primary modules expected to change or be added:

- `backtester/evaluation/comparison.py`
  - strategy and challenger comparisons
- `backtester/evaluation/prediction_accuracy.py`
  - provide measurement inputs required by governance
- `backtester/buy_decision_calibration.py`
  - calibration quality inputs
- `backtester/lifecycle/*`
  - provide realistic lifecycle outputs for honest governance

New modules likely required:

- `backtester/governance/registry.py`
  - experiment registry helpers and status transitions
- `backtester/governance/benchmarks.py`
  - benchmark and null-model runners
- `backtester/governance/walk_forward.py`
  - rolling-window evaluation engine
- `backtester/governance/leakage.py`
  - causality and source-integrity checks
- `backtester/governance/gates.py`
  - promotion/demotion gate evaluation
- `backtester/governance/challengers.py`
  - incumbent vs challenger lifecycle management

Config or registry files likely required:

- `backtester/governance/benchmark_registry.json`
- `backtester/governance/promotion_gates.json`
- `backtester/governance/demotion_rules.json`

---

## API Changes

### [NEW] Internal experiment registry contract

| Field | Value |
|-------|-------|
| **API** | File and/or structured DB artifact contract |
| **Description** | Versioned identity and lifecycle record for every governed strategy, overlay, weight rule, or veto model. |
| **Additional Notes** | No production logic should exist outside the registry. |

| Field | Detail |
|-------|--------|
| **Authentication** | Internal only |
| **URL Params** | N/A |
| **Request** | N/A |
| **Success Response** | Registry payload with owner, status, lineage, and activation context. |
| **Error Responses** | Duplicate key, invalid lifecycle transition, or missing dependency metadata. |

### [NEW] Internal governance decision contract

| Field | Value |
|-------|-------|
| **API** | File and/or structured DB artifact contract |
| **Description** | Machine-readable promotion/demotion/retirement decision with explicit gate outcomes and reasons. |
| **Additional Notes** | Can be advisory before enforcement. |

| Field | Detail |
|-------|--------|
| **Authentication** | Internal only |
| **URL Params** | N/A |
| **Request** | N/A |
| **Success Response** | Decision payload plus effective dates and machine-readable reasons. |
| **Error Responses** | Missing evaluation artifacts, schema mismatch, or incomplete gate coverage. |

---

## Process Changes

- Every meaningful model or rules change must register before it can seek promotion.
- Promotion review should require:
  - walk-forward evidence
  - benchmark comparison
  - calibration check
  - robustness stress
  - point-in-time and leakage audit
- Demotion and retirement reviews should run on a recurring cadence, not only after obvious failures.
- Manual emergency overrides must be logged with scope, reason, and expiry.

---

## Orchestration Changes

- Governance jobs should run off replayable artifacts and deterministic configs, not off live ad hoc state.
- Compare-only mode should precede enforcement mode.
- Operator surfaces should consume governance decisions as read-only artifacts, not infer promotion state indirectly from code branches.
- Cross-repo consumers such as `cortana` should only need the resulting trust tier or status field, not internal governance logic.

---

## Test Plan

Unit tests:
- registry lifecycle transitions
- gate-evaluation logic
- demotion-rule matching
- minimum-sample enforcement
- weight-overreaction guards
- challenger lifecycle transitions

Integration tests:
- walk-forward run produces all required artifact families
- benchmark ladder uses identical windows and assumptions
- leakage or point-in-time audit blocks promotion
- demoted strategy no longer receives incumbent status in output artifacts

Replay / regression tests:
- one-symbol or one-regime outlier does not sneak through promotion
- degraded-input evaluations cannot be promoted as if they were live-comparable
- schema mismatch between artifacts fails governance deterministically
- stale incumbent logic can be demoted and retired cleanly

Manual validation:
- inspect one challenger vs incumbent comparison end-to-end
- inspect one demotion decision with explicit reasons
- inspect one leakage failure and confirm it blocks promotion
