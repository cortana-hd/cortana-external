# Uncertainty-Aware Confidence Scoring and Confidence-Weighted Position Sizing

## Problem Statement

The current stack already produces a numeric `confidence` in `TradingAdvisor.analyze_stock()` and uses that number inside `data.wave3.build_position_sizing_guidance()`, but it does not explicitly separate:

- signal strength from data quality
- confidence from uncertainty
- "low conviction" from "cannot trust this input"
- "watch" due to setup quality from "abstain" due to unreliable evidence

As a result:

- confidence is a single blended heuristic instead of a structured decision object
- sizing can still look precise when upstream inputs are stale, conflicting, or unavailable
- `advisor.py` ranking/evaluation paths have no explicit abstain state to compare against buys/watches
- Dip Buyer and CANSLIM paths do not share a common confidence contract

This repo is already rule-heavy and resilient to partial data. The missing piece is an explicit uncertainty layer that makes the existing heuristics safer, auditable, and easier to evaluate.

## Goals

- Add a first-class confidence/uncertainty object that can travel through the existing advisor and strategy outputs.
- Distinguish between:
  - raw setup strength
  - uncertainty penalty
  - final effective confidence
  - abstain reasons
- Make position sizing explicitly confidence-weighted and uncertainty-aware.
- Reuse current score producers instead of replacing them:
  - CANSLIM fundamental scores
  - Wave 2 breakout/sentiment/exit-risk overlays
  - Wave 3 sector/catalyst/market sizing context
  - Dip Buyer score frames
- Preserve current CLI/reporting ergonomics and keep phase 1 backward-compatible with existing `confidence`, `rank_score`, and `position_size_pct` fields.
- Add evaluation hooks so confidence buckets and abstentions can be tested against realized outcomes.

## Non-Goals

- Rebuilding the repo around a full ML ranking system in phase 1.
- Introducing online learning, feature stores, or heavy model-serving infra.
- Replacing `MarketRegimeDetector`, Wave 2, or Dip Buyer score logic with black-box predictions.
- Optimizing portfolio construction across correlated positions in this change.
- Changing application behavior broadly before the confidence contract is measured offline.

## Current Architecture Summary

### Advisor flow

`advisor.py` currently drives the main long-side stack:

1. `TradingAdvisor.get_market_status()` pulls `MarketStatus` from `MarketRegimeDetector`.
2. `TradingAdvisor.analyze_stock()`:
   - fetches 1y history via `MarketDataProvider`
   - fetches fundamentals and CANSLIM fundamental scores
   - computes technical score locally in `_calculate_technical_score_from_history()`
   - runs Wave 2:
     - `score_breakout_follow_through()`
     - `build_sentiment_overlay()`
     - `score_exit_risk()`
   - runs Wave 3:
     - `SectorStrengthAnalyzer.analyze()`
     - `score_catalyst_weighting()`
   - computes:
     - `total_score`
     - inline heuristic `base_confidence`
     - adjusted `confidence`
     - `rank_score` via `score_enhanced_rank()`
   - passes everything to `_generate_recommendation()`
3. `_generate_recommendation()`:
   - gates on market correction, low total score, sentiment veto, exit-risk veto, weak breakout, low confidence, and distance from 52w high
   - calls `build_position_sizing_guidance()` for final size guidance
   - returns `BUY`, `WATCH`, or `NO_BUY`
4. `scan_for_opportunities()` enriches screener output with scores, confidence, action, and ranking columns, then `attach_model_family_scores()` adds baseline/tactical/enhanced comparison columns.

### Existing confidence-related behavior

The repo already has the raw ingredients for an uncertainty layer:

- `MarketStatus.status`, `degraded_reason`, `snapshot_age_seconds`, and `data_source` in [`data/market_regime.py`](/Users/hd/Developer/cortana-external/backtester/data/market_regime.py)
- `data_staleness_seconds` and `data_status` returned from advisor history fetches
- neutral/unavailable handling in Wave 2 sentiment utilities in [`data/wave2.py`](/Users/hd/Developer/cortana-external/backtester/data/wave2.py)
- unavailable/unmapped sector handling and bounded confidence deltas in [`data/wave3.py`](/Users/hd/Developer/cortana-external/backtester/data/wave3.py)
- sizing multipliers already tied to `confidence` and setup quality in [`data/wave3.py`](/Users/hd/Developer/cortana-external/backtester/data/wave3.py)

What is missing is a shared contract that converts these signals into an explicit uncertainty-aware decision object.

### Dip Buyer flow

