# Implementation Plan - Prediction Loop, Measurement, And Decision Math

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Owner(s) | TBD |
| Epic | BT-W2 Prediction Loop, Measurement, And Decision Math |
| Tech Spec | [02-prediction-loop-and-measurement.md](/Users/hd/Developer/cortana-external/backtester/planning/TechSpecs/02-prediction-loop-and-measurement.md) |
| PRD | [02-prediction-loop-and-measurement.md](/Users/hd/Developer/cortana-external/backtester/planning/PRDs/02-prediction-loop-and-measurement.md) |

---

## Dependency Map

| Vertical | Dependencies | Can Start? |
|----------|-------------|------------|
| V1 — Prediction contract baseline | W1 contracts available | Start Now |
| V2 — Settlement enrichment and excursion metrics | V1 | Start after V1 |
| V3 — Rolling accuracy and calibration rollups | V1, V2 | Start after V1, V2 |
| V4 — Opportunity-cost and veto-effectiveness reporting | V2, V3 | Start after V2, V3 |
| V5 — Benchmark and null-model comparisons | V2, V3 | Start after V2, V3 |
| V6 — Operator report refresh and weekly-review surfaces | V3, V4, V5 | Start after V3, V4, V5 |

---

## Recommended Execution Order

```text
Week 1: V1
Week 2: V2
Week 3: V3
Week 4: V4 + V5
Week 5: V6 + replay/regression cleanup
```

---

## Sprint 1 — Prediction And Settlement Contracts

### Vertical 1 — Prediction Contract Baseline

**backtester: define the full prediction artifact contract and retrofit current strategy producers**

*Dependencies: W1 contracts available*

#### Jira

- [x] Sub-task 1: Create a central prediction contract helper under `backtester/evaluation` that standardizes required fields such as symbol, strategy, action, confidence, risk, regime, breadth state, entry-plan reference, execution-policy reference, reason, timestamp, and schema metadata.
- [x] Sub-task 2: Update `backtester/advisor.py`, `backtester/canslim_alert.py`, and `backtester/dipbuyer_alert.py` so each emitted prediction snapshot includes the full contract, even if some fields are presently null placeholders for later workstreams.
- [x] Sub-task 3: Add validation helpers so incomplete predictions fail tests instead of silently writing partial artifacts.

#### Testing

- Existing strategy paths emit the required prediction fields.
- Confidence and risk remain separate and survive serialization.
- Missing required fields fail validation fast.

---

### Vertical 2 — Settlement Enrichment And Excursion Metrics

**backtester: add richer settlement artifacts and path-aware validation**

*Dependencies: V1*

#### Jira

- Sub-task 1: Extend `backtester/outcomes.py` and related settlement helpers to compute horizon returns, max favorable excursion, max adverse excursion, pending coverage, and settlement maturity state.
- Sub-task 2: Add action-aware grading helpers that distinguish signal validation, entry validation, execution validation, and trade validation.
- Sub-task 3: Persist or emit settlement artifacts in a stable versioned shape for later reports.

#### Testing

- Settled artifacts preserve both return horizons and excursion metrics.
- Pending or insufficient coverage is distinct from settled failure.
- Signal and execution grades can diverge in the same artifact.

---

## Sprint 2 — Rolling Measurement Views

### Vertical 3 — Rolling Accuracy And Calibration Rollups

**backtester: turn raw predictions and settlements into usable grouped summaries**

*Dependencies: V1, V2*

#### Jira

- Sub-task 1: Update `backtester/evaluation/prediction_accuracy.py` to compute grouped rollups by strategy, action, regime bucket, and confidence bucket.
- Sub-task 2: Update `backtester/data/confidence.py` and `backtester/buy_decision_calibration.py` to support stable confidence-bucket and calibration outputs for the new contract.
- Sub-task 3: Extend `backtester/prediction_accuracy_report.py` to render rolling 20/50/100-sample summaries and preserve machine-readable payloads.

#### Testing

- Grouped rollups remain stable across replay runs.
- Confidence buckets aggregate correctly.
- Reports explain stale calibration state instead of hiding it.

