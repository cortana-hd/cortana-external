# Technical Specification - Decision Brain, Narrative Discovery, And Research Plane

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Owner(s) | TBD |
| Epic | BT-W4 Decision Brain, Narrative Discovery, And Research Plane |

---

## Development Overview

This workstream builds the stateful intelligence layer above the current strategy engine. It introduces a canonical decision-state model, adaptive weighting primitives, multi-timeframe confirmation, bounded intraday authority, bounded narrative overlays, and an asynchronous research plane with hot, warm, and cold lanes.

The implementation should produce a system that can:
- maintain explicit state for regime, breadth, tape, narrative, symbol quality, and position context
- remember prior outcomes and use them to adjust strategy weight, veto strength, and confidence
- distinguish between inactive, watch-only, selective-buy, and unavailable intraday states
- use X and Polymarket to improve discovery and explanation without granting them direct trade authority
- consume research artifacts instantly on the hot path while keeping heavy research work off the market-open critical path

This Development Overview must stay in sync with the matching PRD.

---

## Data Storage Changes

### Database Changes

#### [NEW] public.decision_state_snapshots_v1

| Constraints | Column Name | Column Type | Notes |
|-------------|-------------|-------------|-------|
| PK | id | uuid | |
| Not Null | decision_key | text | Stable key per decision snapshot. |
| Not Null | schema_version | text | |
| Not Null | producer | text | `advisor`, `market_brief_snapshot`, future decision engine producers. |
| Not Null | generated_at | timestamptz | |
| Nullable | known_at | timestamptz | Point-in-time state anchor. |
| Not Null | health_status | text | |
| Nullable | degraded_reason | jsonb | |
| Nullable | input_provenance | jsonb | |
| Not Null | regime_state | jsonb | |
| Nullable | breadth_state | jsonb | |
| Nullable | tape_state | jsonb | |
| Nullable | narrative_state | jsonb | |
| Nullable | symbol_state | jsonb | |
| Nullable | position_state | jsonb | |
| Nullable | policy_state | jsonb | Entry/hold/trim/exit posture. |

#### [NEW] public.adaptive_weight_snapshots_v1

| Constraints | Column Name | Column Type | Notes |
|-------------|-------------|-------------|-------|
| PK | id | uuid | |
| Not Null | schema_version | text | |
| Not Null | generated_at | timestamptz | |
| Not Null | regime_bucket | text | |
| Nullable | session_bucket | text | |
| Nullable | breadth_bucket | text | |
| Nullable | strategy_weights | jsonb | |
| Nullable | veto_weights | jsonb | |
| Nullable | confidence_adjustments | jsonb | |
| Nullable | uncertainty_penalties | jsonb | |
| Nullable | sample_depth | jsonb | |
| Nullable | bounded_change_rate | jsonb | |

#### [NEW] public.intraday_state_snapshots_v1

| Constraints | Column Name | Column Type | Notes |
|-------------|-------------|-------------|-------|
| PK | id | uuid | |
| Not Null | schema_version | text | |
| Not Null | generated_at | timestamptz | |
| Not Null | session_phase | text | `PREMARKET`, `OPEN`, `AFTER_HOURS`, `CLOSED`. |
| Not Null | intraday_state | text | `inactive`, `watch_only`, `selective_buy`, `unavailable`. |
| Nullable | breadth_metrics | jsonb | |
| Nullable | tape_metrics | jsonb | |
| Nullable | multi_timeframe_context | jsonb | |
| Nullable | override_reason | text | |
| Nullable | warnings | jsonb | |

#### [NEW] public.narrative_discovery_snapshots_v1

