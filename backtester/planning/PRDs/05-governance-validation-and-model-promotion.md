# Product Requirements Document (PRD) - Governance, Validation, And Model Promotion

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Primary Owner | TBD |
| Epic | BT-W5 Governance, Validation, And Model Promotion |

---

## Problem / Opportunity

As the backtester becomes more capable, the risk shifts from “the system is too simple” to “the system is too easy to improve in the wrong way.” New strategies, overlays, thresholds, vetoes, weights, and research features can all appear promising in a narrow window while still being fragile, overfit, benchmark-weak, or causally invalid.

The opportunity is to create a disciplined governance layer that decides what deserves trust. This workstream provides the anti-overfitting, promotion, demotion, and audit machinery required to keep the system scientifically honest as it grows.

Without this workstream:
- good ideas and lucky ideas can be confused
- challenger logic can linger forever without a promotion path
- stale logic can keep authority longer than it deserves
- backtests can look better than live behavior because of leakage, weak benchmarks, or unrealistic assumptions

---

## Insights

- Governance is not a “later QA pass.” It is a product requirement because it determines what the operator should trust.
- Promotion must be evidence-backed, but demotion must be equally explicit. Bulletproof systems do not only promote; they also retire.
- Point-in-time integrity, benchmark comparison, walk-forward testing, and robustness under worse assumptions are more important than adding another clever overlay.

Problems this workstream is not intending to solve:
- inventing new alpha by itself
- broker execution
- operator-facing runtime operations and retention policy details beyond the governance artifacts they need
- replacing the main roadmap with a pure research lab

---

## Development Overview

This workstream introduces the experiment registry and model-governance layer that controls how new ideas move from “interesting” to “trusted.” It includes walk-forward validation, benchmark and null-model comparisons, robustness sweeps, leakage and point-in-time guardrails, promotion gates, demotion rules, and challenger lifecycle tracking.

The result should be a system that can answer:
- what is the incumbent and what is the challenger
- whether the challenger is truly better out of sample
- whether the result survives modestly worse fill assumptions
- whether the model is causally valid and point-in-time safe
- whether current production logic should be demoted, softened, or retired

This Development Overview must stay in sync with the matching Tech Spec.

---

## Success Metrics

- Every strategy, overlay, veto, and major weighting rule has an explicit experiment registry entry and versioned evaluation artifact set.
- No strategy or overlay can be promoted without:
  - out-of-sample evidence
  - benchmark outperformance
  - minimum sample depth
  - calibration quality
  - robustness under worse-fill assumptions
  - leakage and point-in-time checks
- Demotion and retirement rules exist and can be audited from artifacts.
- Walk-forward outputs and benchmark ladders are reproducible from replayable inputs.
- Operators can see whether current trust tiers are supported by evidence rather than hand-tuned intuition.

---

## Assumptions

- W1-W4 have already produced stable machine contracts, measurement outputs, lifecycle artifacts, and decision-state artifacts.
- Governance should initially be compare-only / advisory before it becomes enforcement where appropriate.
- Promotion and demotion remain deterministic and artifact-backed, not operator-vibe-driven.
- Governance artifacts can live locally and/or in Postgres; no new distributed infra is required.
- Simple baselines are required even if more sophisticated comparisons are added later.

---

## Out of Scope

- replacing all current logic with automated hyperparameter search
- free-form LLM strategy selection
- live capital deployment by governance jobs
- infinite experiment complexity without bounded registries and review rules

---

## High Level Requirements

| Requirement | Description | Notes |
|-------------|-------------|-------|
| Experiment registry | Every strategy, overlay, and significant decision-path change must have a registered identity, owner, status, and evaluation lineage. | No shadow logic. |
| Walk-forward and robustness evaluation | New logic must prove itself out of sample and under modestly worse assumptions. | Anti-overfitting core. |
| Benchmark and null-model ladder | Every promoted edge must beat simple baselines on equal footing. | Prevents complexity theater. |
| Point-in-time and leakage guardrails | No promotion if causal order, universe membership, or source integrity is suspect. | Hard blocker, not a warning. |
| Promotion, demotion, and challenger lifecycle | Authority changes must be explicit, auditable, and reversible. | Includes retirement rules. |

---

## Detailed User Stories

### Glossary

| Term | Meaning |
|------|---------|
| Challenger | A new candidate strategy, overlay, or weighting rule being compared against the incumbent. |
| Promotion gate | Explicit threshold set a candidate must clear to earn more authority. |
| Demotion rule | Explicit threshold or failure mode that reduces or removes authority from current logic. |
| Walk-forward | Rolling train/validation/out-of-sample evaluation process designed to reduce overfitting. |
| Leakage check | Validation that no future or non-causal information influenced an evaluation result. |

---

### Experiment Registry

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As a maintainer, I want every strategy, overlay, veto, and major rule change registered with identity, owner, status, and artifact lineage so that no production logic exists without an audit trail. | Core governance prerequisite. |
| Draft | As an operator, I want to know which logic is incumbent, which is challenger, and what evidence supports current authority. | Prevents invisible drift. |

---

### Walk-Forward And Robustness Evaluation

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As a quantitative reviewer, I want rolling out-of-sample, regime-segment, and degraded-fill results so that a good-looking window does not masquerade as a durable edge. | Must be first-class scope. |
| Draft | As a skeptic, I want parameter stability and worse-fill stress tests so that fragile parameter sets do not get promoted. | Robustness matters more than peak in-sample results. |

---

### Benchmark And Null-Model Ladder

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As a decision owner, I want every candidate compared against simple baselines so that complexity only earns authority if it beats simpler alternatives fairly. | Equal data windows and assumptions required. |

---

### Point-In-Time And Leakage Guardrails

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As a governance system, I want causal timestamps, universe membership rules, and source-integrity checks enforced so that backtests reflect what was knowable at decision time. | Non-negotiable. |
| Draft | As a reviewer, I want leakage checks to block promotion instead of merely being listed as warnings. | Governance must be hard here. |

---

### Promotion, Demotion, And Challenger Lifecycle

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As an operator, I want promotion and demotion decisions written as machine-readable artifacts with pass/fail reasons so that trust-tier changes are transparent. | No silent authority changes. |
| Draft | As a platform maintainer, I want challenger lifecycle handling so that candidates do not stay indefinitely in limbo or leak into production accidentally. | Includes retirement and archival. |

---

## Appendix

### Additional Considerations

- Governance should start compare-only and become enforcement only after the artifacts and thresholds stabilize.
- Minimum sample counts, smoothing, and regime coverage must matter as much as headline outcome quality.
- Promotion based on degraded or non-comparable input quality is a failure mode, not a corner case.

### User Research

The need for this workstream is implicit in the operator’s push for a “bulletproof” system:
- confidence must mean something
- overfitting must be controlled
- benchmark-free wins are not enough
- future strategies and overlays need a disciplined path into production

### Open Questions

- Which benchmark ladder is mandatory in the first version versus optional later?
- How strict should the first promotion gates be before enough live history exists?
- Should demotion be advisory first or can some rules disable authority automatically?
- Which artifact families should be kept indefinitely for governance audit versus rotated later?

### Collaboration Topics

- W2 measurement outputs are a core dependency.
- W3 lifecycle realism outputs are required for honest governance.
- W4 decision-state and adaptive-weight artifacts must be comparable across versions.
- W6 operator surfaces will need to present governance status cleanly.

### Technical Considerations

- Keep the governance engine deterministic.
- Require identical evaluation windows, fill assumptions, and point-in-time discipline across incumbent vs challenger comparisons.
- Do not allow manual emergency overrides to bypass audit trails.