`strategies/dip_buyer.py` is already better structured for reuse than the CANSLIM path:

- `build_score_frame()` creates a reusable per-bar frame with `Q`, `V`, `C`, thresholds, regime activity, credit veto, and recovery/falling-knife flags.
- `evaluate_setup()` returns a latest-bar recommendation object with position size and reasons.
- `generate_signals()` uses the same score frame for backtest signal generation.

This is the right pattern for uncertainty integration: build a reusable frame/object once, then consume it for scans, advisor output, and backtests.

### Evaluation flow

[`evaluation/comparison.py`](/Users/hd/Developer/cortana-external/backtester/evaluation/comparison.py) compares model families using:

- `total_score`
- overlay-aware rank columns
- `confidence`
- `action`
- optional `future_return_pct` and `outcome_bucket`

This is the natural place to add confidence-bucket and abstention analysis without inventing a new evaluation stack.

### Important code-structure note

[`advisor.py`](/Users/hd/Developer/cortana-external/backtester/advisor.py) currently defines `scan_dip_opportunities()` twice and `analyze_dip_stock()` twice. The later definitions win at runtime. That does not block the PRD, but it is a phase 0 cleanup item because confidence integration should attach to one canonical Dip Buyer path.

## Explicit Recommendation: Hybrid, Rule-Layer First

Recommendation: use a **hybrid** architecture.

### Why not pure model-layer

- The current repo is not built around point-in-time labeled training data.
- Market/data degradation handling is already rule-based and should remain deterministic.
- A pure model would be forced to learn around missing/stale inputs that are already explicitly encoded today.

### Why not pure rule-layer

- The repo already has enough scored outputs to support later calibration.
- `evaluation/comparison.py` can already compare score families against outcomes.
- A pure heuristic layer will keep producing arbitrary confidence percentages unless it is calibrated against realized returns over time.

### Practical interpretation for this repo

- Phase 0/1: rule-layer owns confidence decomposition, abstain logic, and size caps.
- Phase 2: optional model/calibration layer learns a better mapping from existing features to expected win rate / expected return / uncertainty, but stays behind the same contract.

That gives the repo safer decisions immediately without blocking future calibration work.

## Recommended Architecture

### New concept: confidence assessment

Add one reusable confidence-assessment builder that takes the existing score outputs and returns a structured object:

- raw signal strength
- uncertainty penalties
- effective confidence
- abstain decision
- size multiplier
- machine-readable reasons

Recommended new module:

- [`data/confidence.py`](/Users/hd/Developer/cortana-external/backtester/data/confidence.py)

Recommended primary API:

```python
def build_confidence_assessment(
    *,
    market: MarketStatus,
    total_score: int,
    breakout: dict,
    sentiment_overlay: dict,
    exit_risk: dict,
    sector_context: dict,
    catalyst_weighting: dict,
    data_status: str,
    data_staleness_seconds: float,
    history_bars: int,
    symbol: str,
) -> dict: ...
```

Recommended secondary API:

```python
def confidence_weighted_position_size(
    *,
    market: MarketStatus,
    assessment: dict,
    breakout: dict,
    exit_risk: dict,
    sector_context: dict,
    catalyst: dict,
    base_position_pct: float = 10.0,
) -> dict: ...
```

`build_position_sizing_guidance()` can either call this second function or be expanded to accept the new assessment object directly.

### Exact integration points in current code

#### 1. `TradingAdvisor.analyze_stock()` in [`advisor.py`](/Users/hd/Developer/cortana-external/backtester/advisor.py)

Replace the inline `base_confidence` / `confidence` math with:

- `assessment = build_confidence_assessment(...)`
- keep `confidence = assessment["effective_confidence_pct"]` as a backward-compatible alias in phase 1

Append these fields to the returned analysis dict:

- `confidence_assessment`
- `uncertainty_pct`
- `abstain`
- `abstain_reasons`

#### 2. `TradingAdvisor._generate_recommendation()` in [`advisor.py`](/Users/hd/Developer/cortana-external/backtester/advisor.py)

Change the method signature to accept `confidence_assessment`.

Use it for:

- abstain-before-buy gating
- reason generation
- final size guidance

Recommended order:

1. hard market veto
2. hard setup veto (`sentiment_overlay.veto`, `exit_risk.veto`)
3. uncertainty abstain
4. low-conviction watch
5. buy with confidence-weighted size

This keeps hard risk vetoes separate from uncertainty abstention.

