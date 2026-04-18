# QA Plan - Backtester V3 Adaptive Portfolio Intelligence And Governed Autonomy

**Document Status:** Complete

## Team

| Role | Assignee |
|------|----------|
| Owner(s) | @hameldesai |
| Epic | BT-V3 Adaptive Portfolio Intelligence And Governed Autonomy |
| PRD | [09-backtester-v3-adaptive-portfolio-intelligence-and-governed-autonomy.md](../PRDs/09-backtester-v3-adaptive-portfolio-intelligence-and-governed-autonomy.md) |
| Tech Spec | [09-backtester-v3-adaptive-portfolio-intelligence-and-governed-autonomy.md](../TechSpecs/09-backtester-v3-adaptive-portfolio-intelligence-and-governed-autonomy.md) |
| Implementation Plan | [09-backtester-v3-adaptive-portfolio-intelligence-and-governed-autonomy.md](../Implementation/09-backtester-v3-adaptive-portfolio-intelligence-and-governed-autonomy.md) |

---

## QA Goal

Verify that V3 can introduce portfolio intelligence and governed autonomy without:

- allowing low-trust strategies to consume high-trust budgets
- hiding drawdown, exposure, or concentration risk behind aggregate posture prose
- escalating beyond supervised-live without explicit evidence and operator approval
- making portfolio-fit rejections look like strategy failure

This QA plan is meant to prove four things:

1. capital competition is bounded and replayable
2. the four-layer risk-budget stack actually constrains behavior
3. strategy authority tiers directly influence runtime posture
4. Mission Control can explain portfolio posture, authority, and autonomy honestly

---

## Scope

In scope:

- strategy authority tiers and trust contracts
- two-stage strategy-family-first capital allocation
- drawdown, exposure, position-size, and concentration controls
- supervised-live review windows and approval artifacts
- Mission Control posture and autonomy surfaces

Out of scope:

- V4 desired-state / actual-state reconciliation
- fully automated stronger-than-supervised-live operation
- broad multi-account or multi-tenant rollout

---

## QA Matrix

| Area | Scenario | Expected Result |
|------|----------|-----------------|
| Authority | Low-trust family with strong raw candidates | Family receives bounded budget and cannot consume trusted-family authority. |
| Allocation | Mixed candidate set across multiple families | Stage-1 family budgets constrain stage-2 candidate ranking. |
| Portfolio fit | Strong idea under saturated concentration bucket | Signal can be rejected for portfolio reasons without labeling the strategy itself as broken. |
| Drawdown budget | Portfolio drawdown breach | Posture reduces risk or pauses according to policy. |
| Exposure budget | Gross exposure exceeds allowed heat | New candidates are blocked or resized. |
| Position limits | Single-name oversize attempt | Allocation is capped or rejected with a clear reason. |
| Concentration | Multiple overlapping names in one sector/theme | Overlap cap triggers before concentration becomes implicit. |
| Autonomy gate | Missing supervised-live signoff | Escalation beyond supervised-live is blocked. |
| Autonomy gate | Unresolved incident in review window | Stronger autonomy remains blocked. |
| Mission Control | Portfolio posture view | UI matches stored posture, budget, and authority state. |
| Mission Control | Demotion or pause event | UI reflects the event and its reason after refresh and replay. |

---

## Required Automated Coverage

Add or update tests around these areas when implementation starts:

- strategy authority tier synthesis
- two-stage allocation and family budgeting
- drawdown, exposure, size, and concentration constraints
- supervised-live review-window gating
- Mission Control posture and autonomy rendering

Suggested test cases:

- low-trust strategy cannot receive trusted-family budget
- drawdown budget triggers a posture change
- concentration cap blocks overlapping names while preserving underlying score artifacts
- stronger autonomy is blocked without explicit operator approval
- Mission Control renders the same posture and authority truth as stored artifacts

---

## Manual / Live Validation

### Scenario 1 - Mixed Candidate Day

Setup:

- multiple strategy families produce candidates on the same day
- trust tiers differ across those families

Checks:

- inspect family budgets
- inspect final candidate selection and posture output

Success:

- family authority and budget rules visibly shape the final candidate set

---

### Scenario 2 - Drawdown And Heat Stress

Setup:

- replay or simulate a case where drawdown budget or gross exposure budget is near limit

Checks:

- inspect posture output
- inspect any budget or authority reductions
- verify Mission Control reflects the same restrictions

Success:

- survivability constraints override aggressiveness cleanly and visibly

---

### Scenario 3 - Supervised-Live Gate Review

Setup:

- create one clean supervised-live review window
- create one window with unresolved incidents or no signoff

Checks:

- compare authority outcomes
- inspect operator approval artifacts

Success:

- only the clean, explicitly approved path can move toward stronger autonomy consideration

---

### Scenario 4 - Mission Control Cross-Check

Setup:

- open the latest posture and autonomy state in Mission Control

Checks:

- compare posture summaries, budgets, and authority tiers against stored artifacts
- refresh and replay the same state

Success:

- the UI remains a truthful renderer, not an independent posture calculator

---

## Acceptance Criteria

The V3 release is QA-complete when all of the following are true:

- `100%` of reviewed posture artifacts show family budgets, posture state, and risk warnings with provenance
- `0` stronger-autonomy transitions occur without the full evidence and operator-approval requirements
- drawdown, exposure, position-size, and concentration controls each produce at least one validated enforcement path
- `100%` of reviewed Mission Control posture states match the stored posture and authority artifacts
- portfolio-fit rejections are distinguishable from raw strategy-quality failures in validated review cases

---

## Release Risks To Watch

- strong raw signals may tempt premature budget escalation
- portfolio-fit logic may be mistaken for alpha decay if artifacts are not explicit
- approval flows could become ceremonial instead of real if incident state is not wired correctly
- Mission Control might flatten too much nuance and hide why a strategy was limited or paused

---

## Sign-Off Checklist

- [x] Strategy authority tiers verified
- [x] Two-stage allocation verified
- [x] Four-layer risk-budget stack verified
- [x] Supervised-live gate and approval path verified
- [x] Mission Control posture and autonomy truth verified
- [x] No silent escalation beyond supervised-live