---

### Vertical 4 — Opportunity-Cost And Veto-Effectiveness Reporting

**backtester: measure what the system is missing and why**

*Dependencies: V2, V3*

#### Jira

- Sub-task 1: Extend `backtester/evaluation/decision_review.py` or a companion module to compute missed-winner and overblock summaries for `WATCH` and `NO_BUY` outcomes.
- Sub-task 2: Record veto paths or downgrade reasons in a reusable structure for later scorecards.
- Sub-task 3: Emit dedicated opportunity-cost and veto-effectiveness artifacts for weekly review and later governance gates.

#### Important Planning Notes

- Counterfactual reporting should stay honest and descriptive.
- Do not let opportunity-cost math imply certainty that a real trade would have been taken or filled.

#### Testing

- Missed-winner scoring works on replay fixtures.
- Veto reports can distinguish helpful blocks from harmful overblocking.
- Empty or immature sample windows do not emit misleading ratios.

---

## Sprint 3 — Scientific Comparisons And Operator Surfaces

### Vertical 5 — Benchmark And Null-Model Comparisons

**backtester: compare strategy outcomes against simple baselines**

*Dependencies: V2, V3*

#### Jira

- Sub-task 1: Create lightweight baseline comparison helpers under `backtester/evaluation/benchmark_models.py`.
- Sub-task 2: Add benchmark comparisons to measurement rollups without breaking current report readers.
- Sub-task 3: Persist the benchmark comparison outputs for later governance and promotion work.

#### Testing

- Benchmark outputs are present and machine-readable.
- Null-model comparisons do not mutate historical prediction artifacts.
- Baseline comparisons are stable for replayed sample windows.

---

### Vertical 6 — Operator Report Refresh

**backtester: refresh weekly and rolling measurement surfaces so humans can use the new data**

*Dependencies: V3, V4, V5*

#### Jira

- Sub-task 1: Update report formatting in `backtester/prediction_accuracy_report.py` and any supporting formatters to surface strategy/action/regime/confidence groupings clearly.
- Sub-task 2: Add concise summary sections for opportunity cost, veto effectiveness, and benchmark comparisons.
- Sub-task 3: Ensure machine-readable rollups are written before human-readable summaries and remain the source of truth.

#### Testing

- Reports remain readable with the richer metric set.
- Weekly review surfaces can answer which strategy, confidence bucket, and veto path are working.
- Human-readable reports remain consistent with machine rollups.

---

## Dependency Notes

### V1 before V2

Settlement enrichment depends on a stable prediction contract to know what is being settled.

### V2 before V3/V4/V5

Rollups, opportunity-cost, and benchmark comparisons all rely on rich settlement context.

### V3 before V6

Operator surfaces should render finalized rollups rather than reimplement rollup logic inline.

---

## Scope Boundaries

### In Scope (This Plan)

- prediction contract expansion
- settlement enrichment
- rolling measurement artifacts
- calibration-aware summaries
- opportunity-cost and veto-effectiveness reporting
- benchmark and null-model comparisons

### External Dependencies

- W1 machine-truth contracts and failure semantics
- later lifecycle workstream for full entry-plan and execution-policy richness

### Integration Points

- strategy producers under `backtester/`
- evaluation and reporting modules under `backtester/evaluation/`
- future governance and adaptive-weighting consumers

---

## Realistic Delivery Notes

- **Biggest risks:** enriching measurement artifacts without making reports unreadable; mixing prediction-time truth with settlement-time truth; under-specifying benchmark comparators.
- **Assumptions:** current strategy producers can be upgraded additively; confidence may remain advisory early on; full lifecycle authority is not yet required for this workstream to provide value.

## Update On Every Commit

Each implementation PR under this workstream should update this plan with:
- shipped prediction or settlement contract changes
- new rollup or benchmark artifacts added
- new replay fixtures or measurement tests added
- blocked dependencies from lifecycle or governance workstreams
- rollout, backfill, or sequencing deviations from the original plan
