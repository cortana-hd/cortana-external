# Product Requirements Document (PRD) - Backtester V4 Unified Trading Control Loop And Scaled Compounding

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Primary Owner | @hameldesai |
| Epic | BT-V4 Unified Trading Control Loop And Scaled Compounding |

---

## Problem / Opportunity

V2 gives the system a more trustworthy signal layer. V3 gives it portfolio awareness, strategy authority, and governed autonomy. But long-term money-making will still remain fragile unless the product becomes one coherent operating system rather than a stack of partially connected subsystems.

Without a unified control loop, the following failure mode remains likely:
- predictions improve, but allocation drifts from risk intent
- governance artifacts exist, but authority changes happen too slowly or opaquely
- operator surfaces explain the present, but do not actively help the system converge toward a desired posture
- model and strategy changes ship, but rollout, monitoring, and rollback stay too ad hoc for compounding capital safely

The opportunity for V4 is to bring the direction together into one scaled trading product that can:
- make money through disciplined capital allocation, not just isolated stock picks
- learn and adapt through explicit control loops rather than reactive patching
- scale across more strategies, more capital, and more operating complexity without becoming untrustworthy
- remain observable, governable, and operator-commanded even as automation increases

V4 is the phase where the product becomes a true compounding system: observe, compare, allocate, act, validate, and iterate continuously.

---

## Insights

- The strongest pattern from the wiki is control-loop thinking. The product should behave like a reconciliation system:
  - observe current state
  - compare it to desired state
  - act to close the gap
  - repeat safely and idempotently
- Capital allocation is the real economic core. Prediction quality matters only insofar as it helps scarce capital go to the best risk-adjusted opportunities.
- Drawdown and time under water are first-class product outcomes, not secondary reporting metrics. A system that makes money but cannot be held through its loss path is not yet scalable.
- Risk management must be proactive, not forensic. Hard limits, authority reductions, canaries, kill switches, and staged rollouts should exist before the failure.
- Observability and MLOps are part of the trading edge because they determine whether the system can scale and keep learning without shipping invisible regressions.

Problems V4 is not intending to solve in its first iteration:
- high-frequency execution or market-making infrastructure
- fully human-out-of-the-loop capital deployment
- multi-tenant SaaS productization
- unlimited strategy or data-source expansion without bounded governance
- opaque end-to-end black-box decision systems

---

## Development Overview

Backtester V4 will unify the product into a layered trading control loop with explicit desired-state artifacts, actual-state observation, policy-driven reconciliation, and continuous validation. The system should no longer be thought of as just a backtester or just a dashboard. It should operate as a capital-allocation platform with four coordinated loops:

1. the signal loop:
   turns market data into opportunity scores and ranked candidate sets
2. the portfolio loop:
   turns candidate sets into portfolio posture, budget, and allocation decisions
3. the governance loop:
   decides what strategy, model, and autonomy tier currently deserve authority
4. the operations loop:
   observes runtime health, drift, rollout safety, and rollback conditions so the whole system stays trustworthy in production

The implementation direction is:
- define a canonical desired-state artifact for portfolio posture, authority tiers, risk budgets, and active release version
- define a matching actual-state artifact for positions, exposures, realized outcomes, runtime health, drift, and source freshness
- reconcile desired state and actual state through bounded policy rules and operator-visible interventions
- package every material strategy or model change as a full release unit with tests, canaries, shadow evaluation, and rollback
- make Mission Control the control tower for state, drift, authority, allocation, and intervention
- preserve a human-commanded operating mode even as autonomy tiers expand

The result should be a system that can answer:
- what is the target portfolio posture right now
- what do we actually hold or recommend right now
- why is there a gap between desired and actual state
- what should the system do next to close that gap
- is the current release, model, and authority stack safe enough to trust with more capital

This Development Overview should remain in sync with the matching Tech Spec if one is created later.

---

## Success Metrics

Primary success metrics for V4:
- Portfolio-level profit factor, max drawdown, and recovery duration improve relative to the V3 operating mode.
- The system can scale strategy count, capital at risk, and operating cadence without meaningfully increasing unexplained behavior or operator confusion.
- Material regressions are caught by canaries, drift monitors, or policy gates before they become sustained trading damage.

