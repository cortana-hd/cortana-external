# Product Requirements Document (PRD) - Trade Lifecycle, Execution, Risk, And Portfolio

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Primary Owner | TBD |
| Epic | BT-W3 Trade Lifecycle, Execution, Risk, And Portfolio |

---

## Problem / Opportunity

The system can already generate signals and increasingly richer prediction artifacts, but it still stops too early in the decision chain. A signal that says `BUY`, `WATCH`, or `NO_BUY` is not yet a complete trading decision. The operator still needs to answer follow-on questions manually:
- where exactly should I buy
- when is it too extended to chase
- where does the thesis break
- how large should the position be
- what if the order never fills
- what if I already own correlated names
- what should I do after entry if the setup improves or degrades

The opportunity is to promote the current paper-trade foundation into a true lifecycle system with explicit entry plans, execution policy, paper-position ledgers, exit logic, and portfolio-aware reasoning. This is the workstream that makes the system execution-ready while still remaining paper-first and safe.

Without this workstream:
- `BUY` remains too vague to be actionable
- confidence cannot be translated honestly into risk or size
- trade evaluation will keep mixing signal quality with unrealistic fill assumptions
- portfolio context remains absent even though real decisions depend on existing exposure

---

## Insights

- Classification is not execution. The system needs a first-class layer between signal generation and any trade-like action.
- A lifecycle system must separate the following concerns cleanly:
  - signal quality
  - entry plan
  - execution policy
  - ongoing hold / trim / sell policy
  - portfolio and capital context
- This workstream should remain paper-first. The goal is to create execution-ready, replayable, and measurable logic without granting broker authority prematurely.

Problems this workstream is not intending to solve:
- live broker order placement
- fully autonomous capital deployment
- benchmark governance and promotion rules
- asynchronous research ingestion itself

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

This Development Overview must stay in sync with the matching Tech Spec.

---

## Success Metrics

- Every actionable `BUY` emitted by the lifecycle-enabled strategies includes a strategy-specific entry plan and execution policy.
- The system maintains first-class open-position and closed-position ledgers for paper positions.
- The system can explain the difference between:
  - a valid signal that never filled
  - a filled position that later failed
  - a signal that should have been avoided because of portfolio constraints
- Operator surfaces can answer:
  - where to buy
  - where not to chase
  - where the setup breaks
  - whether to hold, trim, or exit
  - whether size should be starter, half, full, or suppressed
- Paper-trade summaries include realized return, hold duration, exit reason, and basic portfolio-state impact.
- Concurrent-position simulation and capital competition exist, even if the first version is conservative.

---

## Assumptions

- W1 machine contracts and W2 prediction measurement are available or advancing in parallel.
- This workstream remains paper-first and does not require direct broker execution.
- Strategy-specific entry logic is required; a single generic entry-plan template is not sufficient.
- Portfolio awareness may start with paper positions only; real broker portfolio sync is optional and later.
- Risk and sizing should remain transparent and bounded, even when mathematically richer than the current system.

---

## Out of Scope

- live order routing to Schwab, Alpaca, or other brokers
- margin logic, options, or short-selling workflows
- full tax-lot accounting
- fully adaptive risk sizing driven by experimental governance logic
- non-equity asset lifecycle support

---

## High Level Requirements

| Requirement | Description | Notes |
|-------------|-------------|-------|
| Trade object model | The system must promote explicit lifecycle contracts for entry plans, open positions, closed positions, exits, and reviews. | Loose ad hoc dictionaries are not enough for lifecycle-critical logic. |
| Strategy-specific entry and execution plans | CANSLIM and Dip Buyer must emit different plan structures and rules while sharing a common schema. | Strategy semantics must not be blurred. |
| Exit and lifecycle state machine | The system must support paper-position transitions such as open, hold, trim, exit, invalidated, expired, and forced close. | Includes explicit exit reasons and replay rules. |
| Risk and sizing layer | Position sizing and execution realism must be explicit, interpretable, and suppressible under degraded conditions. | Confidence and risk stay separate. |
| Portfolio-aware decision support | The system must simulate available capital, concentration, same-name re-entry rules, and correlated exposure. | Portfolio state should influence decisions, not just post-trade review. |

