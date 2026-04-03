# QA Closeout - Roadmap End-to-End Verification

**Date:** 2026-04-03  
**Branch:** `codex/qa-roadmap-closeout`  
**Goal:** Verify the full roadmap closeout end to end before Monday and separate real blockers from acceptable degraded behavior.

---

## Scope

This QA pass covered the full operator lane after the final roadmap implementation merged:

- shared operator surfaces
- market brief / `cbreadth`
- daytime and nighttime wrappers
- trade lifecycle surfaces
- prediction / calibration reporting
- runtime inventory / runtime health / ops-highway artifacts
- TS market-data service contract and health surfaces

This document is intentionally practical:

- what was tested
- what passed
- what degraded safely
- what is actually broken
- what should be fixed first

---

## Environment

- Repo: `/Users/hd/Developer/cortana-external`
- Branch under test: `main` synced to `origin/main`
- Local TS service: `http://127.0.0.1:3033`
- Date/time zone: `2026-04-03`, `America/New_York`

Live environment note during QA:

- the TS service was reachable
- but Schwab REST was repeatedly in `provider_cooldown`
- this is important because several surfaces were tested in real degraded conditions, not a perfectly healthy lane

That means this QA pass tested both:

- normal code correctness
- degraded runtime behavior

---

## Automated Verification

### Full suites

- [x] `cd /Users/hd/Developer/cortana-external/backtester && uv run pytest -q`
  - result: `397 passed`
- [x] `cd /Users/hd/Developer/cortana-external && npm --prefix apps/external-service test`
  - result: `56 passed`
- [x] `cd /Users/hd/Developer/cortana-external && npm --prefix apps/external-service run typecheck`
  - result: passed

### Wrapper / script syntax

- [x] `bash -n /Users/hd/Developer/cortana-external/backtester/scripts/daytime_flow.sh`
- [x] `bash -n /Users/hd/Developer/cortana-external/backtester/scripts/nighttime_flow.sh`
- [x] `bash -n /Users/hd/Developer/cortana-external/backtester/scripts/live_watch.sh`
- [x] `bash -n /Users/hd/Developer/cortana-external/backtester/scripts/watchlist_watch.sh`

### Focused surface / contract tests

- [x] `cd /Users/hd/Developer/cortana-external/backtester && uv run pytest tests/test_artifact_contracts.py tests/test_operator_compatibility.py tests/test_runtime_surfaces.py tests/test_ops_highway_artifacts.py tests/test_market_brief_snapshot.py tests/test_local_output_formatter.py tests/test_trade_lifecycle_cycle.py tests/test_consumer_contract_fixtures.py -q`
  - result: `49 passed`

### Compile pass

- [x] `python3 -m py_compile ...` on updated operator/runtime modules
  - result: passed

---

## Manual Smoke Verification

### Service health and operator endpoints

- [x] `curl -s http://127.0.0.1:3033/market-data/ready`
  - result: service reachable, `ready: true`
  - live state during QA: `operatorState=provider_cooldown`
- [x] `curl -s http://127.0.0.1:3033/market-data/ops`
  - result: service reachable and structurally healthy
  - live state during QA: repeated Schwab failures, token refresh in flight, cooldown active

### Shared operator surfaces

- [x] `uv run python market_brief_snapshot.py --operator`
  - result: returned readable operator output
  - degraded behavior observed correctly instead of crashing
- [x] `uv run python market_brief_snapshot.py --pretty`
  - result: returned structured JSON
  - nested operator / decision / narrative / shadow state present

### Runtime / ops-highway surfaces

- [x] `uv run python runtime_inventory_snapshot.py --pretty`
  - result: returned machine-readable runtime component inventory
- [x] `uv run python runtime_health_snapshot.py --pretty`
  - result: returned machine-readable runtime health artifact
  - important note: output was extremely verbose because it embedded large service payloads
- [x] `uv run python ops_highway_snapshot.py --pretty`
  - result: returned retention / backup / incident / capacity / change-management artifact

### Lifecycle surfaces

- [x] `uv run python trade_lifecycle_report.py`
  - result: rendered correctly
  - current live state: no open or closed positions yet
- [x] `uv run python trade_lifecycle_cycle.py --review-only --json`
  - result: returned valid JSON summary

### Readiness surface

- [x] `uv run python pre_open_canary.py`
  - result: returned a valid `readiness_check` artifact
  - in live degraded conditions it produced `warn` instead of crashing

### Wrapper flows

- [ ] `./scripts/daytime_flow.sh`
  - **failed**
  - blocker found
- [~] `./scripts/nighttime_flow.sh`
  - started normally
  - progress loop worked
  - not left running to full completion after the blocker in shared formatter path was identified