Supporting success signals:
- every live or supervised-live decision path has an associated desired-state, actual-state, and reconciliation explanation
- release rollouts for strategy or model changes become staged, benchmarked, and rollback-capable rather than all-at-once
- Mission Control can show trust, allocation, risk heat, drift, and intervention options in one unified control surface
- strategy additions become easier because new logic plugs into the same authority, budget, and observability model instead of inventing new lanes
- the system can operate for long periods without silent degradation, stale trust, or undocumented authority changes

---

## Assumptions

- V2 and V3 have already established credible opportunity scoring, trust tiers, and strategy-competition primitives.
- The product will continue to prioritize swing-trading horizons and controlled autonomy over ultra-low-latency trading.
- A single-account or bounded multi-account setup is sufficient for the first V4 implementation; scale means product maturity and capital discipline before it means broad distribution.
- Mission Control remains the primary operator surface and can evolve into the control tower instead of being replaced.
- Operator trust remains a non-negotiable design goal. If the system gets harder to interrogate as it gets smarter, V4 is mis-specified.

---

## Out of Scope

- HFT infrastructure or exchange-colocation style optimization
- instant fully autonomous capital management without supervised tiers
- brute-force experiment farms with no promotion discipline
- every possible broker or custody integration in phase 1
- turning the system into a consumer product before the internal operating loop is stable

---

## High Level Requirements

