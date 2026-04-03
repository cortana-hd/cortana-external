# Product Requirements Document (PRD) - Prediction Loop, Measurement, And Decision Math

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Primary Owner | TBD |
| Epic | BT-W2 Prediction Loop, Measurement, And Decision Math |

---

## Problem / Opportunity

The current backtester can produce signals, alerts, and basic prediction accuracy summaries, but it still does not close the full learning loop tightly enough to support evidence-backed promotion of strategy logic. Confidence can still become stale, settlement summaries do not yet capture enough path information, and the system cannot consistently explain whether a prediction was directionally right, entry-useful, execution-realistic, or economically worthwhile.

The opportunity is to turn the system from “it makes calls” into “it makes measurable predictions that can later be validated, graded, and used to improve future behavior.” This workstream defines the measurement substrate that later lifecycle, sizing, adaptive weighting, and governance work will depend on.

Without this workstream:
- confidence remains decorative instead of evidence-backed
- later adaptive logic has no trustworthy feedback loop
- strategy comparisons can be distorted by missing outcome context
- operator review remains anecdotal instead of data-driven

---

## Insights

- A prediction engine becomes real only when every prediction can be logged, settled, graded, and compared later. Anything less is narrative, not learning.
- Confidence and risk are different quantities. This workstream should make them explicit, measurable, and independently reviewable.
- The system already has the beginnings of this loop in `prediction_accuracy.py`, `prediction_accuracy_report.py`, `decision_review.py`, and related tests. The leverage is in standardizing and enriching those artifacts rather than inventing a second evaluation stack.

Problems this workstream is not intending to solve:
- live broker execution
- full portfolio-aware decision support
- async research fetchers themselves
- strategy promotion governance beyond the measurement artifacts and metrics those later decisions require

---

## Development Overview

This workstream expands the prediction and settlement artifact family so every important decision can be traced through the full loop: predict, log, execute or paper-execute, settle, validate, and recalibrate. The implementation will enrich prediction snapshots, enrich settled artifacts with excursion and pending-coverage data, and produce rolling reports that split performance by strategy, action, regime, confidence bucket, and veto path.

The workstream will also formalize the core decision-math layer used for expected value, calibrated confidence, reward-to-risk, and opportunity-cost reporting. The result should be a system where future adaptive logic can ask defensible questions such as:
- which confidence buckets are actually trustworthy
- which strategies outperform under which regimes
- which vetoes help versus overblock
- which missed trades cost the system the most opportunity

This Development Overview must stay in sync with the matching Tech Spec.

---

## Success Metrics

- 100% of prediction artifacts emitted by the covered strategy paths include the full prediction contract: symbol, strategy, action, confidence, risk, regime, breadth state, entry-plan reference, execution-policy reference, reason, and timestamp.
- Settled artifacts include excursion-aware fields such as runup, drawdown, settlement coverage, and pending/unknown state where appropriate.
- Rolling accuracy and review reports can segment outcomes by:
  - strategy
  - action
  - regime
  - confidence bucket
  - veto path
- `no_settled_records` becomes a temporary early-state condition rather than a chronic reporting condition.
- Operator review can answer, from artifacts instead of memory:
  - which strategy is working
  - which confidence buckets are trustworthy
  - which vetoes are helping
  - where the system is missing winners
- Future adaptive and governance work can consume measurement artifacts without scraping free-form prose.

---

## Assumptions

- W1 Foundations And Runtime Reliability is in place or proceeds in parallel closely enough that prediction artifacts can reuse the new health and schema conventions.
- Predictions can be evaluated first through paper-trade and post-settlement analytics before any real capital authority is granted.
- Postgres remains the primary structured store, while file artifacts remain valid for replay and local inspection.
- Confidence remains visible to the operator, but sizing authority based on confidence will arrive in a later workstream.
- Existing strategy surfaces remain the entry points for predictions; this workstream enriches evaluation rather than replacing those surfaces.

---

## Out of Scope

- full lifecycle hold / trim / sell logic
- full sizing engine
- portfolio-level capital competition
- experiment promotion gates and challenger governance
- research-plane ingestion and asynchronous fetcher infrastructure

---

## High Level Requirements

