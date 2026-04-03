# Git Workflow Plan

This document defines the Git workflow for implementing the backtester roadmap.

It is intentionally:
- LLM agnostic
- repo specific
- conservative about current functionality
- designed to keep review scope understandable

## Goal

Ship roadmap work without:
- breaking current operator flows
- creating long-lived branch drift
- hiding unrelated changes inside large PRs
- requiring hidden chat context to understand how work should be delivered

## Recommended Branching Strategy

The default recommendation is:
- **do not** use one giant long-lived feature branch for the entire roadmap
- **do** use one branch per bounded work item or vertical
- merge work incrementally into `main`

Why:
- the roadmap is large and multi-phase
- a single long-lived branch will drift from `main`
- review quality collapses when too many changes pile up together
- test failures become harder to isolate
- rollback gets much harder

## Acceptable Exception

One integration branch may exist temporarily **only if**:
- a vertical spans multiple tightly coupled PRs
- the work cannot be reviewed meaningfully in one step
- the integration branch is still short-lived

Even in that case:
- the integration branch is **not** the final delivery strategy
- the goal is still to merge bounded PRs into `main` as soon as they are stable

## Source Of Truth Order

Before starting any implementation, the implementer should read in this order:

1. `/Users/hd/Developer/cortana-external/backtester/planning/docs/roadmap.md`
2. the relevant PRD under `/Users/hd/Developer/cortana-external/backtester/planning/PRDs/`
3. the matching Tech Spec under `/Users/hd/Developer/cortana-external/backtester/planning/TechSpecs/`
4. the matching Implementation Plan under `/Users/hd/Developer/cortana-external/backtester/planning/Implementation/`
5. this Git workflow plan

## Standard Branch Lifecycle

Every implementation branch should follow this exact sequence.

### 1. Sync From Main First

Always begin from the latest `main`.

```bash
cd /Users/hd/Developer/cortana-external
git fetch --all --prune
git checkout main
git pull --ff-only origin main
```

Rules:
- never start new work from a stale branch
- never assume local `main` is current
- if local `main` has diverged, resolve that before starting implementation

### 2. Create A Bounded Branch

Create a new branch for one bounded slice of work.

Naming pattern:

```text
<owner-or-agent>/<short-workstream>-<specific-scope>
```

Examples:
- `codex/w1-run-manifest-contracts`
- `codex/w2-settlement-enrichment`
- `codex/w3-entry-plan-contracts`
- `codex/w4-research-artifact-runtime`
- `codex/w5-walk-forward-registry`
- `codex/w6-operator-decision-contract`

Rules:
- branch names should describe the actual deliverable
- one branch should not cover multiple unrelated roadmap phases
- if the scope becomes too large, split it before implementation continues

### 3. Implement Only The Planned Scope

Implementation should match the linked:
- PRD
- Tech Spec
- Implementation Plan

Rules:
- do not sneak unrelated cleanup into the branch
- do not change runtime behavior outside the declared scope without documenting it
- if the plan is wrong, update the plan document in the same branch

### 4. Protect Current Functionality

Every branch must preserve current operator behavior unless the scoped work explicitly changes it.

This means:
- `cday` should still work unless the branch intentionally changes it
- `cnight` should still work unless the branch intentionally changes it
- `cbreadth`, `cdip`, and other current operator paths should remain usable
- watchdog and market-data behavior should not regress silently

Required mindset:
- roadmap execution is additive and controlled
- current working surfaces are treated as production-like behavior

### 5. Run Relevant Validation

Before opening a PR, run the tests and checks that match the scope.

Minimum expectation:
- run all directly affected tests
- run broader regression tests when the scope touches shared contracts or core flows
- verify current functionality is not broken

Examples:

If touching Python contracts or strategy logic:
```bash
cd /Users/hd/Developer/cortana-external/backtester
uv run pytest -q
```

If touching external-service TS logic:
```bash
cd /Users/hd/Developer/cortana-external
npm --prefix apps/external-service test
npm --prefix apps/external-service run typecheck
```

