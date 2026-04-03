# Implementation Plan - Decision Brain, Narrative Discovery, And Research Plane

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Owner(s) | TBD |
| Epic | BT-W4 Decision Brain, Narrative Discovery, And Research Plane |
| Tech Spec | [04-decision-brain-narrative-and-research-plane.md](/Users/hd/Developer/cortana-external/backtester/planning/TechSpecs/04-decision-brain-narrative-and-research-plane.md) |
| PRD | [04-decision-brain-narrative-and-research-plane.md](/Users/hd/Developer/cortana-external/backtester/planning/PRDs/04-decision-brain-narrative-and-research-plane.md) |

---

## Dependency Map

| Vertical | Dependencies | Can Start? |
|----------|-------------|------------|
| V1 — Decision-state and research contracts | W1/W2 contracts available | Start Now |
| V2 — Adaptive weighting and confidence adjustments | V1 | Start after V1 |
| V3 — Multi-timeframe and intraday state machine | V1, V2 | Start after V1, V2 |
| V4 — Narrative discovery and overlay lane | V1 | Start after V1 |
| V5 — Research plane hot/warm/cold runtime | V1, V4 | Start after V1, V4 |
| V6 — Surface integration and shadow-mode review | V2, V3, V4, V5 | Start after V2, V3, V4, V5 |

---

## Recommended Execution Order

```text
Week 1: V1
Week 2: V2 + V4
Week 3: V3
Week 4: V5
Week 5: V6 + shadow comparisons
```

---

## Sprint 1 — Canonical State And Contracts

### Vertical 1 — Decision-State And Research Contracts

**backtester + TS-owned source lanes: define the machine contracts for state, narrative, and research artifacts**

*Dependencies: W1/W2 contracts available*

#### Jira

- Sub-task 1: Create a shared decision-state contract and serializer under a new `backtester/decision_brain/` package.
- Sub-task 2: Create shared research artifact contracts under `backtester/research/` with `schema_version`, `producer`, `known_at`, `generated_at`, freshness TTL, health, degraded reason, and provenance.
- Sub-task 3: Document producer/consumer ownership for TS-owned narrative or research fetchers and Python-owned synthesis artifacts.

#### Testing

- Decision-state artifacts validate and serialize consistently.
- Research artifacts preserve freshness and provenance fields.
- Missing `known_at` or TTL fields fail validation where required.

---

## Sprint 2 — Adaptive Evidence And Discovery Inputs

### Vertical 2 — Adaptive Weighting And Confidence Adjustments

**backtester: add bounded evidence-driven weighting and uncertainty logic**

*Dependencies: V1*

#### Jira

- Sub-task 1: Add a `weights.py` module for regime/session-aware strategy weights, veto weights, uncertainty penalties, and bounded change rates.
- Sub-task 2: Integrate existing confidence and comparison outputs into adaptive weight snapshots without changing live authority yet.
- Sub-task 3: Add cold-start behavior, minimum sample enforcement, smoothing, and decay controls.

#### Important Planning Notes

- High confidence from tiny samples must never appear equivalent to high confidence from mature buckets.
- Weights should move slowly enough to avoid overreacting to short streaks.

#### Testing

- Minimum-sample and cold-start cases behave conservatively.
- Weights are smoothed and bounded.
- Shadow outputs can be compared against current static behavior.

---

### Vertical 3 — Narrative Discovery And Overlay Lane

**backtester + TS source lanes: convert X and Polymarket into bounded discovery/overlay artifacts**

*Dependencies: V1*

#### Jira

- Sub-task 1: Normalize X-based outputs into `new_tickers`, `repeated_tickers`, `accelerating_tickers`, and `crowded_tickers`.
- Sub-task 2: Normalize Polymarket outputs into theme support/conflict and theme-to-ticker mappings.
- Sub-task 3: Add explicit bounded rules so narrative outputs can prioritize discovery or nudge confidence, but never create standalone buy authority.

#### Testing

- Discovery outputs remain bounded and machine-readable.
- Manipulated or noisy social bursts on illiquid names do not create authority.
- Crowding warnings can reduce confidence without forcing false sell authority.

---

## Sprint 3 — Intraday Authority And Research Runtime

### Vertical 4 — Multi-Timeframe And Intraday State Machine