#### 3. `data.wave3.build_position_sizing_guidance()` in [`data/wave3.py`](/Users/hd/Developer/cortana-external/backtester/data/wave3.py)

Extend or wrap this function so sizing uses:

- regime base
- effective confidence
- uncertainty penalty
- existing setup multipliers
- hard floor/cap rules

Do not remove the current setup-based multipliers. They already encode useful risk behavior. The change is to make uncertainty explicit instead of implicit.

#### 4. `TradingAdvisor.scan_for_opportunities()` in [`advisor.py`](/Users/hd/Developer/cortana-external/backtester/advisor.py)

Add these columns to the enriched scan output:

- `raw_confidence`
- `uncertainty_pct`
- `effective_confidence`
- `abstain`
- `abstain_reason_codes`
- `size_label`

Keep existing `confidence` as an alias to `effective_confidence` in phase 1 so `evaluation/comparison.py` continues to work.

#### 5. Evaluation path in [`evaluation/comparison.py`](/Users/hd/Developer/cortana-external/backtester/evaluation/comparison.py)

Extend comparison utilities to support:

- abstention rate
- average uncertainty
- performance by confidence bucket
- performance of abstained names versus acted-on names

Suggested additions:

- preserve `confidence` sort behavior for backward compatibility
- optionally sort secondary by lower `uncertainty_pct`
- add summary columns:
  - `abstain_count`
  - `abstain_rate_pct`
  - `avg_uncertainty_pct`
  - `avg_effective_confidence`

#### 6. `DipBuyerStrategy.build_score_frame()` and `evaluate_setup()` in [`strategies/dip_buyer.py`](/Users/hd/Developer/cortana-external/backtester/strategies/dip_buyer.py)

Add a Dip Buyer-specific confidence builder that consumes:

- `Q`, `V`, `C`
- `Market_Active`
- `Credit_Veto`
- `Recovery_Ready`
- `Falling_Knife`
- risk data completeness
- market degradation state

Recommended output columns added to the score frame:

- `Raw_Confidence`
- `Uncertainty_Pct`
- `Effective_Confidence`
- `Abstain`
- `Abstain_Reason_Codes`
- `Size_Multiplier`

Then use those columns in:

- `evaluate_setup()` for advisor-facing recommendations
- `generate_signals()` for optional research mode where extremely uncertain setups can be ignored even if score thresholds pass

#### 7. `data/market_regime.py` in [`data/market_regime.py`](/Users/hd/Developer/cortana-external/backtester/data/market_regime.py)

No redesign required. Reuse the existing fields as uncertainty inputs:

- `status == "degraded"`
- `degraded_reason`
- `snapshot_age_seconds`
- `data_source`
- `position_sizing`

Optional phase 1 addition:

- expose a helper like `market_uncertainty_penalty(status: MarketStatus) -> dict`

This keeps market degradation logic local to market-regime code.

### Recommended confidence construction logic

Use additive components plus bounded penalties, not a full rewrite.

Proposed decomposition:

```text
raw_confidence_pct
  = setup_strength(total_score, breakout, sentiment, sector, catalyst, exit_risk)

uncertainty_pct
  = data_quality_penalty
  + input_coverage_penalty
  + disagreement_penalty
  + regime_degradation_penalty
  + event_nearby_penalty

effective_confidence_pct
  = clamp(raw_confidence_pct - uncertainty_pct, 0, 100)
```

Suggested signal-strength inputs:

- current `total_score`
- Wave 2 breakout score
- Wave 2 sentiment score
- Wave 3 sector score
- Wave 3 catalyst score
- negative contribution from exit-risk score

Suggested uncertainty inputs:

- `market.status == "degraded"`
- stale symbol history (`data_staleness_seconds`)
- insufficient history bars
- sentiment disagreement or lack of reliable sources
- sector benchmark unavailable/unmapped
- catalyst/event window too close
- contradictory signal pattern, for example:
  - strong total score but negative sector + high exit risk
  - bullish news but weak breakout follow-through

### Abstain semantics

Add explicit abstain reasons distinct from current `WATCH` / `NO_BUY`.

Recommended interpretation:

- `BUY`: conviction sufficient and uncertainty acceptable
- `WATCH`: setup may improve; evidence is valid but not yet strong enough
- `ABSTAIN`: evidence quality is too weak/conflicted/degraded to trust the recommendation
- `NO_BUY`: deterministic veto or structural block

If adding a new action immediately is too invasive, phase 1 can keep outward `WATCH` while exposing `abstain=True` internally. That is the safer first step for this repo.

