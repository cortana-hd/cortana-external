# QA Plan - Backtester V2 Signal Intelligence And Operator Trust

**Document Status:** Complete

## Team

| Role | Assignee |
|------|----------|
| Owner(s) | @hameldesai |
| Epic | BT-V2 Signal Intelligence And Operator Trust |
| PRD | [08-backtester-v2-signal-intelligence-and-operator-trust.md](../PRDs/08-backtester-v2-signal-intelligence-and-operator-trust.md) |
| Tech Spec | [08-backtester-v2-signal-intelligence-and-operator-trust.md](../TechSpecs/08-backtester-v2-signal-intelligence-and-operator-trust.md) |
| Implementation Plan | [08-backtester-v2-signal-intelligence-and-operator-trust.md](../Implementation/08-backtester-v2-signal-intelligence-and-operator-trust.md) |

---

## QA Goal

Verify that V2 improves the trustworthiness of the signal layer without:

- silently increasing capital authority
- confusing confidence with downside risk
- widening scope into too many new strategies
- showing stale or warming data as hard failures in operator surfaces

This QA plan is meant to prove four things:

1. the new score path is bounded and replayable
2. incumbent and challenger strategies remain benchmark-comparable
3. Mission Control tells a truthful freshness/trust story
4. V2 remains signal-quality-first and does not become an autonomy release

---

## Scope

In scope:

- core feature and regime bundle
- opportunity score and score-to-action mapping
- strategy evaluation and trust summaries
- one new strategy family: regime-aware momentum / relative strength
- Mission Control trust and freshness rendering

Out of scope:

- stronger autonomy tiers
- portfolio budgeting and strategy-family capital competition
- full desired-state / actual-state control-loop logic

---

## QA Matrix

| Area | Scenario | Expected Result |
|------|----------|-----------------|
| Feature bundle | Repeat identical source inputs | Feature bundle and regime labels remain deterministic. |
| Opportunity score | Strong setup with aligned regime and breadth | Score is high, action maps to `BUY`, and confidence/risk remain separate. |
| Opportunity score | Weak or contradictory setup | Score degrades and action trends toward `WATCH` or `NO_BUY`. |
| Opportunity score | Missing or stale inputs | Output degrades clearly instead of fabricating conviction. |
| Horizon | Evaluate mixed historical windows | Canonical 1-5 day horizon remains the primary label in artifacts. |
| Confidence | Small-sample bucket with good recent outcomes | Confidence stays conservative and does not masquerade as mature trust. |
| Benchmarking | New strategy family vs incumbent family | Challenger remains benchmarked and does not gain implicit authority. |
| Evaluation | Regime-slice summary generation | Profit factor, drawdown, and regime coverage render consistently. |
| Mission Control | Fresh data path | UI shows healthy trust and fresh timestamps. |
| Mission Control | Warm startup or in-progress fetch | UI shows `warming` or neutral loading instead of `error`. |
| Mission Control | Stale aggregate summary | UI shows `stale` or `degraded` honestly with provenance. |
| Safety | Enable V2 score path in shadow mode | Comparison is visible without silently changing authority. |

---

## Required Automated Coverage

Add or update tests around these areas when implementation starts:

- feature-bundle and regime-label assembly
- opportunity-score computation and score-to-action mapping
- confidence calibration and downside-risk separation
- benchmark and regime-slice summary generation
- Mission Control trust/freshness rendering

Suggested test cases:

- deterministic score output for identical inputs
- weak-evidence path does not overstate confidence
- warming startup path renders neutral instead of error
- regime-aware momentum / relative-strength challenger stays within bounded evaluation rules
- shadow comparison path does not change live authority

---

## Manual / Live Validation

### Scenario 1 - Clean Fresh Signal Run

Setup:

- fresh market data is available
- incumbent strategies and the new challenger family both produce outputs

Checks:

- inspect the opportunity-score artifacts
- compare score, action, confidence, and downside risk fields
- open Mission Control and verify the same trust state appears there

Success:

- score, action, and trust tell one coherent story across artifacts and UI

---

### Scenario 2 - Warm Startup / Partial Refresh

Setup:

- start from a cold or incognito Mission Control session
- allow live runtime to connect before aggregate summaries settle

Checks:

- watch for top-level signal and trust cards during the first few seconds
- verify the UI uses neutral loading or warming language

Success:

- no false `error` flash appears during normal first-paint convergence

---

### Scenario 3 - Weak Or Contradictory Regime

Setup:

- use a setup with mixed signals or weak regime alignment

Checks:

- inspect action mapping and confidence behavior
- compare benchmark and regime-slice summaries

Success:

- the system stays conservative and benchmark-aware instead of forcing conviction

---

### Scenario 4 - Challenger Family Review

Setup:

- run the regime-aware momentum / relative-strength challenger on a representative sample

Checks:

- compare its evaluation summary to incumbents
- verify it appears as a challenger family, not an implicitly trusted family

Success:

- challenger visibility improves without expanding runtime authority

---

## Acceptance Criteria

The V2 release is QA-complete when all of the following are true:

- `100%` of emitted opportunity-score artifacts include score, action, horizon, confidence, downside-risk, and regime context
- `0` silent authority increases happen as part of the first V2 rollout
- `100%` of Mission Control trust states render as `fresh`, `warming`, `degraded`, or `stale` with truthful provenance
- the new challenger family remains benchmarked and bounded in every reviewed run
- warming or startup convergence produces `0` false hard-error first-paint flashes in validated test runs

---

## Release Risks To Watch

- confidence may still be misread as trust if downside-risk fields are not surfaced clearly
- the challenger family could look production-ready before enough benchmark depth exists
- stale aggregate summaries may still appear stronger than live runtime truth if provenance is unclear
- score-path shadowing may drift into live authority accidentally if rollout fences are weak

---

## Sign-Off Checklist

- [x] Feature and regime bundle verified
- [x] Opportunity-score contract verified
- [x] Confidence and downside-risk separation verified
- [x] Benchmark and regime-slice summaries verified
- [x] Mission Control trust/freshness truth verified
- [x] Shadow rollout confirmed with no silent authority increase