**backtester: turn breadth/tape into an explicit intraday authority layer**

*Dependencies: V1, V2*

#### Jira

- Sub-task 1: Extend `backtester/data/intraday_breadth.py` into a state machine with `inactive`, `watch_only`, `selective_buy`, and `unavailable`.
- Sub-task 2: Add weekly/daily/short-term confirmation helpers for timing refinement.
- Sub-task 3: Add rules for narrow-rally rejection, persistence, session gating, and authority caps.

#### Testing

- Strong tape / weak breadth and broad breadth / weak tape disagreements are handled explicitly.
- Off-hours states remain inactive or unavailable as appropriate.
- Selective-buy authority is tightly bounded and explainable.

---

### Vertical 5 — Research Plane Hot/Warm/Cold Runtime

**backtester + TS-owned sources: add asynchronous research artifacts without blocking the hot path**

*Dependencies: V1, V4*

#### Jira

- Sub-task 1: Define hot-path read contracts for research artifacts used by `cday`, `cbreadth`, trading cron, and live scans.
- Sub-task 2: Define warm-lane refresh jobs for earnings, catalysts, theme maps, and ticker research profiles.
- Sub-task 3: Define cold-lane jobs for deep transcript and historical catalyst work, with clear scheduling and non-blocking rules.

#### Important Planning Notes

- Research jobs must never starve market-open paths.
- Late or partial research refreshes must degrade clearly rather than masquerade as current truth.

#### Testing

- Hot path reads completed research artifacts instantly.
- Warm/cold jobs cannot block or rewrite hot-path decisions causally.
- Stale or partial research artifacts are surfaced honestly.

---

## Sprint 4 — Surface Integration And Shadow Review

### Vertical 6 — Surface Integration And Shadow-Mode Review

**backtester: integrate the decision brain into current surfaces without prematurely increasing authority**

*Dependencies: V2, V3, V4, V5*

#### Jira

- Sub-task 1: Update `market_brief_snapshot.py`, `advisor.py`, and related formatters to consume canonical decision-state and research artifacts.
- Sub-task 2: Add shadow-mode artifacts that compare static vs adaptive state for operator review.
- Sub-task 3: Add operator wording that explains selective-buy, crowding, narrative nudges, and research freshness without overstating authority.

#### Testing

- Surfaces read canonical state rather than recomputing it.
- Shadow-mode diffs are easy to inspect.
- Operator wording remains truthful and bounded.

---

## Dependency Notes

### V1 before everything else

State, narrative, and research contracts must exist before adaptive logic, intraday logic, or surface integration can be reliable.

### V2 before V3/V6

Adaptive weighting and uncertainty rules are inputs to the decision brain and operator explanations.

### V4 before V5

Research-plane consumers need stable narrative and theme artifact shapes before scheduling or composing them into research outputs.

---

## Scope Boundaries

### In Scope (This Plan)

- canonical decision-state contract
- adaptive weighting in shadow mode
- multi-timeframe confirmation
- bounded intraday authority
- narrative discovery and overlay artifacts
- asynchronous research plane contracts and runtime
- surface integration using canonical artifacts

### External Dependencies

- TS-owned fetchers for narrative or research inputs where external APIs are involved
- later governance workstream for promotion, retirement, and enforcement gates

### Integration Points

- `backtester/data/confidence.py`
- `backtester/evaluation/comparison.py`
- `backtester/data/intraday_breadth.py`
- `backtester/data/x_sentiment.py`
- `backtester/data/polymarket_context.py`
- `backtester/market_brief_snapshot.py`
- `backtester/advisor.py`

---

## Realistic Delivery Notes

- **Biggest risks:** turning the system opaque; overreactive weights; narrative creep into trade authority; stale or late research artifacts contaminating hot-path state.
- **Assumptions:** adaptive logic can begin in shadow mode; research ownership boundaries remain intact; the first iteration values interpretability over maximum sophistication.

## Update On Every Commit

Each implementation PR under this workstream should update this plan with:
- shipped decision-state or research artifact schemas
- new adaptive-weight or narrative rules added
- new shadow comparisons or replay fixtures added
- blocked source dependencies or cross-repo contract needs
- any authority changes, activation-state changes, or rollback notes
