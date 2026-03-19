# PRD: Buy Decision Infrastructure (Production-Safe)

**Status:** Proposed  
**Owner:** Cortana / OpenClaw trading workflow  
**Scope:** `cortana-external` backtester data and decision-support layers consumed by the existing `cortana` cron flow  
**Intent:** Improve buy decision quality through better data, reusable features, and measurable calibration without adding fragility to the live path.

## Problem Statement

The system is operationally stronger after cron decoupling, but buy decisions still rely on infrastructure that is only partially standardized:

1. Data normalization is spread across modules, which makes feature behavior harder to compare across scan, quick-check, and research paths.
2. Live ranking quality improved, but the feature pipeline is not yet treated as one reusable contract.
3. Confidence and watchlist prioritization are not fully tied to a stable, walk-forward calibrated mapping.
4. Slippage and execution costs are discussed in overlays, but are not yet a consistent part of buy-decision evaluation gates.
5. Promotion of new ranking ideas still risks “looks smart” drift unless evidence thresholds are explicit and auditable.

## Goals

1. Create one production-safe market-data and feature contract used by universe selection, quick-check, and research evaluation.
2. Improve top-120 scan quality with deterministic, precomputed ranking inputs.
3. Add confidence calibration that is explicit, measurable, and regime-aware.
4. Enforce walk-forward and cost-aware evaluation before promoting new buy-decision modifiers.
5. Improve operator clarity with concise output that explains why names surfaced.
6. Preserve current reliability model: base compute remains minimal and enrichments stay optional/fail-open.

## Non-Goals

- No wallet, broker, auth, or auto-order behavior
- No replacement of the Python regime/technical engine as final authority
- No heavy daytime network fanout in the blocking cron path
- No unbounded online learning loop directly mutating live weights intraday
- No Polymarket-only strategy path

## Architecture Principles

1. Python regime/technical engine stays primary.
2. Precompute first, consume fast.
3. Deterministic fallback always exists.
4. Promotion requires evidence.
5. Operator trust matters more than model complexity.

## Proposed Architecture

### A) Normalized Market-Data Snapshot Layer

Build a single normalization pass for core tradable-universe inputs:
- canonical OHLCV schema
- timezone-safe timestamps and session alignment
- consistent return/resampling behavior across consumers
- artifact freshness metadata

### B) Reusable Feature Contract

Define a bounded feature set with stable names and units so ranking, quick-check, and outcome analysis use the same inputs:
- trend and relative strength
- momentum across short/medium horizons
- volatility and downside stress
- liquidity and execution quality proxies
- pullback and distance-from-high structure
- regime alignment flags

### C) Ranked Universe Input Bridge

Extend the live prefilter path so daytime scans consume the feature snapshot contract directly:
- reserve explicit priority symbols first
- score remaining symbols from precomputed features
- fill remaining scan slots deterministically
- keep strict fallback to deterministic ordering when cache is stale/unavailable

### D) Confidence Calibration Layer

Add a calibration component that maps surfaced setups to expected reliability by slices such as:
- strategy family
- regime bucket
- execution/liquidity bucket

The calibration artifact is advisory, bounded, file-backed, and freshness-aware.

### E) Walk-Forward + Cost-Aware Evaluation

Promotion decisions use forward outcomes with explicit assumptions:
- rolling train/eval windows
- horizon metrics (`1d`, `5d`, `10d`)
- slippage/cost assumptions by liquidity tier
- downside and churn penalties

### F) Promotion Gate and Registry

Use a file-backed registry for decision modifiers:
- `research_only`
- `surfaced`
- `bounded_rank_modifier`

Only bounded, allowlisted modifiers can influence ranking.

### G) Operator-Facing Outputs

Compact mode should answer:
- what is actionable now
- why top names surfaced
- whether calibration is fresh or stale
- whether cost/liquidity warnings reduce urgency

Verbose/JSON mode can include:
- top contributing features per name
- calibration bucket context
- execution-quality tier
- promotion-state annotations

## V1 Delivery

1. Shared feature snapshot artifact backing the live prefilter cache
2. Nightly discovery surfacing of snapshot metadata
3. Advisory buy-decision calibration artifact from settled research records
4. Tests for deterministic feature generation, cache fallback, nightly surfacing, and calibration freshness

## Validation Plan

- Unit tests for normalization, feature determinism, fallback behavior, and calibration artifact generation
- Integration tests for nightly precompute writing valid artifacts and live selection consuming them without inline refresh
- Evaluation checks for walk-forward and cost-aware metrics before any future promotion into bounded rank modifiers

## Rollout

### Phase 1
- land the shared feature snapshot and calibration artifacts
- keep live authority unchanged

### Phase 2
- use calibration context in more operator-facing outputs
- measure whether confidence labeling improves decision quality

### Phase 3
- allow gated, evidence-backed promotion of additional rank modifiers

## Risks

- Overfitting from too many features  
  Mitigation: bounded v1 feature set and walk-forward gates

- Daytime slowdown  
  Mitigation: precompute-first design and strict no-inline-refresh rule

- False confidence from stale calibration  
  Mitigation: freshness metadata plus explicit stale labeling

- Complexity creep  
  Mitigation: stage registry, bounded caps, manual promotion

## Success Metrics

- improved forward outcome quality for top-ranked scanned names versus baseline
- improved BUY/WATCH precision after cost assumptions
- no increase in market-session cron failure rate
- clearer operator context around why names surfaced and whether calibration is fresh

## Optional Follow-Up

- sector-relative ranking expansion
- event-window sensitivity refinements
- richer execution proxy modeling by time-of-day bucket
- broader research attribution dashboards
