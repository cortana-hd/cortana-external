# Implementation Plan - Trade Lifecycle, Execution, Risk, And Portfolio

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Owner(s) | TBD |
| Epic | BT-W3 Trade Lifecycle, Execution, Risk, And Portfolio |
| Tech Spec | [03-trade-lifecycle-execution-risk-and-portfolio.md](/Users/hd/Developer/cortana-external/backtester/planning/TechSpecs/03-trade-lifecycle-execution-risk-and-portfolio.md) |
| PRD | [03-trade-lifecycle-execution-risk-and-portfolio.md](/Users/hd/Developer/cortana-external/backtester/planning/PRDs/03-trade-lifecycle-execution-risk-and-portfolio.md) |

---

## Dependency Map

| Vertical | Dependencies | Can Start? |
|----------|-------------|------------|
| V1 — Trade object model and ledgers | W1 contracts + W2 prediction references | Start Now |
| V2 — Strategy-specific entry plans | V1 | Start after V1 |
| V3 — Execution policy and fill realism | V1, V2 | Start after V1, V2 |
| V4 — Exit engine and position reviews | V1, V3 | Start after V1, V3 |
| V5 — Risk and size tier engine | V2, V3 | Start after V2, V3 |
| V6 — Paper portfolio state and competition logic | V1, V4, V5 | Start after V1, V4, V5 |
| V7 — Operator surfaces and replay fixtures | V2, V4, V5, V6 | Start after V2, V4, V5, V6 |

---

## Recommended Execution Order

```text
Week 1: V1
Week 2: V2
Week 3: V3
Week 4: V4 + V5
Week 5: V6
Week 6: V7 + regression cleanup
```

---

## Sprint 1 — Core Lifecycle Objects

### Vertical 1 — Trade Object Model And Ledgers

**backtester: establish lifecycle domain objects and durable paper ledgers**

*Dependencies: W1 contracts + W2 prediction references*

#### Jira

- Sub-task 1: Create shared lifecycle objects under a new `backtester/lifecycle/` package for `EntryPlan`, `OpenPosition`, `ClosedPosition`, `ExitDecision`, and `PositionReview`.
- Sub-task 2: Define serialization and lineage rules so positions can be traced from prediction -> entry plan -> open position -> close -> review.
- Sub-task 3: Add durable ledger writers/readers for open and closed paper positions.

#### Testing

- Lifecycle objects serialize and deserialize deterministically.
- Open and closed ledgers preserve lineage and schema version.
- Invalid state transitions fail immediately.

---

### Vertical 2 — Strategy-Specific Entry Plans

**backtester: generate actionable CANSLIM and Dip Buyer entry plans**

*Dependencies: V1*

#### Jira

- Sub-task 1: Add a shared entry-plan builder with strategy-specific branches for CANSLIM breakout logic vs Dip Buyer rebound logic.
- Sub-task 2: Update `backtester/canslim_alert.py` and `backtester/dipbuyer_alert.py` to emit full entry-plan artifacts and preview-plan behavior for `WATCH`.
- Sub-task 3: Add degraded-risky suppression so plans are not emitted when inputs are too weak.

#### Testing

- CANSLIM and Dip Buyer entry plans differ in the expected ways.
- `WATCH` preview plans are clearly marked and do not open positions.
- Degraded-risky inputs suppress executable plans.

---

## Sprint 2 — Execution And Exit Truth

### Vertical 3 — Execution Policy And Fill Realism

**backtester: separate signal quality from fill realism and execution rules**

*Dependencies: V1, V2*

#### Jira

- Sub-task 1: Create an execution-policy module that tracks entry order type, gap handling, validity window, partial fills, cancel-if-not-filled, and execution timing assumption.
- Sub-task 2: Integrate `backtester/data/liquidity_model.py` and related risk helpers into a reusable slippage / liquidity penalty layer.
- Sub-task 3: Wire execution-policy references into entry plans and future settlement artifacts.

#### Important Planning Notes

- Same-bar and next-bar assumptions must be explicit, not hidden defaults.
- If a signal is valid but the execution policy blocks the fill, the system must preserve that distinction.

#### Testing

- Gap-above-zone behavior is deterministic.
- Partial-fill and cancellation rules are replayable.
- Liquidity penalties can suppress non-viable trades.

---

### Vertical 4 — Exit Engine And Position Reviews

**backtester: make hold / trim / exit decisions explicit and replayable**

*Dependencies: V1, V3*

#### Jira

