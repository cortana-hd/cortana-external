# Trading Ops QA Runbook

Use this runbook before merging Trading Ops changes that affect latest-run truth, runtime wording, or fallback behavior.

## Goal

Confirm that Mission Control Trading Ops reflects the same live run that just completed and notified, without silently falling back to stale sources.

## Preconditions

- `cortana` is on the branch or revision you want to test for the trading pipeline.
- `cortana-external` / Mission Control is running on the branch under review.
- Mission Control has a working `DATABASE_URL`.
- The Trading Ops DB schema for `mc_trading_runs` is applied.

## QA Steps

1. Run a fresh compute:
   - `cd /Users/hd/Developer/cortana`
   - `./tools/trading/run-backtest-compute.sh`

2. Run the real notify leg:
   - `./tools/trading/run-backtest-notify.sh`

3. Verify the latest artifact:
   - open the newest `/Users/hd/Developer/cortana/var/backtests/runs/<run_id>/summary.json`
   - confirm `status`, `completedAt`, `notifiedAt`, `decision`, and counts

4. Run the Trading Ops smoke check:
   - `cd /Users/hd/Developer/cortana-external/apps/mission-control`
   - `pnpm exec tsx scripts/check-trading-ops-smoke.ts`

5. Refresh the Trading Ops page and confirm:
   - latest trading run label matches the fresh run time
   - source is DB-backed, not file fallback
   - decision and counts match the artifact and Telegram
   - stale workflow/market context is labeled stale
   - runtime wording is human-readable

6. Capture a screenshot for the PR when the latest run card and runtime card both look correct.

## Expected Pass Conditions

- smoke check exits `0`
- latest Trading Ops run id matches the latest artifact run id
- latest Trading Ops `notifiedAt` matches the artifact `notifiedAt`
- latest Trading Ops card is not in `fallback`
- no raw ISO cooldown deadlines appear in the UI
- market/workflow support cards do not masquerade as current truth

## Failure Cases

### Trading Ops shows `fallback`

- read the latest run card warnings
- verify Mission Control can reach Postgres
- rerun the smoke check to see whether the mismatch is in `runId`, counts, or timestamps

### Trading Ops latest run does not match Telegram

- compare `/Users/hd/Developer/cortana/var/backtests/runs/<run_id>/summary.json`
- rerun the smoke check
- if the smoke check fails on a mismatch, do not merge

### Runtime wording is confusing or raw

- inspect `/Users/hd/Developer/cortana-external/backtester/operator_surfaces/runtime_health.py`
- inspect `/Users/hd/Developer/cortana-external/apps/mission-control/lib/trading-ops.ts`

## Notes

- Runtime health and completed run truth are intentionally separate. A live provider cooldown can coexist with a successfully completed and notified run.
- This runbook validates the current Mission Control-owned ingestion path. Direct producer writes from `cortana` would be a separate follow-on change.
