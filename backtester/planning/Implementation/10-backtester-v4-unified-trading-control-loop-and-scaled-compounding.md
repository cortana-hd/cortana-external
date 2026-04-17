# Implementation Plan - Backtester V4 Unified Trading Control Loop And Scaled Compounding

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Owner(s) | @hameldesai |
| Epic | BT-V4 Unified Trading Control Loop And Scaled Compounding |
| Tech Spec | [10-backtester-v4-unified-trading-control-loop-and-scaled-compounding.md](../TechSpecs/10-backtester-v4-unified-trading-control-loop-and-scaled-compounding.md) |
| PRD | [10-backtester-v4-unified-trading-control-loop-and-scaled-compounding.md](../PRDs/10-backtester-v4-unified-trading-control-loop-and-scaled-compounding.md) |

---

## Dependency Map

| Vertical | Dependencies | Can Start? |
|----------|-------------|------------|
| V1 — Desired-state / actual-state contracts | V2/V3 posture and authority outputs | Start after V3 |
| V2 — Reconciliation engine and intervention events | V1 | Start after V1 |
| V3 — Release-unit packaging and rollout state | V1 | Start after V1 |
| V4 — Drift monitoring and control-loop health | V1, V3 | Start after V1, V3 |
| V5 — Mission Control control tower | V1, V2, V3, V4 | Start after V1, V2, V3, V4 |
| V6 — Replay, rollback, and control-loop drills | V2, V3, V4, V5 | Start after V2, V3, V4, V5 |

---

## Recommended Execution Order

```text
Week 1: V1
Week 2: V2 + V3
Week 3: V4
Week 4: V5
Week 5: V6
```

---

## Sprint 1 — State Contracts

### Vertical 1 — Desired-State / Actual-State Contracts

**cortana-external backtester + Mission Control: define the core control-loop truth model**

*Dependencies: V2/V3 posture and authority outputs*

#### Jira

- [ ] Sub-task 1: Add `backtester/control_loop/desired_state.py` and `backtester/control_loop/actual_state.py`.
- [ ] Sub-task 2: Emit `trading_desired_state_snapshots_v1` and `trading_actual_state_snapshots_v1`.
- [ ] Sub-task 3: Update Mission Control loaders to distinguish desired state from actual state instead of flattening them into one summary.

#### Testing

- Desired and actual state can be serialized independently.
- Actual state preserves runtime freshness and provenance.
- Missing desired state fails loudly rather than forcing implicit inference.

---

## Sprint 2 — Reconciliation And Releases

### Vertical 2 — Reconciliation Engine And Intervention Events

**cortana-external backtester: make posture and authority gap-closing explicit**

*Dependencies: V1*

#### Jira

- [ ] Sub-task 1: Add `backtester/control_loop/reconciler.py` and `backtester/control_loop/interventions.py`.
- [ ] Sub-task 2: Emit `trading_reconciliation_actions_v1` for proposed and applied actions.
- [ ] Sub-task 3: Record kill switches, pauses, resumes, rollout holds, and override acknowledgments as `trading_intervention_events_v1`.

#### Testing

- Reconciliation diffs are deterministic and idempotent.
- Illegal or unsafe actions are blocked by policy.
- Intervention events remain replayable and auditable.

---

### Vertical 3 — Release Units And Rollout State

**cortana-external backtester + Mission Control: ship strategy/model changes as real release units**

*Dependencies: V1*

#### Jira

- [ ] Sub-task 1: Add `backtester/release/release_units.py` and persist `trading_release_units_v1`.
- [ ] Sub-task 2: Define canary, shadow, staged, and rollback-ready fields for release units.
- [ ] Sub-task 3: Surface release-unit health in Mission Control and tie it to authority/rollout policy.

#### Testing

- Release bundles fail validation when code/config/model refs are incomplete.
- Canary and rollback state transitions are explicit.
- Release-unit regressions can hold rollout without corrupting live posture state.

---

## Sprint 3 — Drift And Health