- Sub-task 1: Implement exit taxonomy evaluation for stop hit, target hit, max hold, thesis invalidation, regime deterioration, signal downgrade, and manual override.
- Sub-task 2: Create a position-review artifact that explains why a position closed and how it behaved in between.
- Sub-task 3: Update daytime/nighttime flows to summarize lifecycle state and recent exits.

#### Testing

- Exit reasons map cleanly to lifecycle events.
- Position reviews preserve hold duration, runup, and drawdown context.
- Manual override requires explicit reason and audit fields if supported.

---

## Sprint 3 — Risk, Size, And Portfolio Competition

### Vertical 5 — Risk And Size Tier Engine

**backtester: turn confidence, regime, and liquidity into bounded size recommendations**

*Dependencies: V2, V3*

#### Jira

- Sub-task 1: Extend `backtester/data/risk_budget.py` to support explicit size tiers and hard suppression rules.
- Sub-task 2: Blend confidence, expected drawdown, liquidity penalties, and regime state into transparent size recommendations.
- Sub-task 3: Ensure high-confidence/high-risk and low-confidence/low-risk cases remain distinguishable in artifacts and operator wording.

#### Testing

- Size tiers remain bounded and interpretable.
- Degraded inputs can suppress size even when setup quality appears strong.
- High-confidence/high-risk setups do not silently receive full size.

---

### Vertical 6 — Paper Portfolio State And Competition Logic

**backtester: simulate available capital, concentration, and duplicate-entry controls**

*Dependencies: V1, V4, V5*

#### Jira

- Sub-task 1: Add a paper portfolio module that tracks available capital, open positions, pending entries, same-name re-entry rules, concentration caps, and correlation caps.
- Sub-task 2: Implement capital competition so concurrent candidates are evaluated against each other, not only in isolation.
- Sub-task 3: Add portfolio-state snapshots and summary outputs for later operator surfaces and governance review.

#### Important Planning Notes

- Start with conservative caps and simple correlation buckets rather than false precision.
- Duplicate entries from repeated runs must be blocked deterministically.

#### Testing

- Concentration and correlation caps suppress or reduce new entries.
- Re-entry logic behaves predictably after stop-outs and recent exits.
- Pending entries count against capital and prevent over-allocation.

---

## Sprint 4 — Surface Integration And Replay Safety

### Vertical 7 — Operator Surfaces And Replay Fixtures

**backtester: expose lifecycle, size, and portfolio state without breaking current surfaces**

*Dependencies: V2, V4, V5, V6*

#### Jira

- Sub-task 1: Update operator formatters and `advisor.py` summaries so lifecycle-aware information is visible but still compact.
- Sub-task 2: Add replay fixtures covering same-bar ambiguity, delayed entries, gap-through-stop behavior, duplicate entries, and concentration conflicts.
- Sub-task 3: Keep machine-readable lifecycle artifacts authoritative and ensure human summaries never invent lifecycle state.

#### Testing

- Compact surfaces stay readable while showing plan, size, and portfolio context.
- Replay fixtures catch state-machine regressions.
- Human-readable summaries remain aligned with machine lifecycle artifacts.

---

## Dependency Notes

### V1 before V2/V3/V4/V6

Lifecycle, execution, exit, and portfolio logic all depend on a stable trade-object model and durable ledgers.

### V2 before V3/V5/V7

Execution policy, sizing, and operator surfaces need entry-plan semantics first.

### V3 before V4/V5

Exit evaluation and size realism both depend on explicit execution assumptions.

### V6 before V7

Operator surfaces should not imply portfolio-aware behavior until the paper portfolio state exists.

---

## Scope Boundaries

### In Scope (This Plan)

- trade object model
- entry plans
- execution policy
- paper ledgers
- exit engine
- size tiers
- paper portfolio state
- capital competition

### External Dependencies

- W2 prediction artifacts must already carry stable ids and context
- later governance workstream will consume lifecycle outputs for promotion and demotion logic

### Integration Points

- `backtester/advisor.py`
- strategy alert producers
- `backtester/data/risk_budget.py`
- `backtester/data/liquidity_model.py`
- daytime and nighttime flow scripts

---

## Realistic Delivery Notes

- **Biggest risks:** under-specifying state transitions; producing plans that look precise but are not supported by data quality; mixing signal error with execution-policy error.
- **Assumptions:** first implementation remains paper-first; position sizing stays advisory before later governance and evidence gates harden it; strategy-specific entry plans can be introduced additively without breaking existing alerts.

## Update On Every Commit

Each implementation PR under this workstream should update this plan with:
- shipped verticals or sub-verticals
- changed artifact contracts or schema versions
- new replay fixtures or sample artifacts added
- blocked dependencies or sequencing changes
- rollout/deviation notes if the implementation diverges from the original plan
