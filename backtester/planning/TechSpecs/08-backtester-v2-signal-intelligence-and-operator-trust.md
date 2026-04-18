# Technical Specification - Backtester V2 Signal Intelligence And Operator Trust

**Document Status:** Complete

## Team

| Role | Assignee |
|------|----------|
| Owner(s) | @hameldesai |
| Epic | BT-V2 Signal Intelligence And Operator Trust |

---

## Development Overview

Backtester V2 strengthens the signal layer before expanding autonomy. The implementation focuses on three changes that must land together:
- a stronger market-representation layer built from price, volume, trend, breadth, realized volatility, relative strength, technical transforms, and regime labels
- a canonical opportunity-score path that optimizes for the 1-5 trading day horizon, then maps into `BUY`, `WATCH`, and `NO_BUY`
- measurement and operator-trust surfaces that separate signal quality from lifecycle noise and make current trust visible in Mission Control

The first release should improve incumbent strategies and add one new strategy family, regime-aware momentum and relative-strength ranking, without turning the system into a black box or silently increasing capital authority.

This Development Overview must stay in sync with the matching PRD.

---

## Data Storage Changes

### Database Changes

#### [NEW] public.backtester_opportunity_score_snapshots_v1

| Constraints | Column Name | Column Type | Notes |
|-------------|-------------|-------------|-------|
| PK | id | uuid | |
| Not Null | schema_version | text | |
| Not Null | generated_at | timestamptz | |
| Nullable | known_at | timestamptz | Point-in-time feature anchor. |
| Not Null | symbol | text | |
| Not Null | strategy_family | text | `canslim`, `dip_buyer`, `regime_momentum_rs`, etc. |
| Not Null | canonical_horizon_days | integer | Fixed to the V2 horizon family, usually `1-5`. |
| Not Null | opportunity_score | numeric | Primary ranking output. |
| Not Null | action_label | text | `BUY`, `WATCH`, `NO_BUY`. |
| Nullable | calibrated_confidence | numeric | |
| Nullable | downside_risk | numeric | Distinct from confidence. |
| Nullable | regime_label | text | |
| Nullable | feature_summary | jsonb | Top-level normalized features. |
| Nullable | benchmark_context | jsonb | Baseline comparisons for review. |
| Nullable | warnings | jsonb | |

#### [NEW] public.backtester_strategy_eval_summaries_v1

| Constraints | Column Name | Column Type | Notes |
|-------------|-------------|-------------|-------|
| PK | id | uuid | |
| Not Null | schema_version | text | |
| Not Null | generated_at | timestamptz | |
| Not Null | strategy_family | text | |
| Not Null | evaluation_window | text | `20`, `50`, `100`, walk-forward slice, etc. |
| Nullable | sample_depth | integer | |
| Nullable | profit_factor | numeric | |
| Nullable | max_drawdown | numeric | |
| Nullable | regime_coverage | jsonb | |
| Nullable | calibration_summary | jsonb | |
| Nullable | benchmark_ladder | jsonb | |
| Nullable | health_status | text | `fresh`, `warming`, `degraded`, `stale`. |
| Nullable | warnings | jsonb | |

### File / Artifact Changes

- Add a versioned opportunity-score artifact family for replay and local inspection.
- Add machine-readable regime-slice evaluation summaries for operator and governance reuse.
- Preserve current prediction and accuracy artifacts; do not replace them until the new score path is stable.

---

## Infrastructure Changes (if any?)

### SNS Topic Changes

No AWS SNS changes are required.

### SQS Queue Changes

No AWS SQS changes are required.

### Cache Changes

- Mission Control should cache V2 trust summaries with explicit freshness semantics.
- Warm startup or incomplete aggregate fetches must render `warming` or `loading`, not `error`, when the system is still converging normally.

### S3 Changes

No S3 changes are required.

### Secrets Changes

No new secret types are required for V2.

### Network/Security Changes

- No new network surface is required.
- Existing provider normalization boundaries should remain intact; V2 should consume normalized market data rather than adding direct provider calls in scoring code.

---

## Behavior Changes

- The system produces a ranked opportunity score first and maps that score into `BUY`, `WATCH`, and `NO_BUY` second.
- Strategy performance is reviewed on a canonical 1-5 day swing horizon instead of loosely mixing horizons.
- Confidence becomes a measured property backed by bucket behavior, not a decorative number.
- Mission Control and other operator surfaces can explain whether the signal layer is fresh, warming, degraded, or stale.
- Current strategy families remain intact while one new family, regime-aware momentum and relative strength, is introduced as the only phase-1 challenger family.

