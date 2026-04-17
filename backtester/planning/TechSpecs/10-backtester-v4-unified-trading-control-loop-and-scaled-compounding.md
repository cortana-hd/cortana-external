# Technical Specification - Backtester V4 Unified Trading Control Loop And Scaled Compounding

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Owner(s) | @hameldesai |
| Epic | BT-V4 Unified Trading Control Loop And Scaled Compounding |

---

## Development Overview

Backtester V4 unifies the product into one governed trading control loop. The implementation should define:
- canonical desired-state and actual-state artifacts for posture, authority, risk, runtime, and release state
- reconciliation logic that compares those states and takes bounded, idempotent actions to close the gap
- a governed release loop for strategy, model, and policy changes with canaries, shadow evaluation, staged rollout, and rollback
- Mission Control as the operator control tower for posture, drift, rollout, authority, and intervention

The goal is not more automation for its own sake. The goal is scalable compounding through capital allocation, risk discipline, observability, and release safety.

This Development Overview must stay in sync with the matching PRD.

---

## Data Storage Changes

### Database Changes

#### [NEW] public.trading_desired_state_snapshots_v1

| Constraints | Column Name | Column Type | Notes |
|-------------|-------------|-------------|-------|
| PK | id | uuid | |
| Not Null | schema_version | text | |
| Not Null | generated_at | timestamptz | |
| Not Null | posture_target | jsonb | Target posture, budgets, and exposure intent. |
| Not Null | authority_target | jsonb | Target strategy tiers and autonomy mode. |
| Not Null | release_target | jsonb | Active release unit and canary intent. |
| Nullable | policy_constraints | jsonb | Kill switches, pause rules, caps. |
| Nullable | operator_intent | jsonb | Human-approved overrides or holds. |

#### [NEW] public.trading_actual_state_snapshots_v1

| Constraints | Column Name | Column Type | Notes |
|-------------|-------------|-------------|-------|
| PK | id | uuid | |
| Not Null | schema_version | text | |
| Not Null | generated_at | timestamptz | |
| Nullable | known_at | timestamptz | |
| Nullable | posture_actual | jsonb | Current exposures and allocations. |
| Nullable | authority_actual | jsonb | Current effective tiers and modes. |
| Nullable | runtime_actual | jsonb | Runtime health, freshness, and source ownership. |
| Nullable | drift_actual | jsonb | Strategy, data, and release drift summaries. |
| Nullable | release_actual | jsonb | Current deployed code/config/model state. |

#### [NEW] public.trading_reconciliation_actions_v1

| Constraints | Column Name | Column Type | Notes |
|-------------|-------------|-------------|-------|
| PK | id | uuid | |
| Not Null | generated_at | timestamptz | |
| Not Null | action_type | text | `reduce_authority`, `pause_strategy`, `hold_rollout`, `resume`, `operator_ack`, etc. |
| Not Null | source_loop | text | `portfolio`, `governance`, `operations`, `release`. |
| Not Null | action_status | text | `proposed`, `applied`, `blocked`, `rolled_back`. |
| Nullable | desired_state_ref | uuid | |
| Nullable | actual_state_ref | uuid | |
| Nullable | rationale | jsonb | |
| Nullable | operator_ack | jsonb | |

#### [NEW] public.trading_release_units_v1

| Constraints | Column Name | Column Type | Notes |
|-------------|-------------|-------------|-------|
| PK | id | uuid | |
| Not Null | release_key | text | Stable release-unit identifier. |
| Not Null | created_at | timestamptz | |
| Not Null | code_ref | text | Git SHA or tagged revision. |
| Nullable | strategy_refs | jsonb | Strategy or model changes included in the unit. |
| Nullable | config_refs | jsonb | |
| Nullable | canary_state | jsonb | |
| Nullable | rollback_state | jsonb | |
| Nullable | health_summary | jsonb | |

#### [NEW] public.trading_intervention_events_v1

| Constraints | Column Name | Column Type | Notes |
|-------------|-------------|-------------|-------|
| PK | id | uuid | |
| Not Null | created_at | timestamptz | |
| Not Null | event_type | text | `kill_switch`, `manual_pause`, `override`, `resume`, `rollout_hold`. |
| Nullable | actor | text | `operator`, `policy_engine`, `watchdog`. |
| Nullable | scope | jsonb | Strategy, portfolio, release, or runtime scope. |
| Nullable | reason | jsonb | |
| Nullable | cleared_at | timestamptz | |

---

## Infrastructure Changes (if any?)

### SNS Topic Changes

No AWS SNS changes are required.

### SQS Queue Changes

No AWS SQS changes are required.

### Cache Changes

- Mission Control control-tower views should cache desired and actual state separately to preserve provenance.
- Cached state must always carry source timestamps and fallback status.

### S3 Changes

No immediate S3 changes are required, though long-horizon release bundles or replay archives may later justify object storage.

### Secrets Changes

- No new secret classes are required for the first V4 implementation.
- Release units must declare any secret dependencies explicitly so rollback paths remain complete.

### Network/Security Changes

- Intervention and stronger-authority actions must remain internal and authenticated.
- Any future rollout controller or control-tower actions must keep human approval points explicit for stronger modes.

