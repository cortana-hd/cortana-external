# QA Plan - Backtester V4 Unified Trading Control Loop And Scaled Compounding

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Owner(s) | @hameldesai |
| Epic | BT-V4 Unified Trading Control Loop And Scaled Compounding |
| PRD | [10-backtester-v4-unified-trading-control-loop-and-scaled-compounding.md](../PRDs/10-backtester-v4-unified-trading-control-loop-and-scaled-compounding.md) |
| Tech Spec | [10-backtester-v4-unified-trading-control-loop-and-scaled-compounding.md](../TechSpecs/10-backtester-v4-unified-trading-control-loop-and-scaled-compounding.md) |
| Implementation Plan | [10-backtester-v4-unified-trading-control-loop-and-scaled-compounding.md](../Implementation/10-backtester-v4-unified-trading-control-loop-and-scaled-compounding.md) |

---

## QA Goal

Verify that V4 turns the product into a coherent trading control loop without:

- conflating desired state with actual state
- letting reconciliation actions duplicate, drift, or become opaque
- shipping strategy/model/policy changes without canary and rollback discipline
- allowing drift or runtime degradation to compound into silent trading damage

This QA plan is meant to prove four things:

1. desired-state, actual-state, and reconciliation artifacts are distinct and trustworthy
2. release units and canaries can stop bad changes before they spread
3. interventions and rollback paths are explicit and boring to execute
4. Mission Control can function as a real control tower for posture, release, drift, and intervention

---

## Scope

In scope:

- desired-state and actual-state contracts
- reconciliation actions and intervention events
- release-unit packaging, canarying, and rollback state
- drift and rollout health monitoring
- Mission Control control-tower surfaces

Out of scope:

- HFT or low-latency execution infrastructure
- fully unattended strong-autonomy operation
- consumer-grade productization or broad multi-tenant rollout

---

## QA Matrix

| Area | Scenario | Expected Result |
|------|----------|-----------------|
| Desired vs actual | Target posture differs from current posture | Gap is visible and not flattened into a single summary. |
| Reconciliation | Same diff evaluated repeatedly | Proposed or applied actions remain idempotent and do not duplicate side effects. |
| Intervention | Manual pause or kill-switch event | Event is recorded, visible, and survives refresh/replay. |
| Release unit | Incomplete release bundle | Release is rejected before canary or rollout begins. |
| Canary | Canary detects degradation | Rollout holds or rolls back before broader authority expands. |
| Drift | Model/data/runtime drift detected | Drift is visible and can reduce authority or hold rollout. |
| Rollback | Release rollback executed | Desired and actual state return to a coherent prior state. |
| Mission Control | Control-tower view load | UI shows desired posture, actual posture, release state, drift, and interventions together. |
| Mission Control | Stale or degraded source | Source ownership and fallback are explicit rather than silently mixed. |
| Control loop | Operator acknowledges or clears an intervention | Acknowledgment path is visible and auditable. |

---

## Required Automated Coverage

Add or update tests around these areas when implementation starts:

- desired-state and actual-state serialization
- reconciliation diffing and idempotence
- intervention-event persistence
- release-unit validation and canary state transitions
- drift-triggered authority reduction or rollout hold
- Mission Control control-tower rendering

Suggested test cases:

- repeated reconciliation on the same diff does not duplicate actions
- invalid release unit cannot enter canary
- canary degradation produces rollout hold or rollback state
- drift condition produces a visible policy outcome
- Mission Control shows desired vs actual state without conflation

---

## Manual / Live Validation

### Scenario 1 - Clean Canary Release

Setup:

- package a valid release unit
- enable canary or shadow rollout mode

Checks:

- inspect release-unit state
- inspect Mission Control rollout and posture view

Success:

- the release moves through canary with explicit health and provenance

---

### Scenario 2 - Drift Or Runtime Degradation

Setup:

- simulate or replay a rollout where drift or runtime health degrades materially

Checks:

- inspect actual-state drift and runtime fields
- inspect reconciliation actions and rollout state

Success:

- authority reduces or rollout holds before the issue becomes silent damage

---

### Scenario 3 - Rollback Drill

Setup:

- trigger a release rollback after a bad canary or held rollout

Checks:

- inspect release-unit rollback state
- compare desired and actual state before and after rollback
- inspect intervention-event history

Success:

- rollback returns the system to a coherent and operator-readable state

---

### Scenario 4 - Control Tower Cross-Check

Setup:

- open Mission Control with a non-trivial mix of posture, release, and intervention state

Checks:

- compare desired-state, actual-state, and reconciliation artifacts against the UI
- refresh and replay the same view

Success:

- Mission Control acts as a control tower rather than a prose-only summary layer

---

## Acceptance Criteria

The V4 release is QA-complete when all of the following are true:

- `100%` of reviewed control-loop states preserve a distinct desired-state, actual-state, and reconciliation record
- repeated reconciliation on the same state produces `0` duplicate side effects in validated replay drills
- `100%` of canary or rollout-hold test cases show explicit release-unit and intervention provenance
- `100%` of reviewed Mission Control control-tower panels match stored posture, release, drift, and intervention artifacts
- drift or runtime degradation produces at least one validated authority-reduction or rollout-hold path before broad rollout

---

## Release Risks To Watch

- desired and actual state could collapse back into one summary if UI or loaders optimize for convenience
- reconciliation may become unsafe if actions are not idempotent
- release discipline can look complete on paper while still lacking realistic rollback drills
- drift detection may be visible but operationally toothless if policy hooks are not enforced

---

## Sign-Off Checklist

- [ ] Desired-state and actual-state contracts verified
- [ ] Reconciliation idempotence verified
- [ ] Intervention-event recording verified
- [ ] Release-unit canary and rollback path verified
- [ ] Drift-triggered hold or authority-reduction path verified
- [ ] Mission Control control-tower truth verified
