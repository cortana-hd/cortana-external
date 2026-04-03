# Technical Specification - Prediction Loop, Measurement, And Decision Math

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Owner(s) | TBD |
| Epic | BT-W2 Prediction Loop, Measurement, And Decision Math |

---

## Development Overview

This workstream expands the prediction and settlement artifact family so every important decision can be traced through the full loop: predict, log, execute or paper-execute, settle, validate, and recalibrate. The implementation will enrich prediction snapshots, enrich settled artifacts with excursion and pending-coverage data, and produce rolling reports that split performance by strategy, action, regime, confidence bucket, and veto path.

The workstream will also formalize the core decision-math layer used for expected value, calibrated confidence, reward-to-risk, and opportunity-cost reporting. The result should be a system where future adaptive logic can ask defensible questions such as:
- which confidence buckets are actually trustworthy
- which strategies outperform under which regimes
- which vetoes help versus overblock
- which missed trades cost the system the most opportunity

This Development Overview must stay in sync with the matching PRD.

---

## Data Storage Changes

### Database Changes

The preferred storage shape is additive. Prediction and settlement artifacts may continue to exist as files for replay, but the structured fields below should also be supported in Postgres or any central structured store used by reports.

#### [NEW] public.prediction_snapshots_v2

| Constraints | Column Name | Column Type | Notes |
|-------------|-------------|-------------|-------|
| PK | id | uuid | Stable prediction id. |
| Unique | prediction_key | text | Stable dedupe key for one prediction event. |
| Not Null | schema_version | text | Prediction artifact schema version. |
| Not Null | producer | text | Strategy or workflow producer name. |
| Not Null | symbol | text | |
| Not Null | strategy | text | `canslim`, `dip_buyer`, future strategies. |
| Not Null | action | text | `BUY`, `WATCH`, `NO_BUY`, later lifecycle actions if mirrored here. |
| Not Null | confidence | numeric | Raw or calibrated display confidence at prediction time. |
| Not Null | risk | text | Risk tier or categorical risk level. |
| Not Null | predicted_at | timestamptz | Decision timestamp. |
| Not Null | regime_label | text | Point-in-time regime label. |
| Nullable | breadth_state | text | Intraday breadth / tape state if applicable. |
| Nullable | narrative_context | jsonb | Narrative support/conflict fields. |
| Nullable | entry_plan_ref | text | Reference to entry-plan artifact or embedded contract id. |
| Nullable | execution_policy_ref | text | Reference to execution policy contract. |
| Nullable | vetoes | jsonb | Triggered veto or downgrade list. |
| Nullable | reason_summary | text | Short structured reason string. |
| Nullable | known_at | timestamptz | Point-in-time truth anchor for later causality checks. |

#### [NEW] public.settled_predictions_v2

| Constraints | Column Name | Column Type | Notes |
|-------------|-------------|-------------|-------|
| PK | id | uuid | |
| Unique | prediction_key | text | Joins to `prediction_snapshots_v2`. |
| Not Null | schema_version | text | |
| Not Null | settled_at | timestamptz | Settlement timestamp. |
| Not Null | settlement_status | text | `settled`, `pending`, `expired`, `insufficient_data`. |
| Nullable | forward_return_1d | numeric | Optional horizon field set. |
| Nullable | forward_return_3d | numeric | |
| Nullable | forward_return_5d | numeric | |
| Nullable | forward_return_10d | numeric | |
| Nullable | max_favorable_excursion_pct | numeric | |
| Nullable | max_adverse_excursion_pct | numeric | |
| Nullable | entry_validation_grade | text | `good`, `mixed`, `poor`, `unknown`. |
| Nullable | signal_validation_grade | text | |
| Nullable | execution_validation_grade | text | |
| Nullable | trade_validation_grade | text | |
| Nullable | opportunity_cost_score | numeric | |
| Nullable | benchmark_comparison | jsonb | Comparison against null models. |
| Nullable | notes | jsonb | Any supporting structured details. |

#### [NEW] public.measurement_rollups_v1

| Constraints | Column Name | Column Type | Notes |
|-------------|-------------|-------------|-------|
| PK | id | uuid | |
| Not Null | rollup_type | text | `accuracy`, `calibration`, `veto`, `opportunity_cost`, `benchmark`. |
| Not Null | window_label | text | `latest`, `20`, `50`, `100`, weekly, monthly. |
| Not Null | generated_at | timestamptz | |
| Not Null | schema_version | text | |
| Nullable | grouping_keys | jsonb | Strategy/action/regime/confidence grouping context. |
| Not Null | payload | jsonb | Full structured rollup artifact. |

#### [UPDATE] Existing prediction accuracy artifacts

| Constraints | Column Name | Column Type | Notes |
|-------------|-------------|-------------|-------|
| Add | schema_version | text | Required for machine consumers. |
| Add | confidence_bucket | text | Explicitly persisted instead of inferred late. |
| Add | regime_bucket | text | |
| Add | veto_path | jsonb | |
| Add | pending_coverage_pct | numeric | Distinguish immature from mature samples. |

---

## Infrastructure Changes (if any?)

### SNS Topic Changes