---

## Detailed User Stories

### Glossary

| Term | Meaning |
|------|---------|
| Entry plan | Strategy-specific plan that describes where to enter, where not to chase, where the setup breaks, and expected targets/hold window. |
| Execution policy | The rules that govern how a valid signal may be filled, expired, or blocked in practice. |
| Open position | A paper position currently active in the ledger with explicit stop, targets, and state. |
| Exit decision | A machine-readable explanation for trim / sell / close behavior. |
| Portfolio competition | The logic that decides which trades can coexist given capital and exposure limits. |

---

### Trade Object Model

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As a lifecycle engine, I want explicit `EntryPlan`, `OpenPosition`, `ClosedPosition`, `ExitDecision`, and `PositionReview` objects so that paper trading and replay do not depend on loose dictionaries. | Required for reliable serialization and testing. |
| Draft | As an operator, I want open and closed positions to have durable state and explicit reasons so that I can inspect why the system is holding, trimming, or exiting. | Needed for trust and review. |

---

### Strategy-Specific Entry And Execution Plans

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As an operator, I want CANSLIM and Dip Buyer to show different entry plans so that the plan reflects the underlying strategy rather than a generic trading template. | Breakout vs rebound logic must not be flattened. |
| Draft | As a paper-trade engine, I want execution policy fields such as entry zone, do-not-chase, order type, validity window, and gap handling so that fill assumptions are honest and replayable. | Must distinguish signal quality from execution quality. |

---

### Exit And Lifecycle State Machine

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As a lifecycle system, I want explicit transitions for open, hold, trim, exit, expired, invalidated, and forced close so that position behavior is testable and deterministic. | Includes exit-reason taxonomy. |
| Draft | As an operator, I want the system to explain whether a position is being exited because of stop hit, target hit, thesis invalidation, regime deterioration, or downgrade so that later reviews are meaningful. | Makes exit behavior auditable. |

---

### Risk And Sizing Layer

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As an operator, I want size recommendations such as starter, half, full, or no-size so that strong signals do not imply identical capital exposure. | Confidence and risk remain separate. |
| Draft | As a risk engine, I want slippage, liquidity, delay, and degraded-data suppression built into lifecycle evaluation so that a beautiful signal on paper does not become a fake edge in replay. | Backtest realism is mandatory. |

---

### Portfolio-Aware Decision Support

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As an operator, I want to know whether a new setup should be blocked or downsized because of concentration, correlation, or existing open positions so that the system behaves like a portfolio assistant rather than a pile of isolated symbol opinions. | Paper portfolio first. |
| Draft | As a later governance layer, I want concurrent-position simulation and capital competition recorded explicitly so that single-trade edge does not get mistaken for portfolio-ready edge. | Required for honest promotion later. |

---

## Appendix

### Additional Considerations

- This workstream should remain conservative when data quality is degraded-risky or failed. Lifecycle authority must not increase when market context is weaker.
- A `WATCH` may emit a preview plan, but it must never read like an executable `BUY` plan.
- Same-name re-entry and post-stop behavior should be explicit from the beginning to avoid ambiguous paper ledgers.

### User Research

Operator needs surfaced repeatedly in earlier sessions:
- “BUY what, and where?”
- “Was the system wrong, or did the fill assumptions make it look wrong?”
- “Why is this a starter and not a full-size idea?”
- “Why is the system telling me to add when I already have related exposure?”

### Open Questions

- Which horizons should be canonical for expected hold windows by strategy?
- Should trim logic be enabled in the first lifecycle release or remain review-only until enough paper history exists?
- How should same-bar stop/target ambiguity be handled in the first realism model?
- How much portfolio state should be visible in compact alerts vs only in detailed artifacts?

### Collaboration Topics

- W2 measurement artifacts must carry enough lifecycle references for future grading.
- W4/W5 adaptive and governance work will depend on the explicit lifecycle outputs created here.
- If `cortana` surfaces consume lifecycle-aware outputs directly later, cross-repo contract changes may be required.

### Technical Considerations

- Keep lifecycle objects versioned and serializable.
- Prefer explicit state transitions over implicit inference from text summaries.
- Treat execution realism as part of product truthfulness, not just quantitative polish.