---

## Behavior Changes

- The product gains explicit desired-state and actual-state views instead of forcing the operator to infer intent from scattered outputs.
- Reconciliation actions become first-class, visible events rather than hidden operational behavior.
- Strategy/model/policy changes are released as full units with canary, shadow, and rollback semantics.
- Mission Control becomes the operator control tower for posture, release state, drift, and interventions.
- Kill switches, authority reducers, and rollout holds are proactive controls rather than after-the-fact notes.

---

## Application/Script Changes

Primary modules expected to change:

- `backtester/operator_surfaces/mission_control.py`
  - desired/actual state summaries and control-loop exports
- `backtester/runtime_health_snapshot.py`
  - actual-state runtime ownership and freshness
- `backtester/runtime_inventory_snapshot.py`
  - runtime inventory as actual-state input
- `backtester/governance/gates.py`
  - release and authority policy hooks
- `backtester/governance/registry.py`
  - release-unit lineage and trust roll-forward/rollback references
- `backtester/lifecycle/paper_portfolio.py`
  - posture actual-state and exposure truth
- `apps/mission-control/lib/trading-run-state.ts`
  - load current posture, authority, and release state
- `apps/mission-control/lib/trading-ops.ts`
  - control-tower data assembly
- `apps/mission-control/lib/trading-ops-contract.ts`
  - desired/actual/reconciliation contract loading
- `apps/mission-control/components/trading-ops-dashboard.tsx`
  - control-tower panels for drift, release, and interventions
- `apps/mission-control/scripts/check-trading-ops-smoke.ts`
  - include control-loop and rollout assertions

Likely new modules:

- `backtester/control_loop/desired_state.py`
  - desired-state synthesis
- `backtester/control_loop/actual_state.py`
  - actual-state synthesis
- `backtester/control_loop/reconciler.py`
  - diffing and proposed actions
- `backtester/control_loop/interventions.py`
  - kill switches, holds, and human override helpers
- `backtester/release/release_units.py`
  - package code/config/model release units
- `backtester/release/drift_monitor.py`
  - rollout and live drift checks

---

## API Changes

### [NEW] Internal desired-state contract

| Field | Value |
|-------|-------|
| **API** | File and/or structured DB artifact contract |
| **Description** | Canonical target posture, authority, budget, and release intent for the trading system. |
| **Additional Notes** | Desired state is not inferred from current holdings. |

| Field | Detail |
|-------|--------|
| **Authentication** | Internal only |
| **URL Params** | N/A |
| **Request** | N/A |
| **Success Response** | Versioned desired-state payload with posture, authority, release target, and policy constraints. |
| **Error Responses** | Invalid policy, missing posture target, or failed synthesis. |

### [NEW] Internal reconciliation-action contract

| Field | Value |
|-------|-------|
| **API** | File and/or structured DB artifact contract |
| **Description** | Proposed or applied control-loop action linking desired state, actual state, rationale, and operator acknowledgment. |
| **Additional Notes** | This is the core audit trail for V4 operations. |

| Field | Detail |
|-------|--------|
| **Authentication** | Internal only |
| **URL Params** | N/A |
| **Request** | N/A |
| **Success Response** | Versioned action payload with source loop, action type, status, and rationale. |
| **Error Responses** | Illegal action, missing refs, or policy block. |

### [NEW] Internal release-unit contract

| Field | Value |
|-------|-------|
| **API** | File and/or structured DB artifact contract |
| **Description** | Full release bundle for strategy/model/policy changes with canary and rollback metadata. |
| **Additional Notes** | Release discipline is part of the trading edge in V4. |

| Field | Detail |
|-------|--------|
| **Authentication** | Internal only |
| **URL Params** | N/A |
| **Request** | N/A |
| **Success Response** | Versioned release-unit payload with code/config refs, canary state, and rollback readiness. |
| **Error Responses** | Incomplete bundle, invalid canary state, or rollback prerequisite failure. |

---

## Process Changes

- Every material strategy/model/policy change should move through packaging, canarying, monitoring, and rollback review as one release unit.
- Control-loop reviews should explicitly compare desired state and actual state, not just inspect current outputs.
- Operator interventions should be captured as first-class events with clear scope and resolution.
- Drift, rollout regressions, and runtime degradation should reduce authority or hold rollout before they produce sustained trading damage.

---

## Orchestration Changes

- Add scheduled jobs that synthesize desired state and actual state on a fixed cadence.
- Add a reconciliation step that produces proposed actions and applies only policy-allowed changes automatically.
- Add canary/shadow evaluation hooks for release units before broader adoption.
- Keep reconciliation actions idempotent so repeated cycles converge instead of duplicating side effects.

---

## Test Plan

- Unit tests for desired-state synthesis, actual-state synthesis, and reconciliation diffs.
- Unit tests for policy blocks, kill switches, and invalid escalation paths.
- Integration tests for release-unit packaging, canary states, and rollback readiness.
- Integration tests for Mission Control control-tower panels consuming desired, actual, and reconciliation state.
- Drift-monitoring tests that force authority reduction or rollout hold under degraded conditions.
- Replay drills showing that repeated reconciliation cycles are idempotent and auditable.