## Data Model for Confidence, Uncertainty, and Abstain Reasons

### Phase 1 canonical dict shape

```python
confidence_assessment = {
    "version": 1,
    "symbol": "NVDA",
    "raw_confidence_pct": 82,
    "uncertainty_pct": 18,
    "effective_confidence_pct": 64,
    "confidence_bucket": "medium",
    "size_multiplier": 0.85,
    "abstain": False,
    "abstain_reason_codes": [],
    "abstain_reasons": [],
    "component_signal": {
        "total_score": 8,
        "breakout_score": 4,
        "sentiment_score": 1,
        "sector_score": 1,
        "catalyst_score": 0,
        "exit_risk_score": 1,
    },
    "component_uncertainty": {
        "market_data_degraded": 0,
        "symbol_data_stale": 4,
        "insufficient_history": 0,
        "sentiment_disagreement": 0,
        "sentiment_unavailable": 0,
        "sector_unavailable": 0,
        "event_risk": 6,
        "signal_conflict": 8,
    },
    "data_quality": {
        "history_status": "ok",
        "history_staleness_seconds": 0.0,
        "market_status": "ok",
        "market_snapshot_age_seconds": 0.0,
    },
}
```

### Reason code vocabulary

Use stable codes so tests and evaluation do not depend on free-form strings:

- `market_regime_degraded`
- `symbol_data_stale`
- `insufficient_history`
- `sentiment_unavailable`
- `sentiment_conflict`
- `sector_unavailable`
- `catalyst_event_imminent`
- `signal_conflict`
- `credit_veto`
- `falling_knife`
- `market_correction`

### Backward compatibility rules

- Keep top-level `confidence` in advisor output as alias for `effective_confidence_pct`.
- Keep `position_size_pct` in recommendation output.
- Add new fields without breaking existing tests that only assert current keys.

## Rollout Plan

### Phase 0: contract and cleanup

Goal: introduce the data contract without changing recommendation behavior materially.

Work:

- add `docs/uncertainty-confidence-prd.md`
- clean up duplicate Dip Buyer method definitions in [`advisor.py`](/Users/hd/Developer/cortana-external/backtester/advisor.py)
- add `data/confidence.py` with:
  - assessment builder
  - reason-code constants
  - bucket helper
- thread assessment through `TradingAdvisor.analyze_stock()` output
- keep current buy/watch/no-buy logic unchanged except for using the new assessment as an alias source for `confidence`

Exit criteria:

- existing advisor tests still pass
- new outputs include structured confidence fields
- no behavior regression in current recommendations

### Phase 1: uncertainty-aware abstain and size

Goal: use uncertainty in live recommendation and sizing decisions.

Work:

- make `_generate_recommendation()` consume `confidence_assessment`
- add internal `abstain` behavior
- extend `build_position_sizing_guidance()` to scale by effective confidence and uncertainty
- add Dip Buyer confidence columns to `build_score_frame()` and `evaluate_setup()`
- add enriched scan columns for uncertainty and abstain

Exit criteria:

- obvious degraded/conflicted cases reduce size or abstain
- supportive clean cases preserve current BUY behavior
- scan outputs expose enough columns for offline analysis

### Phase 2: calibration and optional model layer

Goal: improve mapping from score components to expected outcomes without changing the public contract.

Work:

- add offline calibration using historical scan outputs and realized outcomes
- learn confidence mapping or calibration table from:
  - `total_score`
  - breakout/sentiment/sector/catalyst/exit-risk components
  - data quality flags
  - market regime fields
- compare calibrated confidence against heuristic confidence in `evaluation/comparison.py`
- optionally add expected-return or win-rate estimate as a sibling field to confidence

Exit criteria:

- confidence bucket monotonicity improves versus heuristic baseline
- abstention decisions show better regret/coverage tradeoff

## Evaluation Plan and Metrics

Use the existing comparison/evaluation path instead of building a separate framework.

### Dataset shape

For each scan candidate, persist:

- score components already produced today
- confidence assessment fields
- action / abstain decision
- realized forward return columns already used by evaluation
- outcome bucket

### Core metrics

- `coverage_pct`: percent of candidates where the system acts (`BUY` or `WATCH`) instead of abstaining
- `abstain_rate_pct`: percent explicitly abstained
- `avg_future_return_pct` by confidence bucket
- `hit_rate_pct` by confidence bucket
- `win_rate_pct` and `loss_rate_pct` by confidence bucket
- realized return monotonicity:
  - low confidence < medium confidence < high confidence