If touching watchdog:
```bash
cd /Users/hd/Developer/cortana-external
./watchdog/tests/market-data-check-test.sh
bash -n watchdog/watchdog.sh
```

If touching operator flows:
- run the smallest realistic local command that proves the surface still works
- examples:
  - `cbreadth`
  - `cdip`
  - `cday`

Rules:
- do not claim validation you did not run
- if a full suite is too expensive, say exactly what was run and what was not
- if a test failure is unrelated, document it explicitly instead of hiding it

### 6. Update The Implementation Plan

If the branch is part of a planned workstream, update the matching Implementation Plan.

At minimum update:
- shipped work
- changed contracts
- deviations from the original sequencing
- new tests or fixtures
- blockers or follow-up work

This is required because the implementation plan acts like the JIRA layer for later LLMs.

### 7. Commit Intentionally

Create a focused commit with a message that describes the actual delivered scope.

Examples:
- `Add run manifest and failure taxonomy helpers`
- `Enrich prediction settlement with excursion metrics`
- `Add strategy-specific entry plan contracts`

Rules:
- do not batch unrelated work into one commit
- do not amend history unless explicitly required
- if the branch contains multiple meaningful steps, use multiple intentional commits

### 8. Push And Open A PR

When the scoped work is complete and validated:

```bash
git push -u origin <branch-name>
gh pr create --base main --head <branch-name>
```

Every PR should include:
- what changed
- why it changed
- what tests were run
- any known limitations
- whether current operator functionality was preserved or intentionally changed

### 9. Merge Quickly Once Stable

Do not leave implementation branches open longer than necessary.

Rules:
- review and merge bounded work as soon as it is ready
- after merge, return to `main`
- pull latest code before starting the next branch

Post-merge:

```bash
git checkout main
git pull --ff-only origin main
```

## Branch Scope Rules

A branch is correctly sized if:
- one reviewer can understand it end to end
- the tests are obvious
- the rollback is obvious
- the PR title can be specific without sounding vague

A branch is too large if:
- it spans multiple roadmap phases
- it mixes contracts, runtime, research, governance, and operator surfaces all at once
- the implementation plan would need multiple sprints just to describe it

## Required PR Checklist

Every PR should answer these questions clearly:

1. What exact roadmap workstream and vertical does this branch implement?
2. Which files or modules are the main ownership area?
3. What machine contracts changed?
4. What current functionality could have been affected?
5. What tests were run?
6. What still remains for the parent workstream?

## Current Functionality Guardrail

No branch should be merged if it causes silent regression in current working behavior.

At minimum, the implementer should check:
- no current operator surface is silently broken
- no current cron consumer is silently broken
- no current machine-readable contract becomes ambiguous
- no current degraded path starts lying about health or freshness

If a branch intentionally changes current behavior:
- that change must be called out explicitly in the PR
- the docs and implementation plan must be updated in the same branch

## Cross-Repo Rule

If a change in `cortana-external` affects `cortana`:
- document that in the Tech Spec and Implementation Plan
- either update the consumer in the same delivery window
- or preserve backward compatibility until the consumer is updated

Never merge a producer-side contract change that silently breaks the consumer repo.

## Recommended Delivery Model For This Roadmap

Use this pattern:

1. one bounded branch per vertical or tightly related pair of verticals
2. one PR per branch
3. merge into `main`
4. repeat

Example sequence:
- W1 contract branch
- W1 readiness branch
- W2 settlement branch
- W2 reporting branch
- W3 entry-plan branch
- W3 portfolio branch

This is better than:
- one giant roadmap branch

because it keeps:
- review quality high
- merge risk lower
- regression isolation easier
- future LLM handoff much cleaner

## Final Recommendation

My recommendation is:
- **do not** use one feature branch for the entire roadmap
- **do** use short-lived, bounded feature branches that merge into `main` continuously
- keep one optional short-lived integration branch only when a vertical truly needs it

That is the safest workflow for this repo and for LLM-driven implementation.
