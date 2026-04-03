# Implementation Plan - Governance, Validation, And Model Promotion

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Owner(s) | TBD |
| Epic | BT-W5 Governance, Validation, And Model Promotion |
| Tech Spec | [05-governance-validation-and-model-promotion.md](/Users/hd/Developer/cortana-external/backtester/planning/TechSpecs/05-governance-validation-and-model-promotion.md) |
| PRD | [05-governance-validation-and-model-promotion.md](/Users/hd/Developer/cortana-external/backtester/planning/PRDs/05-governance-validation-and-model-promotion.md) |

---

## Dependency Map

| Vertical | Dependencies | Can Start? |
|----------|-------------|------------|
| V1 — Registry and governance contracts | W1-W4 artifacts available | Start Now |
| V2 — Benchmark ladder and comparable-window plumbing | V1 | Start after V1 |
| V3 — Walk-forward and robustness runner | V1, V2 | Start after V1, V2 |
| V4 — Point-in-time and leakage audit layer | V1, V3 | Start after V1, V3 |
| V5 — Promotion, demotion, and challenger evaluators | V2, V3, V4 | Start after V2, V3, V4 |
| V6 — Operator-facing governance summaries and enforcement hooks | V5 | Start after V5 |

---

## Recommended Execution Order

```text
Week 1: V1
Week 2: V2
Week 3: V3
Week 4: V4
Week 5: V5
Week 6: V6 + compare-only rollout
```

---

## Sprint 1 — Registry And Comparable Baselines

### Vertical 1 — Registry And Governance Contracts

**backtester: create the experiment registry and governance artifact family**

*Dependencies: W1-W4 artifacts available*

#### Jira

- [x] Sub-task 1: Create governance registry helpers and stable artifact contracts for experiments, walk-forward results, benchmark results, and governance decisions.
- [x] Sub-task 2: Add registry configs for benchmark ladders, promotion gates, demotion rules, and explicit activation status.
- [x] Sub-task 3: Add explicit incumbent/challenger status transitions with audit fields.

#### Testing

- Registry lifecycle transitions are deterministic.
- Duplicate or malformed experiment keys fail fast.
- Governance artifacts preserve schema version and lineage.

---

### Vertical 2 — Benchmark Ladder And Comparable-Window Plumbing

**backtester: ensure all candidates are compared against simple baselines on equal footing**

*Dependencies: V1*

#### Jira

- [x] Sub-task 1: Implement benchmark runners for the agreed null-model ladder.
- [x] Sub-task 2: Guarantee that benchmark and candidate evaluations share identical windows, fill assumptions, and point-in-time inputs.
- [x] Sub-task 3: Persist benchmark outputs in a machine-readable format consumable by promotion gates.

#### Testing

- Benchmark comparisons use identical comparison windows.
- Assumption mismatches are detected and rejected.
- Baseline outputs stay stable across replay runs.

---

## Sprint 2 — Scientific Validity Checks

### Vertical 3 — Walk-Forward And Robustness Runner

**backtester: build the anti-overfitting engine**

*Dependencies: V1, V2*

#### Jira

- [x] Sub-task 1: Implement rolling train/validation/out-of-sample window execution.
- [x] Sub-task 2: Add parameter stability, regime-segment, hold-window, and worse-fill sensitivity summaries.
- [x] Sub-task 3: Emit a `walk_forward_summary` artifact family suitable for later gate evaluation.

#### Important Planning Notes

- Robustness must matter more than single-window peak performance.
- Small sample, single-regime, or single-event wins should be called out explicitly.

#### Testing

- Walk-forward outputs cover all required slices.
- Stress summaries remain deterministic.
- Fragile parameter sets are visible in artifacts.

---

### Vertical 4 — Point-In-Time And Leakage Audit Layer

**backtester: block non-causal or suspicious evaluation results from promotion**

*Dependencies: V1, V3*

#### Jira

- [x] Sub-task 1: Implement audits for `known_at` ordering, source provenance integrity, and live-vs-cache mixing.
- [x] Sub-task 2: Add survivorship, universe-membership, and corporate-actions audit hooks where the current dataset permits it.
- [x] Sub-task 3: Emit explicit pass/fail summaries that later gates can consume deterministically.

#### Testing

- Suspected leakage blocks promotion.
- Timestamp-order and provenance failures are visible and machine-readable.
- Point-in-time audit outputs survive replay and schema changes.

---

## Sprint 3 — Authority Changes

### Vertical 5 — Promotion, Demotion, And Challenger Evaluators

**backtester: convert evidence into bounded authority decisions**

*Dependencies: V2, V3, V4*

#### Jira

- [x] Sub-task 1: Implement gate evaluators for promotion and demotion using explicit thresholds and artifact inputs.
- [x] Sub-task 2: Add challenger lifecycle logic so candidates can move through shadow, challenger, incumbent, retired, or blocked states.
- [x] Sub-task 3: Ensure degraded-input evaluations, tiny-sample streaks, or one-regime wins cannot pass promotion silently.

#### Testing

- Promotion requires all declared gates.
- Demotion rules can trigger without deleting historical lineage.
- Challenger lifecycle transitions remain audit-safe.

---

### Vertical 6 — Governance Summaries And Enforcement Hooks

**backtester + future surfaces: expose governance outcomes safely**

*Dependencies: V5*

#### Jira

- [x] Sub-task 1: Add operator-facing governance summaries that explain current trust tiers and recent authority changes.
- [x] Sub-task 2: Add status-based activation hooks so compare-only mode can later evolve into enforcement.
- [x] Sub-task 3: Ensure demoted or retired logic no longer appears as incumbent in downstream artifacts.

#### Testing

- Operator summaries match governance artifacts exactly.
- Compare-only mode is distinguishable from enforcement mode.
- Retired logic cannot leak into active incumbency fields.

---

## Dependency Notes

### V1 before all later verticals

Nothing in governance is safe without explicit registry identities and artifact schemas.

### V2 and V3 before V5

Promotion and demotion decisions depend on comparable benchmarks and robust walk-forward evidence.

### V4 before V5

Leakage and point-in-time checks must be blockers, not after-the-fact annotations.

---

## Scope Boundaries

### In Scope (This Plan)

- experiment registry
- benchmark ladder
- walk-forward and robustness
- point-in-time and leakage audits
- promotion, demotion, and challenger lifecycle
- governance summaries and enforcement hooks

### External Dependencies

- W2 measurement depth
- W3 lifecycle realism
- W4 adaptive-state artifacts

### Integration Points

- `backtester/evaluation/*`
- future `backtester/governance/*`
- any downstream surface that needs trust-tier summaries

---

## Realistic Delivery Notes

- **Biggest risks:** governance that is too complex to operate; compare windows that are not truly comparable; under-specified demotion logic; missing audit coverage for future data-integrity issues.
- **Assumptions:** compare-only rollout is acceptable first; current replay corpus is good enough to build initial governance plumbing; later stricter gates can be layered without rewriting the registry.

## Update On Every Commit

Each implementation PR under this workstream should update this plan with:
- new registry/config artifacts added
- new benchmark or walk-forward outputs added
- gate changes or threshold changes
- compare-only vs enforcement status
- blocked audit or data-integrity dependencies
