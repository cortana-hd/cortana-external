# Technical Specification - Backtester V3 Adaptive Portfolio Intelligence And Governed Autonomy

**Document Status:** Complete

## Team

| Role | Assignee |
|------|----------|
| Owner(s) | @hameldesai |
| Epic | BT-V3 Adaptive Portfolio Intelligence And Governed Autonomy |

---

## Development Overview

Backtester V3 promotes V2 signal quality into a governed portfolio-intelligence layer. The first release should:
- allocate in two stages, with strategy-family budgets first and position ranking second
- enforce a canonical risk-budget stack led by drawdown budget, then gross exposure, position limits, and concentration caps
- connect trust tiers directly to strategy authority and autonomy modes
- keep all stronger-autonomy movement gated by benchmarked evidence, clean supervised-live observation, and explicit operator approval

The goal is to improve compounding through disciplined capital competition without letting the system become opaque or quietly over-authorized.

This Development Overview must stay in sync with the matching PRD.

---

## Data Storage Changes

### Database Changes

#### [NEW] public.strategy_authority_tiers_v1

| Constraints | Column Name | Column Type | Notes |
|-------------|-------------|-------------|-------|
| PK | id | uuid | |
| Not Null | strategy_family | text | |
| Not Null | schema_version | text | |
| Not Null | generated_at | timestamptz | |
| Not Null | authority_tier | text | `exploratory`, `limited_trust`, `trusted`, `demoted`. |
| Nullable | autonomy_mode | text | `advisory`, `paper`, `supervised_live`, future stronger tier. |
| Nullable | sample_depth | integer | |
| Nullable | benchmark_summary | jsonb | |
| Nullable | drawdown_summary | jsonb | |
| Nullable | regime_coverage | jsonb | |
| Nullable | decision_reason | jsonb | Promotion/demotion rationale. |

#### [NEW] public.strategy_budget_allocations_v1

| Constraints | Column Name | Column Type | Notes |
|-------------|-------------|-------------|-------|
| PK | id | uuid | |
| Not Null | generated_at | timestamptz | |
| Not Null | strategy_family | text | |
| Not Null | budget_type | text | `capital`, `gross_exposure`, `risk`, `candidate_slots`. |
| Not Null | budget_amount | numeric | |
| Nullable | authority_tier | text | |
| Nullable | portfolio_drawdown_budget | numeric | Top-level guardrail reference. |
| Nullable | concentration_caps | jsonb | |
| Nullable | warnings | jsonb | |

#### [NEW] public.portfolio_posture_snapshots_v1

| Constraints | Column Name | Column Type | Notes |
|-------------|-------------|-------------|-------|
| PK | id | uuid | |
| Not Null | schema_version | text | |
| Not Null | generated_at | timestamptz | |
| Nullable | known_at | timestamptz | |
| Not Null | posture_state | text | `risk_on`, `selective`, `defensive`, `paused`. |
| Nullable | gross_exposure | numeric | |
| Nullable | net_exposure | numeric | |
| Nullable | drawdown_state | jsonb | |
| Nullable | strategy_allocations | jsonb | |
| Nullable | overlap_summary | jsonb | |
| Nullable | warnings | jsonb | |

#### [NEW] public.supervised_live_review_windows_v1

| Constraints | Column Name | Column Type | Notes |
|-------------|-------------|-------------|-------|
| PK | id | uuid | |
| Not Null | strategy_family | text | |
| Not Null | started_at | timestamptz | |
| Nullable | ended_at | timestamptz | |
| Not Null | observed_mode | text | Usually `supervised_live`. |
| Nullable | policy_breaches | jsonb | |
| Nullable | unresolved_incidents | jsonb | |
| Nullable | operator_signoff | jsonb | |
| Nullable | outcome_summary | jsonb | |

---

## Infrastructure Changes (if any?)

### SNS Topic Changes

No AWS SNS changes are required.

### SQS Queue Changes

No AWS SQS changes are required.

### Cache Changes

- Portfolio posture and authority summaries should be cached for operator reads with explicit freshness timestamps.
- Cached posture must never hide a drawdown-triggered pause or authority reduction.

### S3 Changes

No S3 changes are required for the first V3 implementation.

### Secrets Changes

No new secret classes are required.

### Network/Security Changes

- Stronger autonomy tiers must remain gated behind explicit policy configuration, not implicit feature drift.
- No new external network integrations should be added as part of first-release V3.

---

## Behavior Changes