| Requirement | Description | Notes |
|-------------|-------------|-------|
| [Unified desired-state and actual-state model](#unified-desired-state-and-actual-state-model) | V4 must define canonical desired and actual state for portfolio posture, authority, risk, and runtime so the product can reconcile toward intent. | Control-loop core. |
| [Capital allocation and compounding engine](#capital-allocation-and-compounding-engine) | The system must allocate scarce capital to the best risk-adjusted opportunities while protecting drawdown and survivability. | Economic core of the product. |
| [Governed release and MLOps loop](#governed-release-and-mlops-loop) | Strategy, model, and policy changes must ship through packaging, canarying, drift checks, and rollback discipline. | Scale requires release discipline. |
| [Observability and intervention first](#observability-and-intervention-first) | The operator must be able to ask new questions about behavior, trace regressions, and intervene before problems compound. | Observability is a product feature. |
| [Mission Control as control tower](#mission-control-as-control-tower) | Mission Control must present one coherent view of state, risk, authority, drift, rollout, and intervention. | Unifies W6/W7 direction. |
| [Extensible operating model](#extensible-operating-model) | New strategies, data sources, and accounts must fit the same contracts, budgets, and control loops instead of spawning parallel systems. | Scale through structure, not sprawl. |

---

## Detailed User Stories

### Glossary

| Term | Meaning |
|------|---------|
| Desired state | The system's target portfolio posture, authority tier, risk budget, and active release intent. |
| Actual state | The current observed portfolio, runtime, data, model, and exposure reality. |
| Reconciliation | The act of comparing desired and actual state and taking bounded steps to reduce the gap. |
| Compounding engine | The allocation logic that seeks long-run capital growth while respecting risk and survivability constraints. |
| Control tower | The operator surface where trust, posture, drift, rollout, and interventions are unified. |

---

### Unified Desired-State And Actual-State Model

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As a trading system, I want a canonical desired-state artifact for posture, authority, release version, and risk budgets so that the product knows what "good" is supposed to look like right now. | Core V4 contract. |
| Draft | As an operator, I want a matching actual-state artifact for positions, exposures, runtime health, drift, freshness, and realized outcomes so that I can see reality without piecing together multiple tools. | Actual state is equally first-class. |
| Draft | As a control loop, I want reconciliation actions to be explicit and idempotent so that repeated runs reduce drift instead of compounding side effects. | Directly reflects the wiki control-loop guidance. |

---

### Capital Allocation And Compounding Engine

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As an account owner, I want scarce capital allocated to the best risk-adjusted opportunities so that the system improves compounding instead of just idea generation. | Capital allocation is the economic center. |
| Draft | As a portfolio engine, I want drawdown budget, exposure budget, concentration caps, and per-position limits to shape allocation so that survivability comes before aggressiveness. | Reflects the wiki's risk and drawdown emphasis. |
| Draft | As a reviewer, I want recovery duration and time under water tracked alongside returns so that a high-return but operationally painful strategy does not get mistaken for scalable quality. | Usability matters. |

---

### Governed Release And MLOps Loop

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As a system maintainer, I want every strategy, model, and policy change packaged as a full release unit with code, feature logic, dependencies, and configuration so that rollout and rollback are real. | Mirrors the wiki's MLOps release-unit principle. |
| Draft | As an operator, I want canary, shadow, and staged rollout modes so that a promising change proves itself before it is trusted with more authority. | Pre-failure control. |
| Draft | As a monitoring system, I want drift, training-serving skew, and prediction-quality changes detected continuously so that adaptation is deliberate rather than reactive. | Continuous validation is required. |

---

### Observability And Intervention First

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As an operator, I want to ask new questions about a bad day, a bad strategy, or a bad rollout without shipping new code first so that investigation speed scales with system complexity. | Direct observability requirement. |
| Draft | As a maintainer, I want logs, metrics, traces, and model-quality artifacts correlated by run, release, and strategy so that I can move from symptom to cause quickly. | Supports real debugging. |
| Draft | As a risk-conscious owner, I want kill switches, authority reducers, and pause modes available before the incident so that intervention is fast and boring. | Risk management is proactive. |

---

### Mission Control As Control Tower

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As an operator, I want Mission Control to show desired posture, actual posture, drift, authority, release state, and intervention controls in one place so that the product feels unified. | This is the visible V4 surface. |
| Draft | As a maintainer, I want all overrides, demotions, rollout holds, and recovery actions visible in that same control surface so that human decisions stay legible. | Operational truth surface. |

---

### Extensible Operating Model

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As a platform owner, I want new strategies, research feeds, and future account scopes to plug into the same contracts and policy loops so that scale comes from structure, not one-off integration work. | Long-term scale path. |
| Draft | As a roadmap owner, I want the product to support iteration on top of the same core loop rather than needing a rewrite every time we add a new strategy family or authority mode. | Product compounding, not just capital compounding. |

---

## Appendix

### Long-Term Vision

- Turn the product from a better backtester into a compounding capital-allocation system.
- Treat the whole stack as a control loop, not a pile of scripts and dashboards.
- Make drawdown, recovery, trust, and rollout safety as visible as returns.
- Scale by adding disciplined loops and contracts, not by adding opaque complexity.
- Keep the operator in command while letting the system earn more authority through evidence.

### Tactics And Methodologies From The Wiki

- **Control loop**: build explicit observe / compare / act / repeat loops with desired-state and actual-state artifacts.
- **Capital allocation**: treat scarce capital as the central optimization target, not raw prediction volume.
- **Risk management**: separate upside from downside and put constraints in place before failure.
- **Drawdown budgeting**: manage survivability and recovery, not just total return.
- **Observability**: optimize for the ability to answer new questions, not just pre-baked dashboards.
- **MLOps**: package the full release unit, ship gradually, monitor drift continuously, and rollback the whole path when needed.

### Resolved Direction

- V2 is where the signal earns trust.
- V3 is where strategies compete for capital and authority.
- V4 is where the entire product becomes one governed trading control loop.
- The business goal is not just better predictions. The business goal is durable, scalable compounding with disciplined risk and visible control.

### Collaboration Topics

- `cortana` and `cortana-external` should increasingly share versioned contracts for state, rollout, and telemetry rather than only sharing artifacts informally.
- Mission Control will need portfolio-posture, rollout-state, and intervention layers in addition to current trading-ops truth surfaces.
- Future infrastructure changes should follow the same rollout and observability discipline as model or strategy changes.

### Technical Considerations

- Preserve point-in-time safety across all loops.
- Keep reconciliation actions idempotent where possible.
- Keep authority, allocation, and release decisions replayable and audit-backed.
- Avoid adding new moving parts unless they reduce risk, improve scale, or improve operator visibility.