No AWS SNS changes are required for the local-first system.

### SQS Queue Changes

No AWS SQS changes are required for the local-first system.

### Cache Changes

- Add stable cache keys or file naming for rolling report windows so repeated report runs are deterministic.
- Preserve point-in-time metadata when cached research or market context is embedded into prediction snapshots.

### S3 Changes

No immediate S3 changes are required. Long-term archive remains a later Ops Highway concern.

### Secrets Changes

No new secrets are required for this workstream.

### Network/Security Changes

No external network or IAM changes are required. The main risk surface is data truthfulness, not network policy.

---

## Behavior Changes

- Prediction artifacts will become richer and more explicit, even when the operator-facing output remains compact.
- Accuracy reports will stop relying mainly on aggregate hit-rate style summaries and instead surface richer context such as regime buckets, confidence buckets, veto paths, and missed-opportunity information.
- The system will be able to distinguish:
  - good signal / poor execution
  - poor signal / good execution conditions
  - high-confidence call / low realized quality
  - overconservative veto / useful veto
- Confidence displays will have a principled path toward calibration rather than remaining raw scores.

---

## Application/Script Changes

Primary modules expected to change:

- `backtester/evaluation/prediction_accuracy.py`
  - extend settlement logic
  - add richer rollups
  - emit benchmark-aware fields
- `backtester/prediction_accuracy_report.py`
  - render the richer measurement outputs
  - support rolling windows and grouped summaries
- `backtester/evaluation/decision_review.py`
  - add opportunity-cost and veto-effectiveness logic
- `backtester/data/confidence.py`
  - add calibration helpers and bucket logic
- `backtester/buy_decision_calibration.py`
  - adapt to the richer prediction contract and calibration outputs
- `backtester/outcomes.py`
  - support richer settlement states and excursion computation
- `backtester/metrics.py`
  - add reusable metric helpers where appropriate
- `backtester/advisor.py`, `backtester/canslim_alert.py`, `backtester/dipbuyer_alert.py`
  - ensure emitted prediction snapshots include the full contract fields

New helper modules likely required:

- `backtester/evaluation/prediction_contract.py`
  - central typed prediction contract and serializers
- `backtester/evaluation/settlement_metrics.py`
  - excursion, horizon-return, and validation helpers
- `backtester/evaluation/benchmark_models.py`
  - simple comparison baselines
- `backtester/evaluation/opportunity_cost.py`
  - missed-winner and overblock logic

---

## API Changes

### [NEW] Internal prediction snapshot contract

| Field | Value |
|-------|-------|
| **API** | File and/or structured DB artifact contract |
| **Description** | Versioned prediction artifact used by reports, lifecycle logic, and future governance. |
| **Additional Notes** | Internal contract first; HTTP exposure is optional and not required for this phase. |

| Field | Detail |
|-------|--------|
| **Authentication** | Internal only |
| **URL Params** | N/A |
| **Request** | N/A |
| **Success Response** | Structured prediction payload containing contract fields defined above. |
| **Error Responses** | Validation failure or artifact write failure. |

### [NEW] Internal settled prediction contract

| Field | Value |
|-------|-------|
| **API** | File and/or structured DB artifact contract |
| **Description** | Versioned settlement artifact for prediction grading and calibration. |
| **Additional Notes** | Must preserve horizon coverage and pending state explicitly. |

| Field | Detail |
|-------|--------|
| **Authentication** | Internal only |
| **URL Params** | N/A |
| **Request** | N/A |
| **Success Response** | Structured settlement payload with excursion and grading fields. |
| **Error Responses** | Validation failure, insufficient data, or settlement computation failure. |

---

## Process Changes

- Weekly review should consume rolling measurement artifacts instead of relying on ad hoc reading of raw run folders.
- New strategies and overlays should not be considered for promotion unless they emit the fields required by this workstream.
- Measurement artifacts should be regenerated deterministically from replayable inputs wherever possible.
- Calibration should remain informational until enough sample depth exists for each bucket.

---

## Orchestration Changes

- Nightly or scheduled settlement/reporting paths should write measurement artifacts on a predictable cadence.
- Daytime flows and trading flows should write the richer prediction contract at decision time, even if settlement is delayed.
- Future governance jobs should consume this workstream’s outputs rather than re-derive the same metrics independently.

---

## Test Plan

Unit tests:
- prediction contract validation
- settlement metric calculation
- confidence-bucket assignment
- regime-bucket assignment
- opportunity-cost scoring
- veto-effectiveness aggregation
- benchmark comparison helpers

Integration tests:
- predictions from current strategy paths carry required fields
- settled predictions preserve pending vs mature coverage
- rolling reports split correctly by strategy/action/regime/confidence
- calibration artifacts remain machine-readable and backward-compatible

Replay / regression tests:
- replay historical prediction artifacts into the new report path
- compare old and new summaries for consistency where they overlap
- confirm no leakage from future-only settlement data into prediction-time fields

Manual validation:
- inspect latest artifacts for one CANSLIM run and one Dip Buyer run
- inspect one window where confidence remains stale and confirm the reports explain why
- inspect one missed-winner scenario and confirm opportunity-cost reporting is intelligible
