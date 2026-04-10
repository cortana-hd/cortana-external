# QA Plan - Provider Mode Market Data Fallback

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Owner(s) | Cortana trading stack |
| Epic | Provider Mode Market Data Fallback |
| PRD | `../prd/prd-provider-mode-market-data-fallback.md` |
| Tech Spec | `../techspec/techspec-provider-mode-market-data-fallback.md` |
| Implementation Plan | `../implementation/implementation-provider-mode-market-data-fallback.md` |

---

## QA Goal

Verify that provider-mode fallback reduces avoidable Schwab REST cooldown impact without:

- mixing Schwab and Alpaca price/history numbers inside one subsystem output
- hiding fallback behavior from operators
- regressing existing Schwab-primary workflows

This QA plan is meant to prove three things:

1. provider mode is explicit everywhere operators look
2. fallback behavior is deterministic by data class
3. Mission Control, terminal output, and persisted artifacts tell the same story

---

## Scope

In scope:

- `apps/external-service` market-data quote/history/snapshot route behavior
- `backtester` market brief, market regime, intraday breadth, and strategy alert surfaces
- `apps/mission-control` Trading Ops provider-mode display
- cooldown-day and degraded-mode operator behavior

Out of scope:

- broker execution
- options or crypto provider redesign
- full Alpaca parity for fundamentals or metadata

---

## Test Matrix

| Area | Scenario | Expected Result |
|------|----------|-----------------|
| Route contract | Schwab primary quote/history request | Response declares Schwab primary mode and does not show fallback engaged. |
| Route contract | Alpaca fallback quote/history request | Response declares Alpaca fallback mode and labels fallback engaged. |
| Route contract | Cache fallback request | Response declares cache-backed degraded mode explicitly. |
| Data consistency | Same subsystem output under fallback | No mixed Schwab and Alpaca price/history values in the same payload. |
| Data consistency | Fundamentals/metadata under Schwab degradation | Route stays Schwab/cache only and does not silently use Alpaca. |
| Breadth | Large breadth quote batch during Schwab REST cooldown | Breadth either uses approved fallback mode or degrades explicitly without hidden REST fan-out behavior. |
| Market brief | Market brief under fallback | Output declares the subsystem provider mode and stays internally consistent. |
| Strategy alerts | CANSLIM / Dip Buyer under fallback | Phase 1 behavior stays Schwab-primary or cache-fallback only; no silent Alpaca promotion. |
| Mission Control | Trading Ops latest run | Provider mode matches the persisted backtester artifact. |
| Mission Control | Live trading ops state | Live surface shows provider mode consistent with route metadata and fallback state. |
| Ops | Schwab streamer healthy + Schwab REST cooldown | System explains that streamer and REST lanes diverged instead of implying total provider failure. |
| Replay | Same run inspected from artifact and UI | Provider mode, fallback state, and degraded reason match exactly. |

---

## Required Automated Coverage

Add or update tests in these paths:

- `/Users/hd/Developer/cortana-external/apps/external-service/src/__tests__/market-data.test.ts`
- `/Users/hd/Developer/cortana-external/backtester/tests/test_market_data_provider.py`
- `/Users/hd/Developer/cortana-external/backtester/tests/test_intraday_breadth.py`
- `/Users/hd/Developer/cortana-external/backtester/tests/test_market_brief_snapshot.py`
- `/Users/hd/Developer/cortana-external/backtester/tests/test_dipbuyer_alert.py`
- `/Users/hd/Developer/cortana-external/backtester/tests/test_strategy_alert_payloads.py`
- `/Users/hd/Developer/cortana-external/backtester/tests/test_runtime_surfaces.py`
- `/Users/hd/Developer/cortana-external/apps/mission-control/lib/trading-ops.test.ts`
- `/Users/hd/Developer/cortana-external/apps/mission-control/lib/trading-ops-live.test.ts`

Minimum automated assertions:

- provider-mode fields are present in updated route responses
- fallback-engaged state is correct
- unsupported data-class fallback is refused explicitly
- subsystem artifacts do not contain mixed-provider price/history data
- Mission Control renders the same provider-mode label that artifacts persist

---

## Manual / Live Validation

### Scenario 1 - Schwab Primary Baseline

Setup:

- streamer healthy
- Schwab REST healthy

Checks:

- market brief shows Schwab primary mode
- intraday breadth remains Schwab-backed or streamer-backed as designed
- Mission Control Trading Ops agrees with terminal output

Success:

- no fallback mode appears
- no degraded reason appears unless another non-provider issue exists

---

### Scenario 2 - Streamer Healthy, Schwab REST Cooling Down

Setup:

- streamer healthy
- Schwab REST in `provider_cooldown`

Checks:

- `/market-data/ops` shows lane divergence clearly
- approved quote/history-oriented subsystems can enter labeled fallback mode
- non-approved subsystems degrade honestly instead of switching silently

Success:

- no operator surface implies “all Schwab is down”
- fallback mode, cache mode, or unavailable mode is explicit

---

### Scenario 3 - Breadth-Heavy Live Run

Setup:

- regular market session
- intraday breadth path active

Checks:

- breadth request path does not silently hide large Schwab REST fan-out behavior
- breadth output declares whether it is:
  - Schwab primary
  - Alpaca fallback
  - unavailable

Success:

- breadth state remains understandable
- no hidden mixed-provider payloads

---

### Scenario 4 - CANSLIM / Dip Buyer Under Schwab Degradation

Setup:

- Schwab REST degraded enough to tempt fallback

Checks:

- CANSLIM and Dip Buyer full scans stay in phase-1-approved modes only
- if they cannot run fully under Schwab/cache semantics, they degrade explicitly

Success:

- no silent Alpaca-backed full CANSLIM or Dip Buyer payloads in phase 1

---

### Scenario 5 - Mission Control Cross-Check

Setup:

- run at least one Schwab-primary run and one fallback or cache-backed run

Checks:

- compare:
  - persisted artifact
  - terminal/operator output
  - Mission Control Trading Ops

Success:

- provider mode, fallback state, and degraded reason match across all surfaces

---

## Acceptance Criteria

The change is QA-complete when all of the following are true:

- `100%` of updated provider-aware artifacts declare provider mode
- `0` validated examples of mixed Schwab/Alpaca price-history payloads inside one subsystem output
- approved fallback surfaces can run in labeled fallback mode during Schwab REST cooldown
- non-approved fallback surfaces remain Schwab/cache only and say so clearly
- Mission Control and terminal output agree on provider mode for the same run
- the operator can tell the difference between:
  - market opinion
  - fallback mode
  - cache-backed degraded mode
  - total unavailable state

---

## Release Risks To Watch

- provider mode may be technically correct in artifacts but phrased inconsistently in UI copy
- large quote-batch callers may still trigger unexpected Schwab REST pressure if fallback ladders are incomplete
- cache and Alpaca precedence may feel correct in tests but wrong in live strong-tape sessions if the freshness boundary is too stale
- subsystem-level mode may be correct while workflow-level summaries remain too vague unless `multi_mode` wording is explicit

---

## Sign-Off Checklist

- [ ] Route contracts verified
- [ ] Backtester artifact labeling verified
- [ ] Mission Control provider-mode labeling verified
- [ ] Schwab-primary baseline validated
- [ ] Schwab REST cooldown validated
- [ ] Breadth-heavy run validated
- [ ] CANSLIM / Dip Buyer phase-1 boundaries validated
- [ ] No mixed-provider subsystem artifacts observed
