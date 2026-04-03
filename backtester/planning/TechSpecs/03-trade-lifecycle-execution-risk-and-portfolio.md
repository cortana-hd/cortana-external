# Technical Specification - Trade Lifecycle, Execution, Risk, And Portfolio

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Owner(s) | TBD |
| Epic | BT-W3 Trade Lifecycle, Execution, Risk, And Portfolio |

---

## Development Overview

This workstream promotes the backtester from a signal engine into a lifecycle-aware decision engine. It introduces first-class trade-domain objects such as `EntryPlan`, `OpenPosition`, `ClosedPosition`, `ExitDecision`, and `PositionReview`; strategy-specific execution plans for CANSLIM and Dip Buyer; explicit exit-taxonomy and lifecycle-state transitions; realistic fill assumptions; and a paper portfolio layer that can reason about available capital, concentration, and correlated exposure.

The implementation should make it possible for the system to say:
- buy inside this range
- do not chase above this level
- this setup expires after this window
- start with a smaller size because confidence, liquidity, regime, or existing exposure do not justify full risk
- hold, trim, or exit for these explicit reasons
- do not add because the paper portfolio is already concentrated or the symbol is already open

This Development Overview must stay in sync with the matching PRD.

---

## Data Storage Changes

### Database Changes

Lifecycle and portfolio logic need durable structured state. File artifacts may still exist for replay, but the fields below should be representable in a central structured store.

#### [NEW] public.entry_plans_v1

| Constraints | Column Name | Column Type | Notes |
|-------------|-------------|-------------|-------|
| PK | id | uuid | Stable entry-plan id. |
| Unique | plan_key | text | Deterministic key per strategy/symbol/timestamp. |
| Not Null | schema_version | text | |
| Not Null | symbol | text | |
| Not Null | strategy | text | |
| Not Null | created_at | timestamptz | |
| Not Null | action_context | text | `BUY`, `WATCH_PREVIEW`, future variants. |
| Not Null | entry_style | text | Strategy-specific classification. |
| Nullable | entry_price_ideal_min | numeric | |
| Nullable | entry_price_ideal_max | numeric | |
| Nullable | do_not_chase_above | numeric | |
| Nullable | initial_stop_price | numeric | |
| Nullable | first_target_price | numeric | |
| Nullable | stretch_target_price | numeric | |
| Nullable | expected_hold_days_min | integer | |
| Nullable | expected_hold_days_max | integer | |
| Nullable | entry_reason | text | |
| Nullable | entry_risk_summary | text | |
| Nullable | execution_policy_ref | text | |
| Nullable | data_quality_state | text | |

#### [NEW] public.execution_policy_snapshots_v1

| Constraints | Column Name | Column Type | Notes |
|-------------|-------------|-------------|-------|
| PK | id | uuid | |
| Unique | policy_key | text | |
| Not Null | schema_version | text | |
| Not Null | symbol | text | |
| Not Null | strategy | text | |
| Not Null | entry_order_type | text | Market, limit, simulated limit, etc. |
| Nullable | entry_valid_until | timestamptz | |
| Nullable | gap_above_zone_policy | text | |
| Nullable | partial_fill_policy | text | |
| Nullable | cancel_if_not_filled | boolean | |
| Nullable | execution_timing_assumption | text | Same-bar, next-bar, delayed, etc. |
| Nullable | slippage_model_ref | text | |
| Nullable | stop_fill_policy | text | |
| Nullable | target_fill_policy | text | |

#### [NEW] public.paper_open_positions_v1

| Constraints | Column Name | Column Type | Notes |
|-------------|-------------|-------------|-------|
| PK | id | uuid | |
| Unique | position_key | text | |
| Not Null | schema_version | text | |
| Not Null | symbol | text | |
| Not Null | strategy | text | |
| Not Null | entered_at | timestamptz | |
| Not Null | entry_price | numeric | |
| Nullable | size_tier | text | |
| Nullable | capital_allocated | numeric | |
| Nullable | entry_plan_ref | text | |
| Nullable | execution_policy_ref | text | |
| Nullable | stop_price | numeric | |
| Nullable | target_price_1 | numeric | |
| Nullable | target_price_2 | numeric | |
| Nullable | current_state | text | `open`, `hold`, `trim_candidate`, `exit_candidate`, etc. |
| Nullable | max_drawdown_pct | numeric | |
| Nullable | max_runup_pct | numeric | |
| Nullable | unrealized_return_pct | numeric | |
| Nullable | portfolio_snapshot_ref | text | |

#### [NEW] public.paper_closed_positions_v1

| Constraints | Column Name | Column Type | Notes |
|-------------|-------------|-------------|-------|
| PK | id | uuid | |
| Unique | position_key | text | Same key as the open record lineage. |
| Not Null | schema_version | text | |
| Not Null | symbol | text | |
| Not Null | strategy | text | |
| Not Null | entered_at | timestamptz | |
| Not Null | exited_at | timestamptz | |
| Not Null | entry_price | numeric | |
| Not Null | exit_price | numeric | |
| Nullable | exit_reason | text | Explicit taxonomy member. |
| Nullable | realized_return_pct | numeric | |
| Nullable | hold_days | numeric | |
| Nullable | position_review_ref | text | |

#### [NEW] public.portfolio_state_snapshots_v1

| Constraints | Column Name | Column Type | Notes |
|-------------|-------------|-------------|-------|
| PK | id | uuid | |
| Not Null | snapshot_at | timestamptz | |
| Not Null | schema_version | text | |
| Nullable | available_capital | numeric | |
| Nullable | gross_exposure_pct | numeric | |
| Nullable | net_exposure_pct | numeric | |
| Nullable | concentration_summary | jsonb | |
| Nullable | correlation_summary | jsonb | |
| Nullable | pending_entry_summary | jsonb | |
| Nullable | open_position_keys | jsonb | |

