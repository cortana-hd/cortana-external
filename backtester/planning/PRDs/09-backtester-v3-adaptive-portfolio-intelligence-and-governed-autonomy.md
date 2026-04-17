# Product Requirements Document (PRD) - Backtester V3 Adaptive Portfolio Intelligence And Governed Autonomy

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Primary Owner | @hameldesai |
| Epic | BT-V3 Adaptive Portfolio Intelligence And Governed Autonomy |

---

## Problem / Opportunity

Backtester V2 is intentionally focused on making the signal layer trustworthy. That is the right move, but it is not the end state. A system that can generate better `BUY`, `WATCH`, and `NO_BUY` decisions still leaves major long-term questions unanswered:
- how should multiple strategies compete for attention and capital
- when should the system increase or reduce authority
- how should research, narrative, regime, and execution realism influence portfolio construction
- how can the operator trust a more adaptive system without losing visibility or control

The opportunity for V3 is to move from a better signal engine to a governed portfolio-intelligence system. V3 should sit above V2 and decide not just whether a single setup looks good, but:
- which opportunities deserve capital relative to one another
- how much authority each strategy has earned
- how much autonomy is allowed under the current evidence and policy state
- how the system should keep adapting without becoming a black box

V3 is the layer where the product begins to behave less like a backtest tool and more like a capital-allocation platform with explicit trust, policy, and learning loops.

---

## Insights

- Better predictions are necessary but not sufficient. Money is made by selecting among competing opportunities, sizing them sensibly, and withdrawing authority when evidence weakens.
- Long-term credibility requires governance at the same level as modeling. A system that can adapt without strong promotion, demotion, and audit rules will eventually become untrustworthy.
- The right long-term goal is not full autonomy by default. The right goal is governed autonomy: authority that expands only when evidence, risk controls, and operator visibility justify it.

Problems V3 is not intending to solve in its first iteration:
- fully unsupervised self-modifying trading logic
- unlimited strategy proliferation without bounded governance
- a black-box LLM portfolio manager
- every possible data source or alternative-data feed
- high-frequency execution infrastructure

---

## Development Overview

Backtester V3 will build on top of the V2 signal-quality foundation and introduce the long-term decision layer for capital competition, adaptive portfolio construction, experiment governance, and bounded autonomy. The system should still remain evidence-first and operator-visible, but it should become more capable of deciding what deserves more or less authority across strategies, symbols, and market conditions.

The implementation direction is:
- promote V2 opportunity scoring into a cross-strategy ranking and capital-allocation substrate
- introduce portfolio-aware budgeting, exposure controls, and strategy competition
- connect challenger and incumbent governance directly to authority tiers rather than treating validation as a side report
- use the decision brain and research plane as bounded inputs into capital selection, not as narrative theater
- formalize autonomy tiers so paper, advisory, supervised-live, and higher-authority modes are explicit policy states
- keep every authority change reversible, audited, and backed by machine-readable evidence

The result should be a system that can answer:
- what should we own, not just what looks interesting
- why does this strategy currently deserve more or less capital
- what changed in the market, the validation evidence, or the portfolio state to justify that decision
- how much autonomy should the system have right now

This Development Overview should remain in sync with the matching Tech Spec if one is created later.

---

## Success Metrics

Primary success metrics for V3:
- Portfolio-level profit factor, drawdown control, and regime robustness improve relative to a V2-style signal-only operating mode.
- Strategy authority and capital allocation become auditable from artifacts rather than inferred from scattered reports or operator memory.
- The system can demote weak strategies or reduce autonomy without manual forensic work.

Supporting success signals:
- the portfolio engine can rank and budget across multiple strategy families without collapsing into indicator soup or constant churn
- autonomy tiers are explicit and observable, with clear reasons for promotions, restrictions, and demotions
- operator surfaces can explain portfolio posture, capital concentration, risk budget usage, and current trust tiers in one coherent view
- the system remains point-in-time safe and benchmark-aware even as it becomes more adaptive
- live or paper behavior remains understandable enough that the operator can intervene confidently when needed

---

## Assumptions

