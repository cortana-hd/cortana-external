# Product Requirements Document (PRD) - Backtester V2 Signal Intelligence And Operator Trust

**Document Status:** Complete

## Team

| Role | Assignee |
|------|----------|
| Primary Owner | @hameldesai |
| Epic | BT-V2 Signal Intelligence And Operator Trust |

---

## Problem / Opportunity

The current backtester has enough moving parts to generate predictions, surface strategy outputs, and support operator review, but it still stops short of being a system the operator can trust as a money-making decision engine. Signals can look plausible without being strongly calibrated, validation can be too broad or too stale to answer whether the edge is real now, and operator surfaces still leave too much room for interpretation when the user is trying to decide whether the system is actually working.

The opportunity for V2 is to narrow the focus and make the system more decision-intelligent before making it more autonomous. V2 should improve the quality of `BUY`, `WATCH`, and `NO_BUY`; make those decisions measurable over the 1-5 trading day swing horizon that matters most; and expose enough regime-aware evidence that the operator can tell the difference between:
- real edge and lucky recent performance
- good signal quality and poor execution assumptions
- temporary drift and genuine system failure

This initiative is intentionally optimized for three outcomes at once:
- money-making now
- research credibility
- operator trust and visibility

---

## Insights

- Better market representation matters more than adding complexity blindly. V2 should get more disciplined about features, regimes, and relative comparisons before adding another exotic model layer.
- Accuracy alone is not enough. The operator needs evidence that the system makes money with controlled drawdowns and remains useful across different market regimes.
- Trust comes from clean feedback loops. If the system cannot explain why it likes a setup, how often similar setups worked, and when the logic is drifting, the operator should not have to infer trust from vibes.

Problems this initiative is not intending to solve in phase 1:
- fully autonomous capital deployment
- a broad alternative-data platform
- intraday or same-minute trading optimization
- a large multi-strategy router with many simultaneous new strategy families
- replacing the current backtester with an opaque end-to-end black box

---

## Development Overview

Backtester V2 will make the current system more data-driven by strengthening the signal engine, the validation layer, and the operator-facing truth surface together. The system will continue to support the existing strategy surfaces, but phase 1 will focus on making those outputs more trustworthy while adding one new experimental strategy family: regime-aware momentum and relative-strength ranking.

The implementation direction is:
- use a stronger core feature set built from price, volume, trend, breadth, realized volatility, relative strength, technical transforms, and regime labels
- optimize and evaluate primarily for the 1-5 trading day swing horizon
- separate signal quality from lifecycle and execution quality so the research loop stays honest
- evaluate ideas with time-aware, regime-aware, and benchmark-aware validation before trusting them
- improve operator surfaces so the user can see not just the latest answer, but whether that answer currently deserves trust

V2 should remain decision-intelligent rather than fully autonomous. The output of the system should be better ranked ideas, confidence that can be measured, regime-aware sizing guidance, and paper-trade or lifecycle visibility. It should not silently take production capital risk without additional governance.

This Development Overview should remain in sync with the matching Tech Spec if one is created later.

---

## Success Metrics

Primary success metrics for V2:
- Profit factor improves at the strategy and aggregate level on the canonical 1-5 day swing horizon compared with the current incumbent logic and simple baselines.
- Maximum drawdown is reduced or held materially flatter while preserving useful opportunity capture.
- Regime robustness improves, meaning strategy performance no longer collapses completely outside one narrow market condition and the system can explain where it is weak.

Supporting success signals:
- confidence buckets become calibrated enough that higher-confidence recommendations consistently outperform lower-confidence recommendations
- operator dashboards can distinguish fresh, warming, degraded, and stale states without implying false failure during normal startup or lag windows
- every promoted or trusted strategy path has reproducible walk-forward and benchmark-aware evidence
- the operator can answer, from machine artifacts instead of memory, whether the system is healthy, whether the signal engine is working, and which strategies currently deserve trust

---

## Assumptions