---

## Infrastructure Changes (if any?)

### SNS Topic Changes

No AWS SNS changes are required.

### SQS Queue Changes

No AWS SQS changes are required.

### Cache Changes

- Lifecycle evaluation may reuse cached market context, but every plan and position artifact must preserve the original health/degraded state used at creation time.
- If entry-plan generation uses cached data, the plan must carry that provenance explicitly.

### S3 Changes

No immediate S3 changes are required. Closed-position history may become an archive candidate later under the Ops Highway.

### Secrets Changes

No new secrets are required for the paper-first implementation.

### Network/Security Changes

No external network changes are required in the first implementation. If later broker-aware features are added, they should remain out of scope for this workstream.

---

## Behavior Changes

- A valid `BUY` can now produce an execution-ready entry plan instead of just a label.
- `WATCH` can optionally produce a clearly labeled preview plan, but it cannot masquerade as executable buy authority.
- The system will maintain durable paper positions with explicit hold, trim, and exit reasoning.
- Risk output will become more nuanced:
  - starter
  - half-size
  - full-size
  - no-size
- Portfolio conditions such as concentration, duplicate entries, existing exposure, or capital competition can block or suppress otherwise valid signals.

---

## Application/Script Changes

Primary modules expected to change:

- `backtester/advisor.py`
  - integrate lifecycle-aware outputs and portfolio-aware summaries
- `backtester/canslim_alert.py`
  - emit strategy-specific entry-plan data and watch-preview behavior
- `backtester/dipbuyer_alert.py`
  - same for Dip Buyer semantics
- `backtester/data/risk_budget.py`
  - expand toward explicit size-tier and regime-aware risk policy
- `backtester/data/liquidity_model.py`
  - feed slippage and liquidity penalties into execution realism
- `backtester/data/liquidity_overlay.py`
  - help suppress non-viable entries
- `backtester/market_brief_snapshot.py`
  - surface lifecycle or open-position context where appropriate
- `backtester/scripts/daytime_flow.sh`
  - include lifecycle and portfolio summaries
- `backtester/scripts/nighttime_flow.sh`
  - include lifecycle review and closed-position outputs

New modules likely required:

- `backtester/lifecycle/trade_objects.py`
  - shared domain objects for `EntryPlan`, `OpenPosition`, `ClosedPosition`, `ExitDecision`, `PositionReview`
- `backtester/lifecycle/entry_plan.py`
  - plan generation and validation
- `backtester/lifecycle/execution_policy.py`
  - fill assumptions and execution state transitions
- `backtester/lifecycle/paper_portfolio.py`
  - paper portfolio state and exposure summaries
- `backtester/lifecycle/exit_engine.py`
  - exit-taxonomy evaluation and state transitions
- `backtester/lifecycle/position_review.py`
  - post-close summaries for later measurement work

---

## API Changes

### [NEW] Internal entry-plan contract

| Field | Value |
|-------|-------|
| **API** | File and/or structured DB artifact contract |
| **Description** | Strategy-specific plan describing where to enter, where not to chase, where the setup invalidates, and how long it remains actionable. |
| **Additional Notes** | Internal artifact first; may later feed operator surfaces in `cortana`. |

| Field | Detail |
|-------|--------|
| **Authentication** | Internal only |
| **URL Params** | N/A |
| **Request** | N/A |
| **Success Response** | Entry-plan payload with strategy-specific fields plus shared schema metadata. |
| **Error Responses** | Validation failure, degraded-risky suppression, artifact write failure. |

### [NEW] Internal open/closed-position contracts

| Field | Value |
|-------|-------|
| **API** | File and/or structured DB artifact contract |
| **Description** | Durable paper-position state used by lifecycle summaries, reviews, and later portfolio logic. |
| **Additional Notes** | Must support replay and lineage from entry plan through close. |

| Field | Detail |
|-------|--------|
| **Authentication** | Internal only |
| **URL Params** | N/A |
| **Request** | N/A |
| **Success Response** | Position payload with state, stop, targets, exposure references, and review linkage. |
| **Error Responses** | Serialization failure, invalid state transition, missing portfolio context. |

---

## Process Changes

- Daytime and nightly flows must update paper ledgers deterministically.
- Lifecycle transitions should be replayable from artifacts rather than only from in-memory state.
- Exit review should occur on a repeatable cadence so later measurement and governance layers consume the same lifecycle truth.
- Strategy changes that affect entry plans or execution policies must update both artifact contracts and replay fixtures.

---

## Orchestration Changes

- Lifecycle objects should be produced before operator formatting so human-readable outputs remain derived from machine truth.
- Position state refresh should happen before portfolio-aware recommendations are rendered.
- Future `cortana` consumption of lifecycle fields must remain additive and versioned.

---

## Test Plan

Unit tests:
- entry-plan generation per strategy
- execution-policy contract validation
- state-transition validation
- risk-size mapping
- portfolio concentration and duplicate-entry rules
- stop / target / max-hold exit taxonomy mapping

Integration tests:
- `BUY` -> open position transition
- `WATCH` -> preview-plan without open position
- valid signal blocked by execution policy
- valid signal blocked by portfolio constraints
- open position -> hold / trim / exit transitions

Replay / realism tests:
- same-bar stop and target ambiguity
- gap above chase threshold
- delayed-entry scenarios
- partial fills and cancellations
- regime deterioration while open
- re-entry soon after stop-out

Manual validation:
- inspect one CANSLIM and one Dip Buyer entry plan
- inspect one closed paper position with a clean exit reason
- inspect a case where the portfolio already owns exposure and the new signal is suppressed
