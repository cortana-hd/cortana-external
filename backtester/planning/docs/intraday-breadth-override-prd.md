# PRD: Intraday Breadth Override for Trading Alerts

## Status
- Proposed
- Scope: `cortana-external` primary, with downstream `cortana` cron consumption
- Intent: improve same-day trading alert quality during broad intraday reversal / surge sessions without weakening the existing daily regime discipline

## Summary

The current trading stack is intentionally conservative.

It uses:
- daily `SPY` market regime
- CANSLIM and Dip Buyer scan outputs
- correction-mode hard gates
- operator-safe `BUY / WATCH / NO_BUY` messaging

That design protects the system from chasing noise, but it misses one important class of opportunity:

- broad intraday reversal / surge sessions where the daily regime is still `CORRECTION`, but the same-day tape is strong enough that selective risk-taking may be warranted

Observed case:
- Tuesday, March 31, 2026
- S&P 500: about `+2.9%`
- Nasdaq Composite: about `+3.8%`
- Dow: about `+2.5%`
- breadth was broad, with roughly `4 of 5` S&P 500 names higher

The current stack still emitted:
- `Decision: WATCH`
- `BUY 0`
- `CORRECTION — no new positions`

That was consistent with the existing design, but too slow for the actual tape.

This PRD adds an intraday breadth / tape override layer so the system can distinguish:
- normal correction-day noise
- narrow short-covering squeezes
- real broad risk-on reversal sessions

The override is not a replacement for daily regime.
It is a bounded, evidence-based exception layer.

## Problem Statement

Current state has a blind spot:

- daily regime is the main authority
- same-day breadth is not first-class input
- market-session alerts can stay fully defensive even when the live tape is broad and unusually strong

That creates two operator problems:

1. missed opportunity
- the system can miss genuine same-day rebound / reversal conditions

2. poor explanation
- the alert may say `WATCH` in a session that is visibly strong across the board

The gap is not reliability anymore.
It is market-state resolution.

## Goals

- Add a first-class intraday breadth / tape override layer for market-session trading alerts.
- Keep the daily regime engine intact as the default authority.
- Allow a bounded override only when breadth and index behavior are strong enough.
- Make the override explainable in plain English.
- Keep analysis in Python and market-data collection in TS.
- Preserve safe fail behavior when live tape inputs are missing or degraded.

## Non-Goals

- No auto-trading or broker execution.
- No portfolio or holdings logic.
- No full intraday strategy engine.
- No replacement of CANSLIM or Dip Buyer scoring logic.
- No removal of daily regime gates for ordinary conditions.
- No requirement for streaming to stay permanently connected.

## Core Product Decision

The override should behave like this:

1. default
- daily regime remains authoritative

2. exception
- if broad live tape and breadth are strong enough, correction-mode alert posture can upgrade from:
  - `stand aside`
  - to `review selective buys`

3. bounded effect
- this should not allow unlimited `BUY` output
- it should only:
  - relax a subset of correction-mode blocks
  - or promote a small number of top names from `WATCH` into conditional `BUY`

## User Outcome

On a broad surge day, the operator should get something closer to:

```text
Intraday breadth override: active
Why: SPY +2.9%, Nasdaq +3.8%, broad participation across the tape
Posture: selective BUY allowed despite daily correction regime
Focus: ABBV, META, MSFT
```

Instead of:

```text
Decision: WATCH
BUY 0
CORRECTION — no new positions
```

## Observed Trigger Case

### March 31, 2026

Why this PRD exists:

- broad US equity rally
- strong S&P and Nasdaq performance
- broad participation, not just a narrow mega-cap squeeze
- current system remained in full correction-mode posture

Interpretation:

- the system was not broken
- it was operating on the wrong time resolution for that session

## Architecture Direction

This should follow the existing repo split:

- TS owns market data collection and exposure of live tape inputs
- Python owns analysis, override decisioning, and alert wording

### TS responsibilities

Use the existing market-data boundary to provide:

- live / recent quotes or snapshots for:
  - `SPY`
  - `QQQ`
  - `IWM`
  - `DIA`
  - optional `GLD`
  - optional `TLT`
- batch quote support for breadth universes
- freshness / degradation metadata

### Python responsibilities

Python should compute:

- intraday breadth summary
- override state
- override reason
- bounded alert posture changes
- explainable operator output

