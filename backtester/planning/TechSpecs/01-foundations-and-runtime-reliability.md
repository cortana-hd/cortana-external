# Technical Specification - Foundations And Runtime Reliability

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Owner(s) | TBD |
| Epic | BT-W1 Foundations And Runtime Reliability |

---

## Development Overview

This workstream hardens the runtime contract and truth model of the system. The implementation will introduce versioned machine-readable artifact schemas, explicit health and failure classes, stronger run manifests, and pre-open readiness validation. It will also tighten the boundary between human-readable formatted output and machine-ingested state so downstream systems consume structured truth rather than prose.

The expected result is a system where every major path can clearly answer:
- what inputs were used
- what fallback behavior was used
- whether the result was healthy, degraded-safe, degraded-risky, or failed
- whether the outcome was a valid empty result, a market-gated result, or a broken computation

This Development Overview must stay in sync with the matching PRD.

---

## Data Storage Changes

### Database Changes

Postgres should remain the main structured state store. This workstream should prefer additive schema changes and explicit versioning.

#### [NEW] public.runtime_run_manifests

| Constraints | Column Name | Column Type | Notes |
|-------------|-------------|-------------|-------|
| PK | id | uuid | Stable manifest id. |
| Unique | run_id | text | Human-readable run id for cross-file/debug correlation. |
| Not Null | producer | text | `daytime_flow`, `nightly_discovery`, `trading_cron`, `market_brief_snapshot`, etc. |
| Not Null | schema_version | text | Manifest schema version. |
| Not Null | status | text | `healthy`, `degraded_safe`, `degraded_risky`, `failed`. |
| Not Null | outcome_class | text | `healthy_candidates_found`, `healthy_no_candidates`, `market_gate_blocked`, `analysis_failed`, etc. |
| Not Null | started_at | timestamptz | Run start. |
| Not Null | finished_at | timestamptz | Run finish. |
| Not Null | code_version | text | Git SHA or release marker. |
| Not Null | config_version | text | Hash/version of important config. |
| Nullable | degraded_reason | jsonb | Normalized degraded cause(s). |
| Nullable | input_sources | jsonb | Live vs cache vs emergency fallback. |
| Nullable | stage_timings | jsonb | Stage duration map. |
| Nullable | warnings | jsonb | Structured warnings. |
| Nullable | artifact_refs | jsonb | Paths/ids of related artifacts. |

#### [NEW] public.runtime_readiness_checks

| Constraints | Column Name | Column Type | Notes |
|-------------|-------------|-------------|-------|
| PK | id | uuid | |
| Not Null | check_name | text | `pre_open_canary`, `quote_smoke`, `regime_path`, etc. |
| Not Null | status | text | `pass`, `warn`, `fail`. |
| Not Null | checked_at | timestamptz | |
| Nullable | details | jsonb | Structured evidence. |
| Nullable | manifest_run_id | text | Related run id if applicable. |

#### [UPDATE] Any existing health or status tables

| Constraints | Column Name | Column Type | Notes |
|-------------|-------------|-------------|-------|
| Add | schema_version | text | Required for machine-consumed artifacts mirrored in DB. |
| Add | outcome_class | text | Explicit failure taxonomy class where applicable. |
| Add | degraded_status | text | `none`, `degraded_safe`, `degraded_risky`. |

---

## Infrastructure Changes (if any?)

### SNS Topic Changes

No AWS SNS changes assumed for local-first development.

### SQS Queue Changes

No AWS SQS changes assumed for local-first development.

### Cache Changes

- Add stricter cache metadata for:
  - freshness
  - degraded status
  - known input source
  - known-at timestamp where relevant
- Ensure cache consumers preserve provenance when emitting new derived artifacts.

### S3 Changes

No immediate S3 changes in this workstream. Object storage remains a later Ops Highway feature.

### Secrets Changes

No new secrets required, but readiness checks must be able to classify:
- valid auth
- expired auth
- human action required

### Network/Security Changes

- No external network/security changes required for the first pass.
- Watchdog and pre-open canary may need consistent local permissions/launchd access to inspect service health.

---

## Behavior Changes