| Requirement | Description | Notes |
|-------------|-------------|-------|
| Full prediction contract | Every prediction artifact must capture enough decision context to be validated later without reading operator prose. | Includes confidence and risk as distinct fields. |
| Rich settlement and grading | Settled artifacts must capture direction, excursions, pending coverage, and action-aware grading. | Needed for honest evaluation of predictions. |
| Rolling measurement surfaces | The system must produce repeatable summaries split by strategy, action, regime, confidence bucket, and veto path. | These are required inputs for later adaptive weighting. |
| Core decision math | Expected value, calibrated confidence, reward-to-risk, drawdown/runup, and opportunity-cost metrics must become explicit formulas or formula families. | Keep them interpretable and measured. |
| Benchmark-aware evaluation | Prediction quality must be comparable against simple baselines and null models. | Prevents false edge claims. |

---

## Detailed User Stories

### Glossary

| Term | Meaning |
|------|---------|
| Prediction loop | The required cycle of predict, log, settle, validate, and recalibrate. |
| Confidence validation | Evaluation of whether higher-confidence predictions actually outperform lower-confidence ones. |
| Opportunity cost | Measurement of what the system missed by saying `WATCH` or `NO_BUY` when a setup later worked. |
| Veto effectiveness | Measurement of whether a veto prevented more losers than winners. |
| Excursion metrics | Max favorable and max adverse movement after a prediction or trade. |

---

### Full Prediction Contract

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As a future evaluation job, I want every prediction to include symbol, action, confidence, risk, regime, breadth, reason, and execution references so that I can grade it later without inferring missing context. | Applies to CANSLIM, Dip Buyer, advisor outputs, and future strategy surfaces. |
| Draft | As an operator, I want confidence and risk shown as separate pieces of state so that “high confidence” does not hide high downside risk. | Prevents overtrust in a single number. |

---

### Rich Settlement And Grading

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As a strategist, I want settled artifacts to include drawdown, runup, pending coverage, and direction-aware grading so that I can tell whether a signal was right for the right reasons. | Raw forward return alone is not enough. |
| Draft | As a later lifecycle system, I want settled artifacts to distinguish signal quality from execution quality so that poor fill assumptions do not get mislabeled as poor alpha. | Depends on execution-policy references being logged. |

---

### Rolling Measurement Surfaces

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As an operator, I want rolling 20/50/100-sample views by strategy, regime, and confidence bucket so that I can see whether the system is improving or drifting. | Must stay readable enough for weekly review. |
| Draft | As a model maintainer, I want veto and missed-opportunity summaries so that I can soften or retire logic that blocks too many winners. | Critical for later governance. |

---

### Core Decision Math

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As a quant-minded maintainer, I want the system to use explicit EV, calibration, reward-to-risk, and excursion math so that quality comparisons are precise instead of narrative. | Keep formulas interpretable. |
| Draft | As a future sizing engine, I want calibrated-confidence and expected-drawdown fields available so that later size decisions do not require re-deriving evaluation math. | This workstream defines the substrate, not the final sizing rules. |

---

### Benchmark-Aware Evaluation

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As a skeptical operator, I want strategy evaluation compared with simple baselines so that positive-looking results are not mistaken for real edge. | Must not depend on complex downstream governance to be useful. |

---

## Appendix

### Additional Considerations

- This workstream should prefer additive artifact changes and reusable evaluation helpers over one-off report logic.
- Reporting should stay machine-first and operator-readable second, not the other way around.
- Opportunity-cost reporting should stay honest about counterfactuals and avoid overstating certainty.

### User Research

Recent operator sessions exposed the current limits clearly:
- confidence can be present while calibration is still `STALE`
- empty-scan debugging and performance debugging still require reading raw run artifacts
- the system can state a decision without later being able to grade that decision precisely enough to improve it

### Open Questions

- Which settlement windows should be considered canonical for action-aware grading: 1d, 3d, 5d, 10d, and 20d, or a smaller default set?
- Should benchmark comparisons live in the same artifact family as accuracy summaries or in separate companion artifacts?
- How much of the opportunity-cost logic should stay descriptive first before it influences adaptive weighting?
- Which fields should be mandatory before a prediction is allowed to count toward calibration samples?

### Collaboration Topics

- Later lifecycle workstream will depend on the prediction contract carrying entry-plan and execution references.
- Governance workstream will depend on the measurement outputs from this workstream for promotion and retirement gates.

### Technical Considerations

- Keep the prediction contract versioned and backward-compatible.
- Keep confidence and risk separate everywhere, including reports.
- Avoid adding math that sounds sophisticated but does not change decisions or evaluation quality.