- average position size by confidence bucket
- weighted return:
  - `future_return_pct * position_size_pct`
- regret of abstentions:
  - forward returns of abstained names versus acted-on names
- drawdown proxy:
  - average loss on top-decile size recommendations

### Recommended confidence buckets

- `very_low`: 0-39
- `low`: 40-54
- `medium`: 55-69
- `high`: 70-84
- `very_high`: 85-100

### Comparison cuts to add in `evaluation/comparison.py`

- baseline score family vs uncertainty-aware family
- acted-on names vs abstained names
- current heuristic confidence vs calibrated confidence in phase 2
- standard sizing vs confidence-weighted sizing

## Test Strategy

### Unit tests

Add focused tests around the new confidence builder:

- clean supportive setup yields high raw confidence, low uncertainty
- degraded market snapshot increases uncertainty
- stale symbol history increases uncertainty
- conflicting sentiment sources set `sentiment_conflict`
- missing sector mapping sets `sector_unavailable`
- imminent catalyst increases uncertainty and may trigger abstain
- hard vetoes still produce `NO_BUY` regardless of confidence

Target files:

- new `tests/test_confidence_assessment.py`
- extend [`tests/test_advisor_wave2.py`](/Users/hd/Developer/cortana-external/backtester/tests/test_advisor_wave2.py)
- extend [`tests/test_wave3_scoring.py`](/Users/hd/Developer/cortana-external/backtester/tests/test_wave3_scoring.py)
- extend [`tests/test_market_regime_degradation.py`](/Users/hd/Developer/cortana-external/backtester/tests/test_market_regime_degradation.py)

### Integration tests

Advisor path:

- `TradingAdvisor.analyze_stock()` returns `confidence_assessment`
- `TradingAdvisor._generate_recommendation()` downgrades or abstains when uncertainty is high
- `scan_for_opportunities()` emits new uncertainty columns

Dip Buyer path:

- `build_score_frame()` emits confidence columns
- `evaluate_setup()` uses effective confidence for size
- `generate_signals()` remains deterministic unless explicit research-mode abstention is enabled

Evaluation path:

- `attach_model_family_scores()` remains backward-compatible
- `compare_model_families()` handles `confidence` alias and new uncertainty columns

### Regression tests

Preserve current behavior in already-covered happy paths:

- strong Wave 2/Wave 3 supportive setup still buys
- bearish sentiment veto still blocks buy
- sector-leader sizing still expands only for top-quality setups
- market degradation still returns degraded status instead of crashing

## Risks and Edge Cases

- Duplicate Dip Buyer method definitions in `advisor.py` make integration ambiguous until cleaned up.
- Over-penalizing uncertainty could collapse coverage and leave the system inert in normal markets.
- Under-penalizing degraded or stale inputs defeats the point of the feature.
- `WATCH` versus `ABSTAIN` semantics can become muddy if not encoded with stable reason codes.
- Confidence can become non-monotonic with returns if weights are tuned by intuition only; phase 2 calibration is needed.
- Sector and sentiment inputs already have "unavailable" branches; those should add uncertainty, not silently look neutral.
- Imminent earnings events can mean either opportunity or risk; the logic should penalize uncertainty unless recent post-event reaction is clearly supportive.
- Dip Buyer and CANSLIM use different score scales and regime assumptions; they should share the same assessment schema, not the same raw formula.
- Existing tests assert `confidence` and `position_size_pct`; phase 1 should preserve these fields while adding new ones.

## Recommended Implementation Order

1. Clean up the duplicate Dip Buyer methods in [`advisor.py`](/Users/hd/Developer/cortana-external/backtester/advisor.py) so there is one canonical path.
2. Add `data/confidence.py` and implement `build_confidence_assessment()`.
3. Replace inline confidence math in `TradingAdvisor.analyze_stock()`.
4. Thread the new assessment through `_generate_recommendation()` and `build_position_sizing_guidance()`.
5. Add uncertainty columns to scan output and evaluation summaries.
6. Add Dip Buyer confidence columns and sizing updates.
7. Add tests before changing thresholds materially.

## Bottom Line

This should be built as a **hybrid architecture with a rule-layer first rollout**:

- keep deterministic vetoes, degraded-data handling, and regime caps in the rule layer
- add a shared confidence/uncertainty contract now
- use that contract to drive abstention and position sizing
- optionally calibrate the confidence mapping later using the existing evaluation stack

That matches how this repo already works, minimizes implementation risk, and creates a clean path to improve confidence quality without rewriting the trading system.