- Operator surfaces will display explicit machine-derived health classes.
- Empty but healthy runs will be labeled differently from degraded or failed runs.
- Degraded outputs will include normalized degraded reason text derived from machine fields.
- The market-open lane will gain a readiness gate concept rather than relying on implicit hope.
- `cortana` consumers should be able to rely on typed artifact fields instead of parsing free-form prose.

---

## Application/Script Changes

Core files expected to change:

- `backtester/market_brief_snapshot.py`
  - emit schema-versioned payloads
  - emit normalized health/failure/outcome fields
- `backtester/canslim_alert.py`
  - emit explicit outcome classes
  - separate machine output from operator formatting
- `backtester/dipbuyer_alert.py`
  - same as above
- `backtester/scripts/daytime_flow.sh`
  - emit or reference run manifest
  - preserve machine truth vs prose formatting
- `backtester/scripts/nighttime_flow.sh`
  - same
- `backtester/scripts/market_data_preflight.sh`
  - support readiness-check contract
- `watchdog/watchdog.sh`
  - align on failure classes and readiness semantics
- `apps/external-service`
  - expose health details needed by readiness gate and degraded reason mapping

New or likely new modules/scripts:
- `backtester/evaluation/run_manifest.py`
  - central manifest builder/serializer
- `backtester/evaluation/failure_taxonomy.py`
  - normalized outcome/failure-class logic
- `backtester/scripts/pre_open_canary.sh` or Python equivalent
  - reduced end-to-end trading lane canary

---

## API Changes

### [UPDATE] Market-data health/ops contracts

| Field | Value |
|-------|-------|
| **API** | `GET /market-data/ready`, `GET /market-data/ops` |
| **Description** | Extend machine-readable health detail for readiness gating and degraded reason normalization. |
| **Additional Notes** | Existing endpoints should remain backward-compatible where possible. |

| Field | Detail |
|-------|--------|
| **Authentication** | Local internal service access |
| **URL Params** | None |
| **Request** | None |
| **Success Response** | Includes structured readiness and provider-health details with normalized machine states. |
| **Error Responses** | Explicit failure state rather than ambiguous service-unavailable prose where possible. |

### [NEW] Internal readiness/canary output contract

| Field | Value |
|-------|-------|
| **API** | File/JSON artifact or local internal endpoint, TBD |
| **Description** | Emit a machine-readable pre-open readiness result for trading-lane trust. |
| **Additional Notes** | Does not need to be public HTTP if file-based artifact is cleaner. |

| Field | Detail |
|-------|--------|
| **Authentication** | Internal only |
| **URL Params** | N/A |
| **Request** | N/A |
| **Success Response** | `pass`, `warn`, or `fail` with structured evidence. |
| **Error Responses** | Explicit failure to produce readiness artifact. |

---

## Process Changes

- Introduce schema-review expectations for new machine-consumed artifacts.
- Require every major run path to document:
  - schema version
  - degraded status
  - outcome class
- Add pre-open readiness as a first-class operational process before trusting market-open trading.
- Update PR review norms so formatter/output changes do not bypass machine contract review.

---

## Orchestration Changes

- Cron and wrapper consumers must prefer typed outputs over prose.
- Main `cortana` trading and market-brief flows may need matching parsing adjustments once artifact schema is formalized.
- Watchdog and readiness logic must share a normalized health model.

---

## Test Plan

Unit tests:
- artifact schema generation for:
  - market brief
  - strategy alerts
  - run manifests
- failure taxonomy mapping
- degraded reason mapping
- readiness gate status mapping

Integration tests:
- degraded-safe run produces valid artifact and truthful output
- healthy-empty run produces distinct outcome class
- market-gated run produces distinct outcome class
- analysis failure produces distinct outcome class

E2E / replay-style tests:
- replay historical runs into formatter/consumer paths and confirm correct classification
- pre-open canary reduced path succeeds on healthy local stack
- notifier consumers in `cortana` can distinguish no-data vs failed-data vs no-candidate states

Manual validation:
- simulate provider cooldown
- simulate stale cache use
- simulate auth invalidation
- verify operator prose mirrors machine truth
