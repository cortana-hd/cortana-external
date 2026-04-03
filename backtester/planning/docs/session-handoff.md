# Session Handoff

Use this file if the original chat context is gone and a new agent needs to recover quickly.

## Start Here

Read these files first:
- `/Users/hd/Developer/cortana-external/backtester/README.md`
- `/Users/hd/Developer/cortana-external/backtester/planning/docs/backtester-study-guide.md`
- `/Users/hd/Developer/cortana-external/backtester/planning/docs/roadmap.md`
- `/Users/hd/Developer/cortana-external/backtester/planning/docs/schwab-oauth-reauth-runbook.md`

## Bootstrap Prompt

```text
Read these first and use them as the source of truth before making changes:

- /Users/hd/Developer/cortana-external/backtester/README.md
- /Users/hd/Developer/cortana-external/backtester/planning/docs/backtester-study-guide.md
- /Users/hd/Developer/cortana-external/backtester/planning/docs/roadmap.md
- /Users/hd/Developer/cortana-external/backtester/planning/docs/session-handoff.md
- /Users/hd/Developer/cortana-external/backtester/planning/docs/schwab-oauth-reauth-runbook.md

Then inspect the latest local workflow artifacts and summarize:
1. current system shape
2. what was intentionally built
3. what the roadmap says to review next
4. any drift or regressions since the last observation window

Important context:
- the current focus is the core operator path, not the experimental lane
- Schwab auth recovery and callback debugging now live in the Schwab OAuth reauth runbook
- leader buckets are selection input and leadership memory, not direct trade authority
- the next observation window is about whether leader buckets improve the live 120 basket and final watchlists
- longer term, the system should eventually support hold / trim / sell context, not just buy / watch
```

## Current System Shape

The current operating loop is:

1. `nighttime_flow.sh`
   - refreshes nightly discovery
   - rebuilds leader buckets
   - refreshes next-day selection inputs
2. `daytime_flow.sh`
   - refreshes market context by default
   - shows market regime
   - shows leader buckets
   - runs CANSLIM
   - runs Dip Buyer
   - runs a quick-check
3. local outputs are saved under:
   - `/Users/hd/Developer/cortana-external/backtester/var/local-workflows/`

## What Was Intentionally Built

- a simpler local operator surface for daytime runs
- nightly leader buckets with:
  - `daily`
  - `weekly`
  - `monthly`
  - `priority`
- leader buckets shown locally as `% move (appearances)`
- leader buckets used as bounded soft-priority input to the live 120 basket
- clearer separation between:
  - leadership memory
  - live CANSLIM / Dip Buyer decisions
- cleaned-up docs:
  - operator manual in `README.md`
  - conceptual doc in `backtester-study-guide.md`
  - forward-looking plan in `roadmap.md`

## What To Observe Over The Next Two Weeks

- whether leader buckets start accumulating real history beyond `n/a (1x)`
- whether repeated names across `daily / weekly / monthly` look believable
- whether `Scan input: X pinned + Y ranked` stays mostly ranked instead of mostly pinned
- whether CANSLIM top names and Dip Buyer watchlists feel more relevant than before
- whether local output and unified alert outputs stay directionally consistent

## Open Questions

- are leader buckets actually improving the live 120 basket?
- do persistent leaders show up in final watchlists often enough to matter?
- should leader-bucket overlap later be surfaced in the unified OpenClaw alerts too?
- when the system is ready, how should persistence and leadership decay feed a future hold / trim / sell layer?

## Important Boundaries

- experimental research exists, but it is not the current main focus
- leader buckets are not direct buy authority
- the system should not auto-sell from one weak bucket change
- the next major review should be evidence-driven after more live runs accumulate