- The primary operating horizon for V2 is 1-5 trading days rather than intraday execution or very long-horizon investing.
- Existing strategies remain in place and are improved first; V2 does not require deleting current strategy logic to move forward.
- One new strategy family is enough for phase 1, provided the system gains a much better evaluation and comparison framework.
- The must-have data core for V2 is limited to price, volume, trend, breadth, realized volatility, relative strength, technical transforms, and regime labels.
- Macro and event overlays may help later, but they are not required to unlock a credible V2 signal engine.
- Fundamentals, alternative data, and large sentiment pipelines are not phase 1 dependencies unless a clean point-in-time historical source already exists.
- Paper-trade and lifecycle review remain valid first proving grounds before any stronger automation boundary is considered.

---

## Out of Scope

- fully autonomous live trading
- intraday market-making or sub-day prediction optimization
- large-scale fundamentals ingestion as a blocking dependency
- sentiment scraping and alternative-data experimentation as core phase 1 scope
- a many-strategy portfolio optimizer with dynamic capital competition across a wide strategy set
- unconstrained LLM-driven strategy invention without benchmark and validation discipline

---

## High Level Requirements

| Requirement | Description | Notes |
|-------------|-------------|-------|
| [Signal quality first](#signal-quality-first) | V2 must improve the trustworthiness of `BUY`, `WATCH`, and `NO_BUY` before broadening autonomy. | Decision quality is the primary job. |
| [Feature and regime upgrade](#feature-and-regime-upgrade) | V2 must use a stronger market representation built from the approved core data set and regime labels. | Avoids complexity theater. |
| [One new strategy family](#one-new-strategy-family) | V2 phase 1 must add only one experimental family: regime-aware momentum and relative-strength ranking. | Mean reversion remains a later expansion candidate. |
| [Validation and governance discipline](#validation-and-governance-discipline) | Every serious improvement must be benchmark-aware, walk-forward, and regime-aware. | Research credibility is a product requirement. |
| [Operator-visible trust surface](#operator-visible-trust-surface) | The operator must be able to see whether the system is fresh, believable, and currently working. | Trust requires visibility, not just models. |
| [Decision-intelligent boundary](#decision-intelligent-boundary) | V2 must remain recommendation-first rather than silently autonomous with capital. | Strong guidance, not unchecked autonomy. |

---

## Detailed User Stories

### Glossary

| Term | Meaning |
|------|---------|
| Canonical horizon | The default evaluation window for V2, set to 1-5 trading days. |
| Regime label | A market-state tag used to segment and condition evaluation or strategy behavior. |
| Relative-strength ranking | A strategy approach that compares candidates against peers or benchmarks to find stronger leaders. |
| Operator trust surface | The set of reports and UI states that explain whether the system is healthy and believable right now. |
| Decision-intelligent | A system that produces evidence-backed recommendations and guidance without taking unchecked autonomous action. |

---

### Signal Quality First

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As an operator, I want `BUY`, `WATCH`, and `NO_BUY` to reflect measured edge on the 1-5 day horizon so that I can use the system to make decisions now. | Primary V2 outcome. |
| Draft | As a maintainer, I want signal quality measured separately from lifecycle and execution quality so that weak paper-trade handling does not hide genuine alpha. | Keeps diagnosis honest. |
| Draft | As a reviewer, I want confidence to map to observed outcome quality so that trust increases only when the data supports it. | Calibration is supporting scope. |

---

### Feature And Regime Upgrade

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As a strategist, I want the model inputs to include price, volume, trend, breadth, realized volatility, relative strength, technical transforms, and regime labels so that the system reasons over real market structure instead of sparse heuristics. | Core V2 feature set. |
| Draft | As a researcher, I want performance segmented by regime so that I can tell whether a strategy truly generalizes or only works in one market environment. | Required for robustness. |

---

### One New Strategy Family

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As a product owner, I want V2 to add one new experimental strategy family focused on regime-aware momentum and relative strength so that we widen opportunity capture without exploding scope. | Chosen phase 1 expansion. |
| Draft | As a maintainer, I want current strategy families to remain first-class incumbents so that new work can be benchmarked against known behavior instead of replacing everything at once. | Stability over churn. |
| Draft | As a future planner, I want mean reversion and volatility-filtered dip-buy ideas documented as next candidates rather than phase 1 deliverables. | Keeps roadmap visible. |

---

### Validation And Governance Discipline

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As a skeptical operator, I want each strategy improvement evaluated against simple baselines, walk-forward splits, and regime segments so that I do not mistake recent luck for durable edge. | Non-negotiable trust requirement. |
| Draft | As a governance layer, I want challenger logic to prove itself on comparable windows with reproducible artifacts before it earns more authority. | Promotion must be evidence-backed. |
| Draft | As a researcher, I want profit factor, drawdown, and regime robustness tracked as first-class metrics so that model selection stays aligned with actual trading outcomes. | Chosen success criteria. |

---

### Operator-Visible Trust Surface

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As an operator, I want the dashboards to show whether the system is warming up, fresh, degraded, or stale without flashing false failure during normal startup gaps. | Extends recent Mission Control direction. |
| Draft | As an operator, I want to see which strategies are currently trusted, which are drifting, and which regimes they are weak in so that I can act with context instead of guesswork. | Trust must be visible. |
| Draft | As a maintainer, I want artifacts and UI summaries to answer whether the system is working before I read logs or source files. | Operational leverage. |

---

### Decision-Intelligent Boundary

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As the account owner, I want the system to provide ranked ideas, confidence, and regime-aware sizing guidance without silently deploying real capital risk. | Current autonomy boundary. |
| Draft | As a future roadmap owner, I want lifecycle and sizing logic to remain available for paper-trade review so that autonomy can be expanded later only if signal trust justifies it. | Deferred, not deleted. |

---

## Appendix

### Additional Considerations

- V2 should prefer interpretable feature and evaluation upgrades over opaque model novelty.
- A simpler strategy that survives walk-forward validation is more valuable than a more impressive model that only wins in one slice.
- Startup and synchronization behavior matter to operator trust almost as much as the underlying model quality. If the data is still loading, the UI should say so clearly and neutrally.

### Proposed Phase Sequencing

1. Strengthen the measurement contract and canonical V2 metrics.
2. Upgrade the core feature set and regime labeling pipeline.
3. Improve incumbent strategies against the new validation harness.
4. Add the regime-aware momentum and relative-strength challenger family.
5. Surface trust, drift, and freshness clearly in operator-facing views.
6. Revisit lifecycle and sizing authority only after the signal layer earns it.

### Candidate Strategy Lanes After Phase 1

- volatility-filtered mean reversion and dip-buy refinement
- breakout and expansion-after-contraction setups
- meta-model ranking across strategies once enough clean artifact history exists

### Resolved Decisions

- V2 will use a hierarchical regime taxonomy. The canonical regime model will include:
  - a primary market-posture label
  - a volatility sub-state
  - a breadth sub-state
  The default operator surface should summarize the primary market posture first, while deeper evaluation and trust reports should segment by the richer combined regime state. This keeps the UI readable while preserving enough structure for research credibility.

- V2 will treat a ranked opportunity score as the primary model output and map that score into `BUY`, `WATCH`, and `NO_BUY` as the operator-facing action layer. This gives the system a cleaner optimization target, allows finer calibration and challenger comparison, and preserves the current discrete action surface the operator uses today.

- Trust labels will be gated by minimum sample thresholds instead of being inferred from limited history:
  - challenger strategies can earn `exploratory` status after 30 settled samples
  - challenger strategies can earn `limited trust` after 100 settled samples, provided they beat the benchmark ladder and show acceptable drawdown behavior
  - any strategy can earn `trusted` status only after 250 settled samples with regime coverage across the main posture states and no material walk-forward breakdown
  - incumbent strategies that fall below freshness, regime coverage, or walk-forward robustness standards should be demoted even if they have deep historical sample counts
  These thresholds should be treated as phase-1 defaults and may tighten later once the artifact and governance pipeline matures.

### Collaboration Topics

- Prediction, governance, lifecycle, and Mission Control workstreams should stay aligned so the operator sees one coherent truth surface.
- Future data-source expansion should be held to point-in-time and benchmark-discipline standards before entering core evaluation.

### Technical Considerations

- Keep all evaluation time-aware and point-in-time safe.
- Keep signal quality, execution quality, and operator state as separate concepts.
- Prefer additive, versioned artifact contracts so new strategy families can be compared cleanly with current incumbents.