### Vertical 4 — Drift Monitoring And Control-Loop Health

**cortana-external backtester: detect degradation before it becomes trading damage**

*Dependencies: V1, V3*

#### Jira

- [ ] Sub-task 1: Add `backtester/release/drift_monitor.py` for data, prediction, and rollout drift checks.
- [ ] Sub-task 2: Correlate runtime health, drift, and release state into actual-state artifacts.
- [ ] Sub-task 3: Add policy hooks that reduce authority or hold rollout under material drift.

#### Important Planning Notes

- Drift checks should reduce authority before they try to explain everything perfectly.
- Runtime-health degradation and model-quality degradation should remain separate but correlated signals.

#### Testing

- Drift conditions produce explicit warnings and policy outcomes.
- Authority reductions triggered by drift are replayable.
- Rollout holds do not silently disappear on refresh.

---

## Sprint 4 — Operator Control Tower

### Vertical 5 — Mission Control Control Tower

**cortana-external Mission Control: unify posture, release, drift, and intervention in one operator surface**

*Dependencies: V1, V2, V3, V4*

#### Jira

- [ ] Sub-task 1: Update `apps/mission-control/lib/trading-ops.ts`, `apps/mission-control/lib/trading-ops-contract.ts`, and related loaders for desired/actual/reconciliation state.
- [ ] Sub-task 2: Update `apps/mission-control/components/trading-ops-dashboard.tsx` with control-tower panels for posture, release, drift, and interventions.
- [ ] Sub-task 3: Add clear operator wording and action surfaces for rollout holds, pauses, and authority reductions.

#### Testing

- Desired vs actual state is visible and not conflated.
- Release, drift, and intervention panels reflect stored artifacts accurately.
- Control-tower refresh preserves provenance and freshness semantics.

---

## Sprint 5 — Drills And Long-Run Confidence

### Vertical 6 — Replay, Rollback, And Control-Loop Drills

**cortana-external backtester + Mission Control: prove the control loop behaves safely under stress**

*Dependencies: V2, V3, V4, V5*

#### Jira

- [ ] Sub-task 1: Add replay fixtures for desired/actual/reconciliation state transitions.
- [ ] Sub-task 2: Add rollback drills for release units and intervention-event clearing.
- [ ] Sub-task 3: Extend smoke checks and QA runbooks to cover the new control-loop surface.

#### Testing

- Repeated reconciliation cycles converge instead of duplicating actions.
- Release rollback restores a coherent desired/actual state pair.
- Operator drills can reproduce pause, hold, and resume paths end-to-end.

---

## Dependency Notes

### V1 before everything else

The control loop cannot exist without distinct desired-state and actual-state contracts.

### V2/V3 before V5/V6

Mission Control should read real reconciliation and release-unit artifacts, not placeholder summaries.

---

## Scope Boundaries

### In Scope (This Plan)

- desired-state and actual-state artifacts
- reconciliation logic
- intervention event tracking
- release-unit packaging and rollout state
- drift monitoring tied to authority and rollout policy
- Mission Control control tower
- replay and rollback drills

### External Dependencies

- V2/V3 posture, authority, and budget outputs
- existing Mission Control Trading Ops infrastructure

### Integration Points

- `backtester/operator_surfaces/mission_control.py`
- `backtester/runtime_health_snapshot.py`
- `backtester/runtime_inventory_snapshot.py`
- `backtester/governance/gates.py`
- `backtester/lifecycle/paper_portfolio.py`
- `apps/mission-control/lib/trading-ops-contract.ts`
- `apps/mission-control/components/trading-ops-dashboard.tsx`
- `apps/mission-control/scripts/check-trading-ops-smoke.ts`

---

## Realistic Delivery Notes

- **Biggest risks:** blending desired and actual state back together, over-automating reconciliation before the artifacts are trusted, and underbuilding rollback discipline.
- **Assumptions:** Mission Control remains the control tower; V3 posture and authority artifacts are already stable enough to feed the control loop; the first V4 rollout remains operator-commanded even if more actions become automated later.