### Prediction / measurement reporting

- [~] `uv run python prediction_accuracy_report.py`
  - did not complete within a short bounded QA timeout
  - treated below as a runtime/performance finding

---

## Findings

Findings are ordered by severity.

## Remediation Update

The findings below were retested on the same branch after fixes were applied.

Current status:

- [x] `P1` formatter import-path regression fixed
- [x] `P2` runtime-health incident reporting improved
- [x] `P2` market-brief cached-age wording fixed
- [x] `P2` prediction-accuracy report now completes within a bounded timeout

Retest commands:

```bash
cd /Users/hd/Developer/cortana-external/backtester
uv run python /Users/hd/Developer/cortana-external/backtester/scripts/local_output_formatter.py --mode market-data-ops </dev/null
RUN_MARKET_INTEL=0 RUN_DYNAMIC_WATCHLIST_REFRESH=0 RUN_DEEP_DIVE=0 QUICK_CHECK_SYMBOL=SPY ./scripts/daytime_flow.sh
uv run python runtime_health_snapshot.py --pretty
uv run python market_brief_snapshot.py --operator
timeout 20s bash -lc 'uv run python prediction_accuracy_report.py'
```

### P1 - Daytime wrapper is currently broken by formatter import path

**Severity:** blocker  
**Status:** fixed in this branch  
**Area:** operator surfaces / wrappers

#### What happened

`daytime_flow.sh` crashed immediately at the market-data ops formatting step:

```text
Traceback (most recent call last):
  File ".../backtester/scripts/local_output_formatter.py", line 12, in <module>
    from operator_surfaces.renderers import render_operator_payload
ModuleNotFoundError: No module named 'operator_surfaces'
```

#### Reproduction

```bash
cd /Users/hd/Developer/cortana-external/backtester
RUN_MARKET_INTEL=0 RUN_DYNAMIC_WATCHLIST_REFRESH=0 RUN_DEEP_DIVE=0 QUICK_CHECK_SYMBOL=SPY ./scripts/daytime_flow.sh
```

Direct reproduction of the formatter failure:

```bash
cd /Users/hd/Developer/cortana-external/backtester
uv run python /Users/hd/Developer/cortana-external/backtester/scripts/local_output_formatter.py --mode market-data-ops </dev/null
```

#### Why this matters

- `cday` is a primary operator surface
- this is a direct regression in the wrapper path
- the same formatter file is also invoked by `nighttime_flow.sh`, so the nightly wrapper is at risk of the same failure when it reaches that stage

#### Likely source