| Constraints | Column Name | Column Type | Notes |
|-------------|-------------|-------------|-------|
| PK | id | uuid | |
| Not Null | schema_version | text | |
| Not Null | generated_at | timestamptz | |
| Nullable | known_at | timestamptz | |
| Nullable | new_tickers | jsonb | |
| Nullable | repeated_tickers | jsonb | |
| Nullable | accelerating_tickers | jsonb | |
| Nullable | crowded_tickers | jsonb | |
| Nullable | theme_to_ticker_map | jsonb | |
| Nullable | narrative_support | jsonb | |
| Nullable | narrative_conflict | jsonb | |
| Nullable | confidence_nudge | jsonb | |
| Nullable | crowding_warning | jsonb | |

#### [NEW] public.research_artifact_registry_v1

| Constraints | Column Name | Column Type | Notes |
|-------------|-------------|-------------|-------|
| PK | id | uuid | |
| Not Null | artifact_type | text | `earnings_calendar_snapshot`, `ticker_research_profile`, etc. |
| Not Null | schema_version | text | |
| Not Null | producer | text | TS fetcher or Python synthesizer. |
| Not Null | generated_at | timestamptz | |
| Nullable | known_at | timestamptz | |
| Nullable | freshness_ttl_seconds | integer | |
| Nullable | health_status | text | |
| Nullable | degraded_reason | jsonb | |
| Nullable | payload | jsonb | |

---

## Infrastructure Changes (if any?)

### SNS Topic Changes

No AWS SNS changes are required.

### SQS Queue Changes

No AWS SQS changes are required.

### Cache Changes

- Decision-state and research consumers must preserve `known_at`, freshness TTL, and degraded semantics from source artifacts.
- Narrative and research caches must distinguish:
  - fresh
  - stale-but-usable
  - stale-and-unusable
- Late-arriving research artifacts must not silently replace earlier hot-path decisions without explicit timestamp ordering.

### S3 Changes

No immediate S3 changes are required. Large research bundles or transcript corpora may later become object-storage candidates.

### Secrets Changes

- No new secret type is required for the Python analysis layer itself.
- Any new research fetchers added on the TS side must declare auth model, rate limits, fallback behavior, and degraded semantics explicitly.

### Network/Security Changes

- Python must continue consuming normalized TS-owned provider outputs rather than calling remote providers directly.
- Research-plane fetchers must obey the same ownership boundary and not bypass TS normalization.

---

## Behavior Changes

- The system gains a canonical decision-state artifact that describes why it is defensive, selective, or unavailable.
- Confidence and strategy influence become bounded, evidence-backed, and session/regime aware instead of purely static.
- Intraday breadth and tape move from a narrow override into an explicit intraday authority layer with clear states and ceilings.
- X and Polymarket data can now elevate discovery priority, annotate setups, and warn about crowding, but cannot independently turn a weak setup into a `BUY`.
- Research becomes an asynchronous artifact plane rather than an inline blocking responsibility of the hot trading path.

---

## Application/Script Changes

Primary modules expected to change:

- `backtester/data/confidence.py`
  - adaptive confidence adjustments, uncertainty penalties, calibration inputs
- `backtester/evaluation/comparison.py`
  - strategy comparison and evidence inputs for weighting
- `backtester/data/intraday_breadth.py`
  - explicit state machine, persistence, bounded authority rules
- `backtester/data/polymarket_context.py`
  - normalized theme support/conflict outputs
- `backtester/data/x_sentiment.py`
  - ticker discovery and crowding classification outputs
- `backtester/data/leader_baskets.py`
  - decision-state and research feature inputs where applicable
- `backtester/market_brief_snapshot.py`
  - consume canonical decision-state artifact and research summaries
- `backtester/advisor.py`
  - use decision-state and adaptive-weight outputs instead of ad hoc recomputation

Likely new modules:

- `backtester/decision_brain/state.py`
  - canonical decision-state contract builders
- `backtester/decision_brain/weights.py`
  - adaptive weight computation, smoothing, bounded change rules
- `backtester/decision_brain/memory.py`
  - prior outcome and context summarization for current decisions
