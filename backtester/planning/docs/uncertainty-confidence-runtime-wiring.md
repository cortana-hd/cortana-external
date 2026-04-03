# Uncertainty-Aware Confidence Runtime Wiring

The confidence contract landed in the backtester in `#94`. The follow-up runtime fix in `#95` made scans and recommendation selection actually use it.

This doc explains what changed in the live candidate flow, why it matters, and what a concrete before/after looks like.

## What was wrong before

Before the runtime wiring fix, the backtester could already compute:

- `raw_confidence_pct`
- `uncertainty_pct`
- `effective_confidence_pct`
- `abstain`
- uncertainty-aware sizing inputs

But the runtime candidate flow still behaved mostly like an older score-first system:

- CANSLIM scan rows were still ordered primarily by `rank_score`
- Dip Buyer scan rows were still ordered primarily by `total_score`
- `get_recommendations()` walked the top scan rows instead of first filtering to already-buyable names

That meant a candidate with a strong raw score but degraded inputs could still float to the top even when the confidence contract had already marked it as an uncertainty-driven `WATCH` or `abstain`.

## What happens now

The runtime now carries the confidence contract all the way into scan ordering and recommendation selection.

### Candidate ranking

Both CANSLIM and Dip Buyer runtime scans now sort candidates in this order:

1. `action` priority: `BUY`, then `WATCH`, then `NO_BUY`
2. `abstain` priority: non-abstaining rows before abstaining rows
3. strategy-specific primary score:
   - CANSLIM: `rank_score`
   - Dip Buyer: `effective_confidence`, then size and total score
4. tie-breakers:
   - higher `effective_confidence`
   - higher fallback `confidence`
   - lower `uncertainty_pct`
   - higher `position_size_pct`
   - higher `total_score`
   - alphabetical `symbol`

### Recommendation selection

`get_recommendations()` no longer re-analyzes whatever happens to be at the top of the enriched scan.

It now:

1. uses the enriched runtime scan
2. keeps only rows already marked `BUY`
3. re-analyzes only those symbols for the final recommendation payload

This closes the gap between "the confidence layer says this is buyable" and "the runtime actually surfaces it as a recommendation."

## How action, abstain, confidence, uncertainty, and sizing interact

- `raw_confidence_pct` is the setup-strength score before uncertainty penalties.
- `uncertainty_pct` is the penalty from stale, degraded, missing, or conflicting evidence.
- `effective_confidence_pct` is `raw_confidence_pct - uncertainty_pct`. This is the confidence number that should drive decisions.
- `abstain` flips on when uncertainty is too high or effective confidence falls too low. In practice, that prevents a fragile setup from being treated like a normal high-score candidate.
- `action` is the final runtime decision after market gates, setup vetoes, and abstain logic are applied. A high raw score can still end as `WATCH` if uncertainty is too high.
- `position_size_pct` is derived from regime base size multiplied by confidence, uncertainty, and setup modifiers. Higher uncertainty pushes size down even when the setup still survives as a `BUY`.

Operationally:

- high confidence + low uncertainty can produce a normal `BUY` with `STANDARD` or `FULL` sizing
- medium confidence or mixed overlays often degrade to `WATCH` or a smaller `STARTER`
- abstaining assessments are deprioritized in scans and should not crowd out clean `BUY` candidates

## Concrete before/after example

Illustrative enriched scan snapshot:

| Symbol | Total | Rank | Action | Abstain | Effective confidence | Uncertainty | Size |
|--------|-------|------|--------|---------|----------------------|-------------|------|
| `AMD`  | 9     | 12.0 | `WATCH` | `true`  | 44%                  | 41%         | 0.0% |
| `NVDA` | 8     | 10.0 | `BUY`   | `false` | 79%                  | 9%          | 9.5% |

### Before `#95`

The runtime favored the highest rank or total score first.

Result:

- `AMD` could sit above `NVDA` even though the confidence contract was already saying "do not trust this setup enough to buy it"
- `get_recommendations(limit=1)` could waste its top slot on `AMD`, then return no actionable trade

### After `#95`

The runtime favors buyability first, then uncertainty-aware quality.

Result:

- `NVDA` ranks ahead of `AMD` because `BUY` beats `WATCH`
- non-abstaining `NVDA` stays ahead of abstaining `AMD`
- the recommendation path only considers `BUY` rows, so `NVDA` becomes the surfaced trade
- `AMD` still appears in the scan, but as a deprioritized uncertainty-driven watch item with abstain reasons attached

That is the practical effect of the runtime wiring fix: the confidence contract no longer just annotates candidates, it changes which candidates the runtime surfaces and acts on.
