# Implementation Plan - Backtester V2 Signal Intelligence And Operator Trust

**Document Status:** Complete

## Team

| Role | Assignee |
|------|----------|
| Owner(s) | @hameldesai |
| Epic | BT-V2 Signal Intelligence And Operator Trust |
| Tech Spec | [08-backtester-v2-signal-intelligence-and-operator-trust.md](../TechSpecs/08-backtester-v2-signal-intelligence-and-operator-trust.md) |
| PRD | [08-backtester-v2-signal-intelligence-and-operator-trust.md](../PRDs/08-backtester-v2-signal-intelligence-and-operator-trust.md) |

---

## Dependency Map

| Vertical | Dependencies | Can Start? |
|----------|-------------|------------|
| V1 — Core feature bundle and regime contract | Existing market data inputs | Start Now |
| V2 — Opportunity scoring and action mapping | V1 | Start after V1 |
| V3 — Evaluation and trust summaries | V1, V2 | Start after V1, V2 |
| V4 — New regime-aware momentum / relative-strength family | V1, V2 | Start after V1, V2 |
| V5 — Mission Control trust surfaces and rollout | V3 | Start after V3 |

---

## Recommended Execution Order

```text
Week 1: V1
Week 2: V2 + V4
Week 3: V3
Week 4: V5 + shadow comparisons
```

---

## Sprint 1 — Signal Substrate

### Vertical 1 — Core Feature Bundle And Regime Contract

**cortana-external backtester: normalize the V2 feature and regime substrate**

*Dependencies: Existing market data inputs*

#### Jira

- [x] Sub-task 1: Add `backtester/features/core_feature_bundle.py` to assemble price, volume, trend, breadth, realized volatility, relative strength, and technical-transform inputs.
- [x] Sub-task 2: Extend `backtester/data/market_regime.py` and `backtester/data/adverse_regime.py` to emit the canonical regime labels used by V2 scoring and evaluation.
- [x] Sub-task 3: Add versioned artifact writers for the feature bundle and regime context.

#### Testing

- Feature bundles serialize deterministically.
- Regime labels are stable for identical inputs.
- Missing or stale source inputs degrade clearly rather than inventing confidence.

---

## Sprint 2 — Score Layer

### Vertical 2 — Opportunity Scoring And Action Mapping

**cortana-external backtester: turn features into the primary V2 ranking contract**

*Dependencies: V1*

#### Jira

- [x] Sub-task 1: Add `backtester/scoring/opportunity_score.py` with score computation and score-to-action mapping rules.
- [x] Sub-task 2: Update `backtester/advisor.py` to consume the opportunity-score contract instead of ad hoc ranking logic.
- [x] Sub-task 3: Extend `backtester/evaluation/prediction_contract.py` with score, action mapping, and horizon provenance fields.

#### Important Planning Notes

- Opportunity score is the primary output; `BUY`, `WATCH`, and `NO_BUY` remain the operator-facing abstraction.
- Confidence and downside risk must remain separate fields.

#### Testing

- Score-to-action mapping is deterministic and bounded.
- Canonical 1-5 day horizon is preserved in emitted artifacts.
- Weak evidence does not produce inflated score confidence.

---

### Vertical 3 — Regime Momentum / Relative-Strength Challenger

**cortana-external backtester: add one new strategy family without widening scope**

*Dependencies: V1, V2*

#### Jira

- [x] Sub-task 1: Add a regime-aware momentum / relative-strength strategy family that reads the V2 feature bundle.
- [x] Sub-task 2: Register the new family in evaluation outputs and strategy score summaries.
- [x] Sub-task 3: Keep the family benchmarked against incumbent strategies instead of granting special authority.

#### Testing

- New strategy artifacts remain comparable to incumbent family artifacts.
- Strategy stays bounded by the same calibration and benchmark rules.
- New family can be disabled without affecting incumbent flows.

---

## Sprint 3 — Measurement And Trust

### Vertical 4 — Evaluation And Trust Summaries

**cortana-external backtester: make the signal layer operator-readable and governance-ready**

*Dependencies: V1, V2*

#### Jira

- [x] Sub-task 1: Add `backtester/evaluation/regime_slices.py` and `backtester/evaluation/strategy_scorecard.py`.
- [x] Sub-task 2: Extend `backtester/evaluation/comparison.py` and `backtester/evaluation/prediction_accuracy.py` for the canonical V2 horizon and benchmark summaries.
- [x] Sub-task 3: Write fresh/warming/degraded/stale evaluation summaries for downstream surfaces.

#### Testing

- Profit factor, drawdown, regime coverage, and calibration summaries render consistently.
- Warming states do not masquerade as error states.
- Benchmark and regime-slice summaries remain machine-readable.

---

## Sprint 4 — Operator Trust Surface

### Vertical 5 — Mission Control Trust Surface And Shadow Rollout

**cortana-external Mission Control: surface V2 trust without silently increasing authority**

*Dependencies: V3*

#### Jira

- [x] Sub-task 1: Update `apps/mission-control/lib/trading-ops.ts` and `backtester/operator_surfaces/mission_control.py` to consume the new trust summaries.
- [x] Sub-task 2: Update `apps/mission-control/components/trading-ops-dashboard.tsx` to show V2 score/trust/freshness states cleanly.
- [x] Sub-task 3: Add shadow comparison output comparing incumbent ranking vs V2 score behavior before any broader activation.

#### Testing

- Mission Control shows `fresh`, `warming`, `degraded`, and `stale` correctly.
- Shadow comparisons are inspectable and do not change live authority.
- Cold-start data lag renders neutral loading states rather than false errors.

---

## Dependency Notes

### V1 before everything else

The feature and regime contract must exist before scoring, evaluation, or the new strategy family can stay consistent.

### V3 before V5

Mission Control should read trust summaries, not recompute them.

---

## Scope Boundaries

### In Scope (This Plan)

- normalized feature and regime substrate
- opportunity-score contract
- canonical score-to-action mapping
- one new strategy family
- trust summaries and Mission Control visibility
- shadow rollout and comparison-only activation

### External Dependencies

- none required beyond existing market-data and Mission Control read paths

### Integration Points

- `backtester/data/confidence.py`
- `backtester/data/market_regime.py`
- `backtester/data/adverse_regime.py`
- `backtester/evaluation/comparison.py`
- `backtester/evaluation/prediction_accuracy.py`
- `backtester/advisor.py`
- `backtester/market_brief_snapshot.py`
- `apps/mission-control/lib/trading-ops.ts`
- `apps/mission-control/components/trading-ops-dashboard.tsx`

---

## Realistic Delivery Notes

- **Biggest risks:** conflating confidence with downside risk, drifting into too many new strategies, surfacing stale data as failures, and letting V2 logic bypass shadow review.
- **Assumptions:** the first implementation remains swing-horizon focused; opportunity scoring can launch in shadow mode first; existing provider-normalization boundaries remain unchanged.