---

## Application/Script Changes

Primary modules expected to change:

- `backtester/data/confidence.py`
  - calibrated confidence updates and bucket logic
- `backtester/data/market_regime.py`
  - canonical regime labeling inputs
- `backtester/data/adverse_regime.py`
  - downside and survivability signals
- `backtester/evaluation/comparison.py`
  - benchmark-aware score comparisons
- `backtester/evaluation/prediction_accuracy.py`
  - action-aware grading aligned to the canonical horizon
- `backtester/evaluation/prediction_contract.py`
  - opportunity-score fields and score-to-action mapping provenance
- `backtester/advisor.py`
  - consume canonical score outputs instead of ad hoc ranking logic
- `backtester/market_brief_snapshot.py`
  - surface V2 trust and freshness semantics
- `backtester/operator_surfaces/mission_control.py`
  - publish score/trust summaries for UI consumption
- `apps/mission-control/components/trading-ops-dashboard.tsx`
  - operator-visible trust and freshness wording
- `apps/mission-control/lib/trading-ops.ts`
  - load new evaluation and trust payloads

Likely new modules:

- `backtester/scoring/opportunity_score.py`
  - canonical score computation and score-to-action mapping
- `backtester/features/core_feature_bundle.py`
  - normalized price/volume/breadth/volatility/relative-strength bundle
- `backtester/evaluation/regime_slices.py`
  - regime-aware evaluation helpers
- `backtester/evaluation/strategy_scorecard.py`
  - reusable strategy summary generation for Mission Control and governance consumers

---

## API Changes

### [NEW] Internal opportunity-score artifact contract

| Field | Value |
|-------|-------|
| **API** | File and/or structured DB artifact contract |
| **Description** | Canonical opportunity-score output per symbol and strategy family, including score, action mapping, risk, confidence, and regime context. |
| **Additional Notes** | This is the primary signal contract for V2. |

| Field | Detail |
|-------|--------|
| **Authentication** | Internal only |
| **URL Params** | N/A |
| **Request** | N/A |
| **Success Response** | Versioned score payload with `opportunity_score`, `action_label`, `calibrated_confidence`, `downside_risk`, and `feature_summary`. |
| **Error Responses** | Validation failure, stale source ordering, or artifact write failure. |

### [NEW] Internal strategy-evaluation summary contract

| Field | Value |
|-------|-------|
| **API** | File and/or structured DB artifact contract |
| **Description** | Rolling strategy summary for profit factor, drawdown, regime coverage, calibration, and benchmark comparisons. |
| **Additional Notes** | Used by Mission Control and future governance work. |

| Field | Detail |
|-------|--------|
| **Authentication** | Internal only |
| **URL Params** | N/A |
| **Request** | N/A |
| **Success Response** | Versioned summary payload with window, metrics, warnings, and freshness status. |
| **Error Responses** | Missing evaluation window, stale summary, or benchmark comparison failure. |

---

## Process Changes

- Roll out V2 scoring in shadow mode first, comparing incumbent action labels with the new score-to-action path.
- Treat feature changes and score changes as one release unit for validation purposes.
- Review V2 trust summaries on a fixed cadence before letting the new score path influence downstream authority.
- Document any difference between signal-quality wins and lifecycle-quality losses so the operator does not misdiagnose alpha as execution noise.

---

## Orchestration Changes

- Add a deterministic step that builds the core feature bundle before score generation.
- Run evaluation summary generation after prediction settlement, not inline on the hot decision path.
- Preserve existing cron and runtime ordering; V2 should fit the current lane before any larger orchestration redesign.

---

## Test Plan

- Unit tests for feature-bundle assembly, score computation, and score-to-action mapping.
- Unit tests for confidence calibration buckets and downside-risk separation.
- Integration tests for `advisor.py` and `market_brief_snapshot.py` consuming the new score contract.
- Integration tests for Mission Control loaders and UI states showing `fresh`, `warming`, `degraded`, and `stale`.
- Regression tests proving that the new regime-aware momentum / relative-strength family remains bounded and benchmark-aware.
- Replay tests that compare old ranking behavior against the new V2 score path without granting new authority automatically.