- V2 has already improved signal quality enough that opportunity scores and confidence can be used as meaningful portfolio inputs.
- Governance, walk-forward validation, and regime-segment analysis exist at sufficient quality to gate authority.
- A bounded number of strategy families will exist at first; V3 should manage strategy competition without requiring dozens of strategies on day one.
- Paper and supervised-live modes remain valid proving grounds before broader autonomy expansion.
- Operator trust remains a first-class requirement. If autonomy grows while visibility shrinks, V3 has failed.

---

## Out of Scope

- high-frequency or latency-sensitive execution systems
- unconstrained autonomous capital deployment without policy rails
- replacing interpretable artifacts with opaque end-to-end model outputs
- ingesting every possible macro, sentiment, or alternative-data source before the governance model is mature
- hyperparameter farms or brute-force strategy search without experiment discipline

---

## High Level Requirements

| Requirement | Description | Notes |
|-------------|-------------|-------|
| [Portfolio-aware capital allocation](#portfolio-aware-capital-allocation) | V3 must rank opportunities across strategies and allocate risk or capital with explicit portfolio constraints. | Moves beyond single-signal evaluation. |
| [Governed strategy authority](#governed-strategy-authority) | Strategy trust tiers must directly influence whether a strategy can recommend, paper-trade, or receive supervised-live authority. | Governance must affect behavior. |
| [Decision brain and research integration](#decision-brain-and-research-integration) | Decision-state, narrative, and research artifacts must inform portfolio decisions in bounded, explainable ways. | No narrative-only authority. |
| [Explicit autonomy tiers](#explicit-autonomy-tiers) | The product must define clear operating modes from advisory through more automated states, each with policy rails and auditability. | Governed autonomy core. |
| [Continuous validation and drift response](#continuous-validation-and-drift-response) | V3 must detect degradation, shrink authority, and surface drift before poor performance compounds. | Demotion matters as much as promotion. |
| [Operator command center](#operator-command-center) | The operator must have one place to understand trust, allocation, exposure, drift, and intervention options. | Long-term control surface. |

---

## Detailed User Stories

### Glossary

| Term | Meaning |
|------|---------|
| Authority tier | The level of permission a strategy or system mode has, such as advisory, paper, supervised-live, or higher-trust live authority. |
| Capital competition | The process by which multiple strategies or opportunities compete for limited portfolio budget. |
| Risk budget | Explicit limits on capital, exposure, concentration, or drawdown that shape allocation decisions. |
| Governed autonomy | A system design where automation is allowed only within explicit, evidence-backed policy boundaries. |
| Portfolio posture | The machine-readable state describing current exposures, concentration, risk usage, and allocation stance. |

---

### Portfolio-Aware Capital Allocation

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As an operator, I want the system to rank opportunities across strategies and symbols so that the best ideas compete fairly for capital instead of being evaluated in isolation. | Core V3 leap. |
| Draft | As a portfolio engine, I want capital and risk budgets to constrain sizing, concentration, and overlap so that a cluster of similar signals does not accidentally dominate the book. | Budgeting must be explicit. |
| Draft | As a reviewer, I want to distinguish good raw ideas from poor portfolio fit so that the system can reject a signal for portfolio reasons without labeling the strategy itself as broken. | Signal quality and portfolio fit stay separate. |

---

### Governed Strategy Authority

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As a governance layer, I want strategy trust tiers to control how much authority each strategy has so that validation outcomes directly change behavior. | No trust theater. |
| Draft | As an operator, I want challengers, incumbents, and demoted strategies shown clearly so that I know what currently has real influence on portfolio decisions. | Prevents invisible drift. |
| Draft | As a system maintainer, I want authority changes written as machine-readable artifacts with reasons so that promotions and demotions are reversible and auditable. | Required for long-term credibility. |

---

### Decision Brain And Research Integration

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As a decision engine, I want regime, breadth, narrative, and research artifacts to adjust ranking and trust in bounded ways so that contextual intelligence improves selection without becoming a black box. | Builds on V2/V4-style state. |
| Draft | As an operator, I want the system to explain when research freshness, crowding, or regime conflict reduced allocation so that capital decisions remain understandable. | Context must be visible. |

---

### Explicit Autonomy Tiers

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As the account owner, I want advisory, paper, supervised-live, and future higher-trust modes to be explicit product states so that automation only expands when evidence and policy allow it. | Long-term autonomy should be governed. |
| Draft | As a risk-conscious operator, I want each autonomy tier to have distinct guardrails, alerts, and intervention paths so that a stronger mode never feels opaque or irreversible. | Policy rails are mandatory. |

---

### Continuous Validation And Drift Response

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As a monitoring system, I want to detect drift, degraded regime coverage, and weakening calibration early so that the system can reduce trust before losses compound. | Continuous validation is a product feature. |
| Draft | As an operator, I want the system to explain whether degradation comes from data quality, strategy decay, regime shift, or portfolio crowding so that intervention is targeted instead of reactive. | Better diagnosis, faster response. |

---

### Operator Command Center

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As an operator, I want one command surface that shows portfolio posture, risk budget, trust tiers, current autonomy mode, and intervention options so that I can run the system confidently. | This is the long-term operating surface. |
| Draft | As a maintainer, I want overrides, pauses, demotions, and approvals captured in the same truth surface so that operational decisions stay auditable. | Human intervention must be legible. |

---

## Appendix

### Long-Term Goals

- Build a system that can move from stock-picking assistance to governed capital allocation without losing interpretability.
- Create a research and governance loop where new ideas can be proposed, evaluated, promoted, demoted, and retired with discipline.
- Reach a state where the operator can trust not only the latest signal, but the entire portfolio posture and autonomy level.
- Make the system resilient to regime change, data drift, and strategy decay rather than fragile to any one market style.
- Preserve a human-commanded operating model even as autonomy expands.

### Proposed V2 To V3 Bridge

1. Use V2 opportunity scores as the canonical input to cross-strategy ranking.
2. Introduce trust-tier-driven strategy authority.
3. Add portfolio budgeting, overlap control, and exposure-aware ranking.
4. Formalize autonomy tiers and policy gates.
5. Build the command-center view for posture, trust, drift, and intervention.
6. Expand automation only after those controls are stable.

### Resolved Direction

- V2 is the proof layer: better signal quality, better validation, better trust.
- V3 is the allocation and autonomy layer: portfolio competition, strategy authority, and governed automation.
- The north star is not “let the model trade freely.” The north star is “let the system earn more authority through evidence while keeping the operator in command.”

### Resolved Decisions

- The first version of V3 will allocate in two stages rather than jumping directly to fully position-level autonomy:
  - stage 1 sets budgets and authority at the strategy-family level
  - stage 2 lets each strategy rank and propose individual positions within its assigned budget
  This preserves interpretability, makes governance easier to audit, and keeps capital competition bounded while the portfolio engine matures.

- V3 will use a four-layer canonical risk-budget stack:
  - portfolio drawdown budget as the top-level kill-switch and authority reducer
  - gross exposure budget as the main portfolio heat control
  - per-position size limits as the primary single-name loss cap
  - sector and theme concentration caps as overlap control
  This order reflects the wiki's risk-management and drawdown guidance: protect survivability first, then shape allocation beneath that constraint.

- Moving from `supervised-live` into any stronger autonomy tier will require all of the following evidence:
  - at least 250 settled samples on the active strategy or authority path, with acceptable coverage across the main market-posture regimes
  - benchmark outperformance and acceptable drawdown behavior in walk-forward and degraded-fill testing
  - calibrated opportunity scoring and no material unresolved drift in data, predictions, or execution assumptions
  - a clean supervised-live observation window with no unexplained policy breaches, no unresolved operational incidents, and no silent fallback behavior in operator surfaces
  - explicit operator approval recorded as an artifact, not implied by inertia
  Stronger autonomy should be earned through evidence and release discipline, not simply by time in market.

### Collaboration Topics

- V2 measurement outputs and trust thresholds will become direct inputs to V3 authority and allocation logic.
- Decision-brain and research-plane artifacts must stay bounded and interpretable so they can influence allocation without becoming opaque.
- Operator surfaces in Mission Control will need a dedicated portfolio-posture and autonomy-mode layer.

### Technical Considerations

- Keep portfolio-fit decisions separate from raw strategy-quality decisions.
- Keep every authority and allocation change replayable and audit-backed.
- Preserve point-in-time safety across strategy, portfolio, and autonomy layers.