- `backtester/decision_brain/multi_timeframe.py`
  - weekly/daily/short-term confirmation helpers
- `backtester/research/artifacts.py`
  - shared research artifact contracts
- `backtester/research/runtime.py`
  - hot/warm/cold lane orchestration helpers on the Python side

Potential TS integration points:

- `tools/market-intel`
- `tools/stock-discovery`
- `apps/external-service/src/market-data/*`
- future TS-owned research fetchers for catalyst or transcript sources

---

## API Changes

### [NEW] Internal decision-state contract

| Field | Value |
|-------|-------|
| **API** | File and/or structured DB artifact contract |
| **Description** | Canonical state artifact describing the market, regime, breadth, narrative, symbol-quality, and policy context at decision time. |
| **Additional Notes** | All surfaces should read from this contract rather than re-derive core state. |

| Field | Detail |
|-------|--------|
| **Authentication** | Internal only |
| **URL Params** | N/A |
| **Request** | N/A |
| **Success Response** | Versioned decision-state payload with provenance, health, and bounded-policy fields. |
| **Error Responses** | Validation failure, stale source ordering failure, or artifact write failure. |

### [NEW] Internal research artifact contract family

| Field | Value |
|-------|-------|
| **API** | File and/or structured DB artifact contract family |
| **Description** | Versioned artifacts for earnings/catalyst calendars, research profiles, transcript summaries, theme summaries, and related research outputs. |
| **Additional Notes** | Hot path reads completed artifacts only. |

| Field | Detail |
|-------|--------|
| **Authentication** | Internal only |
| **URL Params** | N/A |
| **Request** | N/A |
| **Success Response** | Artifact payload plus freshness TTL, `known_at`, health, and degraded semantics. |
| **Error Responses** | Missing artifact, stale artifact, partial refresh, summarization failure, or ordering conflict. |

---

## Process Changes

- Adaptive weighting should begin in shadow mode with artifact writes and comparison-only review before it changes live authority.
- Research-plane jobs must be scheduled so hot-path windows are protected from warm/cold lane contention.
- New narrative or research inputs must declare:
  - producer
  - freshness TTL
  - degraded semantics
  - consumer list
  - non-authority rules
- Operator review should include explicit checks for:
  - overreactive weights
  - noisy narrative nudges
  - stale or late research artifacts

---

## Orchestration Changes

- Hot path:
  - `cday`
  - `cbreadth`
  - trading cron
  - live scans
  must read completed decision-state and research artifacts only.
- Warm lane:
  - scheduled research refresh and theme/ticker mapping
- Cold lane:
  - deep transcript and catalyst studies
- Operator surfaces must remain read-only consumers of canonical state and research artifacts. They must never rescore, invent fallback semantics, or recompute adaptive weights locally.

---

## Test Plan

Unit tests:
- decision-state contract validation
- weight smoothing and bounded change tests
- cold-start and minimum-sample behavior
- uncertainty penalty tests
- multi-timeframe confirmation tests
- intraday-state transition tests
- narrative nudge bound tests
- crowding warning tests
- research freshness and `known_at` ordering tests

Integration tests:
- shadow-mode adaptive weights vs current static outputs
- intraday state agrees with session boundaries and degraded inputs
- X / Polymarket discovery outputs remain discovery-only
- research hot path reads completed artifacts without blocking
- late-arriving research artifact cannot rewrite prior decision-state causality

Replay / regression tests:
- provider cooldown during selective-buy window
- strong tape / weak breadth and broad breadth / weak tape disagreements
- premarket and after-hours behavior stays non-authoritative
- manipulated X burst on illiquid tickers remains bounded
- research artifact conflicts and missing freshness TTL fail safely

Manual validation:
- inspect a broad intraday reversal case
- inspect a crowded ticker with technically valid setup
- inspect a stale research artifact and confirm the surface explains the limitation
- inspect one decision-state payload and ensure all surfaces tell the same story