- [local_output_formatter.py](/Users/hd/Developer/cortana-external/backtester/scripts/local_output_formatter.py#L12)
- [daytime_flow.sh](/Users/hd/Developer/cortana-external/backtester/scripts/daytime_flow.sh#L20)
- [nighttime_flow.sh](/Users/hd/Developer/cortana-external/backtester/scripts/nighttime_flow.sh#L139)

#### Suggested fix

- make the formatter runnable as a script from `scripts/`
- either:
  - set `PYTHONPATH`/module path explicitly in the wrapper call, or
  - make the script import path resilient when launched via absolute path

#### Retest result

- direct formatter command now runs successfully
- `daytime_flow.sh` now progresses through:
  - market-data ops
  - market regime
  - leader buckets
  - CANSLIM
  - Dip Buyer

So the primary `cday` blocker is resolved.

---

### P2 - Runtime health snapshot underreports live provider-cooldown incidents

**Severity:** medium  
**Status:** fixed in this branch  
**Area:** runtime health / ops highway

#### What happened

During QA, the live service clearly reported provider trouble:

- `/market-data/ready` returned `operatorState=provider_cooldown`
- `/market-data/ops` showed repeated Schwab failures and active cooldown
- `market_brief_snapshot.py --operator` reported tape fetch failure and unavailable tape

But `runtime_health_snapshot.py --pretty` still produced:

- `service_health.status = "ok"`
- `incident_markers = []`
- `warnings = []`

#### Why this matters

The runtime-health artifact is supposed to be the central machine-readable health truth. If the service is in provider cooldown and live quote batches are returning `503`, operators should see an incident marker or warning in the runtime-health surface itself.

Right now, the snapshot can look too calm while the real operator lane is degraded.

#### Likely source

- [runtime_health.py](/Users/hd/Developer/cortana-external/backtester/operator_surfaces/runtime_health.py#L39-L107)

Current logic only adds incident markers when:

- `market-data/ready` is unreachable
- or the readiness artifact says `fail`

It does **not** currently surface:

- `provider_cooldown`
- quote smoke failures
- risky operator state from the live service payload

#### Suggested fix

- promote `provider_cooldown` and similar risky operator states into:
  - `incident_markers`
  - `warnings`
  - and possibly `service_health.status = "degraded"`

#### Retest result

`runtime_health_snapshot.py --pretty` now surfaces:

- `incident_type = provider_cooldown`
- `service_health.operator_state = provider_cooldown`
- top-level `warnings = ["provider_cooldown"]`

So the runtime-health surface now reflects the live degraded condition much more truthfully.

---

### P2 - Market brief regime freshness wording is still misleading on cached degraded paths

**Severity:** medium  
**Status:** fixed in this branch  
**Area:** operator wording / market brief

#### What happened

`market_brief_snapshot.py --operator` produced:

```text
Regime: Market regime is CORRECTION (1m old).
```

But the same payload also said:

```text
Regime score -8: 9 distribution days and -7.6% drawdown. Stay defensive. [DEGRADED: computed from cached history, age=97.1h]
```

#### Why this matters

To an operator, `1m old` sounds fresh. But the underlying regime context was coming from cached history with an actual age of about `97h`.

This is not the emergency-fallback path that was already fixed earlier. It is the broader cached degraded path where:

- the wrapper is showing snapshot generation age
- while the posture reason is showing underlying input age

Those two ages tell different stories.

#### Evidence

From the live payload:

- `regime.snapshot_age_seconds = 128.46138`
- posture/regime notes include `age=97.1h`

Relevant code:

- [market_brief_snapshot.py](/Users/hd/Developer/cortana-external/backtester/market_brief_snapshot.py#L501-L506)

#### Suggested fix

For cached degraded regime paths, the operator surface should say something like:

- `Market regime is CORRECTION using cached history (underlying inputs ~97h old).`

not:

- `Market regime is CORRECTION (1m old).`

#### Retest result

`market_brief_snapshot.py --operator` now says:

```text
Regime: Market regime is CORRECTION using cached history (underlying inputs ~97.3h old).
```

That wording now matches the underlying degraded input age instead of implying a fresh live regime read.

---

### P2 - Prediction accuracy report is too slow / hangs under live degraded conditions

**Severity:** medium  
**Status:** fixed in this branch  
**Area:** reporting / measurement

#### What happened

`prediction_accuracy_report.py` did not complete within a bounded QA timeout.

Reproduction:

```bash
cd /Users/hd/Developer/cortana-external/backtester
timeout 15s bash -lc 'uv run python prediction_accuracy_report.py'
```

and:

```bash
timeout 15s bash -lc 'uv run python prediction_accuracy_report.py --json'
```

Both timed out in this live environment.

#### Why this matters

This report is part of the measurement / governance lane. If it stalls badly during degraded provider conditions, operator reporting and scheduled workflows can become unreliable or late.

#### Notes

This may be a performance issue rather than a pure correctness bug.

Possible causes:

- settlement path still doing too much live work
- provider cooldown leading to repeated waits
- no short-circuit when data freshness is clearly too poor for a quick report build

#### Suggested fix

- trace which stage inside `prediction_accuracy_report.py` is blocking
- add bounded timing logs
- prefer stale-safe summary fallback over open-ended waits in operator/report mode

#### Retest result

The report now completes successfully within the bounded QA timeout:

```bash
timeout 20s bash -lc 'cd /Users/hd/Developer/cortana-external/backtester && uv run python prediction_accuracy_report.py'
```

Observed behavior after the fix:

- the command completed successfully
- it emitted a real summary
- it no longer hung waiting on live settlement during provider cooldown

The fix strategy was:

- incremental settlement instead of brute-force re-settling the full backlog every run
- no fresh settlement attempts while the market-data service is clearly unavailable for safe settlement

---

## Behaviors That Look Okay

These were degraded during QA, but they behaved correctly enough that they should **not** be treated as blockers by themselves:

- `market_brief_snapshot.py --operator`
  - returned a readable degraded result instead of crashing
- `pre_open_canary.py`
  - returned a valid `warn` artifact during provider cooldown
- `trade_lifecycle_report.py`
  - rendered safely even with no open/closed positions
- `runtime_inventory_snapshot.py`
  - returned a valid runtime model
- `ops_highway_snapshot.py`
  - returned a valid planning artifact

---

## Monday Readiness Assessment

### Current read

- automated coverage: strong
- contract coverage: strong
- runtime degraded handling: mostly good
- wrapper/operator reliability: **not yet bulletproof**

### Monday read after remediation

- the original blocker is fixed
- the degraded runtime reporting is more truthful
- the market brief wording is more honest
- prediction-accuracy reporting is now bounded enough for operator use

Current recommendation:

- proceed with another real-market smoke on Monday morning
- keep watching live Schwab/provider stability
- treat provider cooldown frequency as an operational watch item, not a code blocker from this branch

---

## Suggested Next QA Step After Fixes

After these fixes, rerun this exact subset first:

```bash
cd /Users/hd/Developer/cortana-external/backtester
uv run pytest -q
RUN_MARKET_INTEL=0 RUN_DYNAMIC_WATCHLIST_REFRESH=0 RUN_DEEP_DIVE=0 QUICK_CHECK_SYMBOL=SPY ./scripts/daytime_flow.sh
NIGHTLY_LIMIT=5 SKIP_LIVE_PREFILTER_REFRESH=1 ./scripts/nighttime_flow.sh
uv run python market_brief_snapshot.py --operator
uv run python runtime_health_snapshot.py --pretty
timeout 15s bash -lc 'uv run python prediction_accuracy_report.py'
```

That is the smallest high-signal recheck set for this QA pass.

---

## QA Round 2 - Full End-To-End Recheck

This second pass was run after the remediation changes above landed on the same branch.

### Automated verification

Commands:

```bash
cd /Users/hd/Developer/cortana-external/backtester
uv run pytest -q

cd /Users/hd/Developer/cortana-external
npm --prefix apps/external-service test
npm --prefix apps/external-service run typecheck
```

Results:

- Python: `400 passed`
- TS tests: `56 passed`
- TS typecheck: passed

### Operator and runtime checks

Commands:

```bash
cd /Users/hd/Developer/cortana-external/backtester
uv run python market_brief_snapshot.py --operator
uv run python runtime_health_snapshot.py --pretty
uv run python trade_lifecycle_report.py
uv run python pre_open_canary.py
timeout 20s bash -lc 'uv run python prediction_accuracy_report.py'
uv run python canslim_alert.py --limit 8 --universe-size 120
timeout 45s bash -lc 'uv run python dipbuyer_alert.py --limit 5 --min-score 6 --universe-size 20'
```

Observed behavior:

- `market_brief_snapshot.py --operator`
  - returned a readable degraded after-hours snapshot
  - wording stayed honest:
    - cached regime age shown as underlying stale history
    - tape clearly reported unavailable
    - narrative/research/shadow sections rendered safely
- `runtime_health_snapshot.py --pretty`
  - surfaced `provider_cooldown` clearly in:
    - `incident_markers`
    - `service_health.operator_state`
    - top-level warnings
- `trade_lifecycle_report.py`
  - rendered safely with no positions
- `pre_open_canary.py`
  - returned a valid degraded-safe `warn` artifact
  - correctly marked:
    - service ready warning
    - quote smoke warning
    - regime-path warning
    - strategy smoke warning
- `prediction_accuracy_report.py`
  - completed successfully within the timeout and emitted a full summary
- `canslim_alert.py`
  - completed successfully
  - wording was appropriate for degraded correction conditions:
    - explicit degraded warning
    - `stand aside` posture
    - recovery hint

### New finding from Round 2

### P2 - Dip Buyer runtime is still too slow under live provider-cooldown conditions

**Severity:** medium  
**Status:** open  
**Area:** alert runtime / operator flow latency

#### What happened

`dipbuyer_alert.py` did not complete within a bounded smoke timeout, even with a very small universe:

```bash
cd /Users/hd/Developer/cortana-external/backtester
timeout 45s bash -lc 'uv run python dipbuyer_alert.py --limit 5 --min-score 6 --universe-size 20'
```

This exited with code `124` and did not emit a final alert payload before the timeout.

This also matches the earlier reduced `daytime_flow.sh` smoke, which progressed through:

- market-data ops
- market regime
- leader buckets
- CANSLIM

and then effectively stalled once it reached Dip Buyer under the same degraded provider window.

#### Why this matters

- `cday` can still feel stuck/slow even though the original formatter crash is fixed
- Telegram-facing daytime flows may still arrive too late in degraded market-data conditions
- this is now the main remaining end-to-end latency risk in the daytime operator path

#### Likely cause

Most likely candidates:

- Dip Buyer is still doing too much live work before it can emit a degraded-safe result
- quote/history fetches may not be short-circuiting aggressively enough during `provider_cooldown`
- degraded-path messaging is good, but degraded-path runtime is still too expensive

#### Suggested next fix

- trace Dip Buyer stage timings under `provider_cooldown`
- add bounded stale-safe fast path similar to the one now used in prediction settlement/reporting
- ensure a degraded/no-trade operator output can be produced quickly without waiting on full live enrichment

### Round 2 overall read

- No new blockers were found in automated coverage
- Most operator surfaces behaved correctly and truthfully under degraded live conditions
- The main remaining operational weakness is Dip Buyer latency during provider cooldown
