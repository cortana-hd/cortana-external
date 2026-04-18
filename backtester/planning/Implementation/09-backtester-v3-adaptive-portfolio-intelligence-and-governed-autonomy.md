# Implementation Plan - Backtester V3 Adaptive Portfolio Intelligence And Governed Autonomy

**Document Status:** Complete

## Team

| Role | Assignee |
|------|----------|
| Owner(s) | @hameldesai |
| Epic | BT-V3 Adaptive Portfolio Intelligence And Governed Autonomy |
| Tech Spec | [09-backtester-v3-adaptive-portfolio-intelligence-and-governed-autonomy.md](../TechSpecs/09-backtester-v3-adaptive-portfolio-intelligence-and-governed-autonomy.md) |
| PRD | [09-backtester-v3-adaptive-portfolio-intelligence-and-governed-autonomy.md](../PRDs/09-backtester-v3-adaptive-portfolio-intelligence-and-governed-autonomy.md) |

---

## Dependency Map

| Vertical | Dependencies | Can Start? |
|----------|-------------|------------|
| V1 — Strategy authority and trust contracts | V2 score/trust outputs | Start after V2 |
| V2 — Two-stage capital-allocation engine | V1 | Start after V1 |
| V3 — Risk-budget and portfolio-posture synthesis | V1, V2 | Start after V1, V2 |
| V4 — Supervised-live gates and approval artifacts | V1, V3 | Start after V1, V3 |
| V5 — Mission Control portfolio and autonomy surface | V3, V4 | Start after V3, V4 |

---

## Recommended Execution Order

```text
Week 1: V1
Week 2: V2
Week 3: V3
Week 4: V4
Week 5: V5 + supervised-live replay review
```

---

## Sprint 1 — Authority Substrate

### Vertical 1 — Strategy Authority And Trust Contracts

**cortana-external backtester: promote governance evidence into authority-ready contracts**

*Dependencies: V2 score/trust outputs*

#### Jira

- [x] Sub-task 1: Add `backtester/governance/authority.py` and `backtester/governance/autonomy_tiers.py`.
- [x] Sub-task 2: Extend `backtester/governance/registry.py`, `backtester/governance/challengers.py`, and `backtester/governance/gates.py` to emit `strategy_authority_tiers_v1`.
- [x] Sub-task 3: Persist authority decisions with benchmark, drawdown, regime, and operator-rationale fields.

#### Testing

- Authority-tier promotion and demotion rules serialize deterministically.
- Missing evidence blocks escalation.
- Demotions are explicit and replayable.

---

## Sprint 2 — Capital Competition

### Vertical 2 — Two-Stage Capital Allocation

**cortana-external backtester: allocate first by strategy family, then by candidate**

*Dependencies: V1*

#### Jira

- [x] Sub-task 1: Add `backtester/portfolio/allocator.py` for stage-1 family budgeting and stage-2 candidate ranking.
- [x] Sub-task 2: Update `backtester/advisor.py` to consume family budgets before producing final candidate ordering.
- [x] Sub-task 3: Carry authority and budget metadata through `backtester/lifecycle/trade_objects.py`.

#### Important Planning Notes

- Stage-1 family budgets are a safety boundary, not just a ranking convenience.
- Portfolio-fit rejections must stay distinct from raw signal-quality failures.

#### Testing

- Family budgets cap candidate selection as expected.
- Good candidates can be rejected for portfolio-fit reasons without corrupting strategy metrics.
- Low-trust families cannot consume the same budget as trusted families.

---

## Sprint 3 — Risk And Posture

### Vertical 3 — Risk-Budget Stack And Portfolio Posture

**cortana-external backtester: formalize drawdown, exposure, size, and concentration control**

*Dependencies: V1, V2*

#### Jira

- [x] Sub-task 1: Add `backtester/portfolio/risk_budget.py` and `backtester/portfolio/posture.py`.
- [x] Sub-task 2: Extend `backtester/lifecycle/paper_portfolio.py` and `backtester/lifecycle/execution_policy.py` with the V3 budget stack.
- [x] Sub-task 3: Emit `portfolio_posture_snapshots_v1` with posture state, overlap summaries, and warnings.

#### Testing

- Drawdown budget can reduce or pause broader authority.
- Gross exposure, per-position size, and concentration caps all trigger independently when exceeded.
- Posture snapshots match underlying allocation math.

---

## Sprint 4 — Autonomy Gates

### Vertical 4 — Supervised-Live Gates And Approval Artifacts

**cortana-external backtester + Mission Control: make stronger autonomy an explicit release gate**

*Dependencies: V1, V3*

#### Jira

- [x] Sub-task 1: Add `supervised_live_review_windows_v1` recording windows, incidents, breaches, and signoff.
- [x] Sub-task 2: Add stronger-autonomy gate checks in `backtester/governance/gates.py`.
- [x] Sub-task 3: Surface approval prerequisites and unresolved blockers in Mission Control loaders.

#### Testing

- Stronger autonomy cannot activate without all required evidence.
- Unresolved incidents or silent fallback behavior block escalation.
- Explicit operator approval is recorded and readable.

---

## Sprint 5 — Operator Surface

### Vertical 5 — Mission Control Portfolio And Autonomy Surface

**cortana-external Mission Control: show posture, budgets, and authority in one coherent view**

*Dependencies: V3, V4*

#### Jira

- [x] Sub-task 1: Update `apps/mission-control/lib/trading-run-state.ts` and `apps/mission-control/lib/trading-ops.ts` to load posture and authority state.
- [x] Sub-task 2: Update `apps/mission-control/components/trading-ops-dashboard.tsx` with strategy-family budgets, posture summaries, and autonomy labels.
- [x] Sub-task 3: Add replay/debug affordances for authority changes, pauses, and supervised-live review windows.

#### Testing

- Mission Control posture matches stored posture artifacts.
- Authority tiers and autonomy modes are human-readable and provenance-backed.
- Pauses, demotions, and approvals remain visible after refresh and replay.

---

## Dependency Notes

### V1 before V2/V4

Authority contracts must exist before allocation and autonomy gating can be trustworthy.

### V3 before V5

Mission Control should show posture derived from the real budget stack, not placeholder math.

---

## Scope Boundaries

### In Scope (This Plan)

- strategy authority tiers
- two-stage allocation
- canonical risk-budget stack
- posture synthesis
- supervised-live review gates
- Mission Control posture and autonomy visibility

### External Dependencies

- V2 signal and trust outputs
- Mission Control contract loaders and UI components in `cortana-external`

### Integration Points

- `backtester/governance/gates.py`
- `backtester/governance/registry.py`
- `backtester/governance/challengers.py`
- `backtester/lifecycle/paper_portfolio.py`
- `backtester/lifecycle/execution_policy.py`
- `backtester/advisor.py`
- `apps/mission-control/lib/trading-run-state.ts`
- `apps/mission-control/components/trading-ops-dashboard.tsx`

---

## Realistic Delivery Notes

- **Biggest risks:** treating posture as a UI summary instead of a real contract, escalating authority too early, and conflating portfolio-fit constraints with strategy failure.
- **Assumptions:** V2 trust outputs are credible enough to drive budget and authority inputs; supervised-live remains the highest active tier in the first rollout.