- The system moves from single-signal judgment to strategy-family capital competition.
- Strategy authority tiers directly affect whether a strategy can recommend only, paper trade, or participate in supervised-live flows.
- Budgeting happens in two stages:
  - budget and authority assignment by strategy family
  - candidate ranking and position proposal inside that budget
- Portfolio posture becomes a first-class output with explicit risk, concentration, and drawdown semantics.
- Stronger autonomy remains opt-in and evidence-gated, not a default escalation path.

---

## Application/Script Changes

Primary modules expected to change:

- `backtester/lifecycle/paper_portfolio.py`
  - budget-aware paper allocation and posture summaries
- `backtester/lifecycle/execution_policy.py`
  - autonomy-mode aware limits and allowed actions
- `backtester/lifecycle/entry_plan.py`
  - candidate plan shaping under budget constraints
- `backtester/lifecycle/trade_objects.py`
  - carry strategy-family and authority metadata through trade objects
- `backtester/governance/gates.py`
  - tier gating and stronger-autonomy prerequisites
- `backtester/governance/challengers.py`
  - challenger/incumbent state tied to authority tiers
- `backtester/governance/registry.py`
  - strategy-family ownership, trust status, and rollout lineage
- `backtester/advisor.py`
  - portfolio-aware ranking hooks
- `backtester/operator_surfaces/mission_control.py`
  - posture and authority summaries
- `apps/mission-control/lib/trading-run-state.ts`
  - load strategy authority and posture state for UI consumers
- `apps/mission-control/components/trading-ops-dashboard.tsx`
  - portfolio posture, autonomy mode, and authority visibility

Likely new modules:

- `backtester/portfolio/allocator.py`
  - two-stage capital competition logic
- `backtester/portfolio/risk_budget.py`
  - drawdown, exposure, position-size, and concentration budgets
- `backtester/portfolio/posture.py`
  - portfolio posture synthesis
- `backtester/governance/authority.py`
  - trust-tier to authority-mode mapping
- `backtester/governance/autonomy_tiers.py`
  - policy and evidence gates for autonomy transitions

---

## API Changes

### [NEW] Internal strategy-authority contract

| Field | Value |
|-------|-------|
| **API** | File and/or structured DB artifact contract |
| **Description** | Strategy-family trust and authority record used by portfolio logic and operator surfaces. |
| **Additional Notes** | This is the bridge between governance evidence and runtime behavior. |

| Field | Detail |
|-------|--------|
| **Authentication** | Internal only |
| **URL Params** | N/A |
| **Request** | N/A |
| **Success Response** | Authority tier, autonomy mode, benchmark/drawdown/regime evidence, and decision reason. |
| **Error Responses** | Missing evidence, stale review window, or invalid tier transition. |

### [NEW] Internal portfolio-posture contract

| Field | Value |
|-------|-------|
| **API** | File and/or structured DB artifact contract |
| **Description** | Canonical posture output for budgets, exposures, allocations, overlap, and warnings. |
| **Additional Notes** | Consumed by Mission Control and future control-loop work. |

| Field | Detail |
|-------|--------|
| **Authentication** | Internal only |
| **URL Params** | N/A |
| **Request** | N/A |
| **Success Response** | Versioned posture payload with budget usage, posture state, and warnings. |
| **Error Responses** | Allocation failure, posture synthesis failure, or stale upstream authority data. |

---

## Process Changes

- Recompute authority tiers on a scheduled cadence after evaluation artifacts settle.
- Treat supervised-live windows as explicit review artifacts, not implied runtime behavior.
- Require operator signoff artifacts before any transition beyond supervised-live.
- Keep manual overrides, demotions, and pauses as machine-readable events so review and rollback stay possible.

---

## Orchestration Changes

- Add a scheduled authority-tier synthesis step after governance outputs refresh.
- Add a portfolio-posture synthesis step after budgets and candidate rankings refresh.
- Preserve compare-only or paper-first rollout before any stronger autonomy path is activated.

---

## Test Plan

- Unit tests for two-stage allocation, risk-budget enforcement, and overlap control.
- Unit tests for authority-tier transitions and invalid escalation paths.
- Integration tests for posture synthesis using mixed-strategy candidate sets.
- Integration tests for supervised-live review windows and operator approval requirements.
- UI and loader tests for Mission Control posture, authority, and autonomy visibility.
- Replay tests proving that demotions and pauses reduce authority without corrupting historical evidence.