## Required Inputs

### 1) Index Tape

Minimum:
- `SPY`
- `QQQ`
- `IWM`
- `DIA`

Optional context:
- `GLD`
- `TLT`

### 2) Breadth Universes

Need two breadth views:

- S&P breadth
  - use the TS-owned base universe artifact
- growth / Nasdaq breadth
  - use a defined growth / tech basket already present in Python watchlists

Important:
- this does not require a full official Nasdaq constituent feed in phase 1
- a stable growth / Nasdaq proxy basket is enough

### 3) Existing Daily Regime

Keep using:
- `MarketRegimeDetector`
- distribution days
- drawdown
- regime score
- position sizing

### 4) Strategy Outputs

Use existing:
- CANSLIM
- Dip Buyer

The override should not invent new names.
It should only reinterpret the best existing names under rare conditions.

## Reference Models / Factual Anchors

This feature should be grounded in established breadth concepts, not invented terminology.

Useful external references:

- Advance/Decline breadth
  - StockCharts ChartSchool explains the advance/decline line and why breadth matters:
  - [Advance-Decline Line](https://chartschool.stockcharts.com/table-of-contents/market-indicators/advance-decline-line)

- Breadth thrust concept
  - StockCharts also documents breadth-thrust style indicators derived from advancing vs declining participation:
  - [Advance-Decline Ratio Indicators / Breadth Thrust context](https://stockcharts.com/articles/dancing/2015/01/advance-decline-ratio-indicators-chapter-5--cgmbi.html)

- Broad vs narrow participation
  - Nasdaq’s Bob Farrell rules article is a good plain-English reminder that broad participation is healthier than narrow leadership:
  - [Visualizing Bob Farrell's 10 Rules](https://www.nasdaq.com/articles/visualizing-bob-farrells-10-rules-2013-02-19)

- Strong 80% breadth days
  - Nasdaq market recaps often use “80% of stocks up” style framing to mark unusually broad rallies:
  - [Nasdaq breadth recap example](https://www.nasdaq.com/articles/wednesday-recap%3A-minty-fresh-breadth)

How these should influence phase 1:

- use simple, explainable breadth percentages first
- distinguish broad rallies from narrow index moves
- do not start with a full Zweig-style thrust implementation
- reserve full thrust indicators for phase 2 or later if the simpler breadth layer proves useful

## New Concepts

### Intraday Breadth Snapshot

New artifact, Python-owned:

- `intraday-breadth-latest.json`

Suggested fields:
- generated time
- session
- S&P up/down counts
- S&P percent up
- growth/Nasdaq proxy up/down counts
- growth/Nasdaq proxy percent up
- `SPY`, `QQQ`, `IWM`, `DIA` same-day percent moves
- optional concentration stats:
  - equal-weight style breadth proxy
  - top-5 contribution concentration proxy
- status / degraded reason

### Override State

Possible values:
- `inactive`
- `watch-only`
- `selective-buy`

### Override Explanation

Plain-English explanation that can be surfaced directly in alerts:

- `broad rally`
- `narrow squeeze`
- `weak breadth despite index bounce`
- `override unavailable because live tape is stale`

## Override Logic

### Phase 1 Rule Shape

The override should require all of these:

1. daily regime is still `CORRECTION`

2. broad index strength
- example thresholds to evaluate:
  - `SPY >= +1.5%`
  - `QQQ >= +2.0%`

3. broad participation
- example thresholds:
  - S&P breadth `>= 70%` of names up
  - growth / Nasdaq proxy breadth `>= 65%` of names up

4. no obvious narrowness failure
- do not activate if:
  - large-cap indexes are up but breadth is weak
  - or rally is driven by too few names

Candidate phase-1 metrics:
- `s_and_p_pct_up`
- `growth_pct_up`
- `advance_decline_ratio`
- `strong_up_day_flag`
  - for example, breadth at or above roughly `80%` of names up
- `narrow_rally_flag`
  - indexes strong, but breadth does not confirm
- optional `breadth_thrust_candidate`
  - measurement-only in phase 1, not trade authority

5. live freshness is acceptable
- if tape or breadth inputs are stale, do not upgrade to `selective-buy`

### Override Output

If active:
- correction-mode alert posture can relax from:
  - `stand aside`
  - to `review selective buys`

Bounded limits:
- max promoted `BUY` count in correction + override mode:
  - `1` to `3` names
- minimum score threshold should be stricter than normal
- keep explicit warning that daily regime is still not healthy

### Fail Behavior

If intraday inputs are unavailable:
- keep normal daily regime behavior
- add:
  - `Intraday breadth override: unavailable`

This must fail safe, not fail open.

## Operator Output Design

### New Alert Lines

Suggested additions for market-session output:

```text
Intraday breadth: S&P 78% up | growth basket 74% up
Tape: SPY +2.9% | QQQ +3.8% | IWM +2.1% | DIA +2.5%
Intraday override: selective-buy active
Why: broad rally with strong participation despite defensive daily regime
```

If not active:

```text
Intraday override: inactive
Why: index bounce is not broad enough to relax correction-mode discipline
```

If unavailable:

```text
Intraday override: unavailable
Why: live breadth inputs are stale or missing
```

## File / Module Plan

### TS side

Likely extend or reuse:
- `/Users/hd/Developer/cortana-external/apps/external-service/src/market-data/service.ts`
- existing batch quote / snapshot handlers
- existing universe artifact paths

Prefer adding a compact breadth-support path rather than a new giant market-data layer.

### Python side

Likely new files:
- `/Users/hd/Developer/cortana-external/backtester/data/intraday_breadth.py`
- `/Users/hd/Developer/cortana-external/backtester/tests/test_intraday_breadth.py`

Likely integration points:
- `/Users/hd/Developer/cortana-external/backtester/canslim_alert.py`
- `/Users/hd/Developer/cortana-external/backtester/dipbuyer_alert.py`
- `/Users/hd/Developer/cortana-external/backtester/advisor.py`

Optional operator snapshot integration:
- `/Users/hd/Developer/cortana-external/backtester/market_brief_snapshot.py`

## Measurement Plan

This feature should not go straight from intuition to production authority.

Track:
- days where override activated
- resulting `BUY / WATCH / NO_BUY` mix
- forward returns of promoted names
- drawdown after promoted entries
- whether override days outperform normal correction-day buys

Need special reporting for:
- false positives
  - override activated, promoted buys failed
- false negatives
  - override inactive, but broad surge day would have paid

## Testing Plan

### Unit Tests

- breadth aggregation math
- index move calculations
- override activation rules
- narrow-rally veto logic
- degraded / stale input handling

### Integration Tests

- alert formatting with:
  - inactive override
  - active override
  - unavailable override
- ensure correction-mode path still fails safe when override is absent

### Regression Tests

- no change to ordinary correction-day output when breadth is weak
- no change to confirmed-uptrend logic
- no dependence on portfolio paths

## Rollout Plan

### Phase 0: Measurement only

- compute intraday breadth snapshot
- surface read-only tape + breadth lines
- do not change `BUY / WATCH / NO_BUY`

### Phase 1: Posture-only override

- allow alert posture upgrade:
  - `stand aside` -> `review selective buys`
- still keep strategy outputs conservative

### Phase 2: Bounded trade-authority override

- allow a small number of top `WATCH` names to promote into conditional `BUY`
- keep stricter thresholds than normal correction-mode buys

### Phase 3: Outcome-based tuning

- tune thresholds using real outcome data
- keep all thresholds file-backed and reviewable

## Risks

### 1) Chasing dead-cat bounces

Mitigation:
- require breadth, not just index strength
- require both S&P and growth participation
- cap promoted buys tightly

### 2) Overriding good daily discipline too often

Mitigation:
- only available in rare, strong, broad sessions
- explicit activation thresholds
- strict measurement before widening

### 3) Data freshness problems

Mitigation:
- fail safe to ordinary correction-mode behavior
- explicit `unavailable` messaging

### 4) Operator confusion

Mitigation:
- always show:
  - daily regime
  - intraday breadth verdict
  - why the override is or is not active

## Success Criteria

This PRD is successful if it produces a feature that:

- catches broad surge / reversal sessions better than the current stack
- improves same-day opportunity capture
- does not materially increase false-positive buys in normal correction noise
- keeps operator output clearer, not noisier
- preserves the current reliable Python/TS split

## Recommendation

Build this in phases.

Do not start by letting the override emit broad new `BUY` traffic.

Best path:
1. add breadth snapshot and operator lines
2. measure it
3. only then promote it into bounded correction-mode trade authority
