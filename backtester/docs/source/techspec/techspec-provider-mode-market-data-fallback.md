# Technical Specification - Provider Mode Market Data Fallback

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Owner(s) | Cortana trading stack |
| Epic | Provider Mode Market Data Fallback |

---

## Development Overview

This build adds a deterministic provider-mode layer to the existing market-data and backtester stack.

After the change:

- the service and backtester will distinguish between:
  - `schwab_primary`
  - `alpaca_fallback`
  - `cache_fallback`
- quote/history paths will have explicit routing and fallback behavior
- fundamentals and metadata will remain Schwab-first or cache-backed
- operator surfaces will declare provider mode instead of leaving fallback implicit

Affected repos and services:

- `cortana-external`
  - `apps/external-service`
  - `backtester`
  - `apps/mission-control`

What must be deterministic and test-covered:

- provider-mode selection rules
- no mixed-provider price/history artifacts for the same run/subsystem
- route behavior under Schwab REST cooldown
- operator wording and artifact persistence

What remains intentionally unchanged:

- Schwab remains the default provider
- Schwab streamer remains the primary live quote lane
- FRED remains macro-only
- options and crypto are not redesigned in this phase

---

## Data Storage Changes

Describe database, file, cache, or state-shape changes.

### Database Changes

None.

Notes:

- this phase should prefer artifact and payload schema changes over new database tables
- if a database write is added later, it must mirror the same provider-mode fields already present in file artifacts

---

## Infrastructure Changes (if any?)

### SNS Topic Changes

None.

### SQS Queue Changes

None.

### Cache Changes

Add explicit provider-mode metadata to relevant cache and artifact payloads.

Planned file/cache changes:

- market-data route responses may include provider-mode fields
- backtester artifacts such as market brief and strategy alert payloads should persist:
  - `provider_mode`
  - `price_history_provider`
  - `provider_mode_reason`
  - `fallback_engaged`
- if cache is used instead of live Schwab or Alpaca, the degraded reason must still identify the effective mode as cache-backed

### S3 Changes

None.

### Secrets Changes

No new secrets are required for this design itself.

Existing relevant secrets and config:

- Schwab REST credentials
- Schwab streamer credentials
- Alpaca credentials
- FRED API key

### Network/Security Changes

No new third-party provider is being introduced in this phase.

The main network behavior change is internal routing:

- some live quote/history requests that currently fall through to Schwab REST may instead be routed to Alpaca when the active mode is `alpaca_fallback`

---

## Behavior Changes

Describe how behavior changes for users, operators, jobs, or downstream systems.

- market-data consumers will no longer treat provider selection as an implicit implementation detail
- a backtester run will explicitly declare whether its price/history lane was:
  - Schwab primary
  - Alpaca fallback
  - cache fallback
- intraday breadth and similar large quote-batch callers can be routed away from Schwab REST when fallback mode is active
- fundamentals/metadata will not silently switch to Alpaca
- operator surfaces will show when a run stayed pure Schwab versus degraded into another mode

Safe degradation and failure behavior:

- if Schwab REST is cooling down and the active subsystem allows fallback, switch to a declared Alpaca fallback mode for supported quote/history paths
- if the subsystem does not allow Alpaca fallback, degrade to cache or explicit unavailable state
- never mix Schwab price/history rows with Alpaca rows inside the same persisted decision artifact

Declared routing policy:

- provider mode is chosen per subsystem, not strictly per full workflow
- each subsystem must remain internally single-mode for price/history truth
- a workflow that combines subsystem modes must surface itself as `multi_mode` and preserve each subsystem mode explicitly

Approved fallback ladders by data class:

- `live tape / live watchlists`
  - `schwab_streamer -> shared_state -> alpaca -> unavailable`
- `intraday breadth`
  - `schwab_streamer/shared_state -> alpaca -> unavailable`
- `market regime / daily history`
  - `schwab_rest -> recent_schwab_cache -> alpaca -> stale_cache -> unavailable`
- `fundamentals`
  - `schwab_rest -> cache -> unavailable`
- `metadata`
  - `schwab_rest -> cache -> unavailable`

Approved automatic Alpaca fallback surface:

- allowed:
  - `market_brief` tape
  - `live watchlists`
  - `intraday breadth`
  - `clive`
  - `cwatch`
  - `pre_open_canary`
  - `market_regime` history when Schwab REST is down and recent Schwab cache is insufficient
- not allowed in phase 1:
  - `CANSLIM` full scan
  - `Dip Buyer` full scan
  - `fundamentals`
  - `metadata`
  - monolithic `snapshot` enrichment

---

## Application/Script Changes

List new and updated files with exact paths.

New files:

- `/Users/hd/Developer/cortana-external/backtester/docs/source/prd/prd-provider-mode-market-data-fallback.md`
  - product definition for provider-mode and fallback behavior
- `/Users/hd/Developer/cortana-external/backtester/docs/source/techspec/techspec-provider-mode-market-data-fallback.md`
  - implementation-facing specification
- `/Users/hd/Developer/cortana-external/backtester/docs/source/implementation/implementation-provider-mode-market-data-fallback.md`
  - staged execution plan

Updated files:

- `/Users/hd/Developer/cortana-external/apps/external-service/src/market-data/provider-chain.ts`
  - add deterministic provider-mode routing for quote/history and route-safe fallback behavior
- `/Users/hd/Developer/cortana-external/apps/external-service/src/market-data/query-routes.ts`
  - expose provider-mode metadata in quote/history/snapshot responses
- `/Users/hd/Developer/cortana-external/apps/external-service/src/market-data/schwab-rest-client.ts`
  - continue cooldown ownership and provide enough state for provider-mode decisions
- `/Users/hd/Developer/cortana-external/apps/external-service/src/market-data/alpaca-client.ts`
  - remain the Alpaca quote/history adapter used only in supported fallback modes
- `/Users/hd/Developer/cortana-external/backtester/data/market_data_provider.py`
  - add provider-mode awareness and deterministic fallback rules for history/quote callers
- `/Users/hd/Developer/cortana-external/backtester/data/intraday_breadth.py`
  - stop silent Schwab REST fan-out during large quote-batch breadth requests when fallback mode applies
- `/Users/hd/Developer/cortana-external/backtester/data/market_regime.py`
  - allow declared history-provider fallback without hiding the mode
- `/Users/hd/Developer/cortana-external/backtester/data/fundamentals.py`
  - keep Schwab/cache semantics explicit and labeled
- `/Users/hd/Developer/cortana-external/backtester/market_brief_snapshot.py`
  - persist and render provider mode
- `/Users/hd/Developer/cortana-external/backtester/canslim_alert.py`
  - declare provider mode and keep Schwab-only enrichment behavior explicit
- `/Users/hd/Developer/cortana-external/backtester/dipbuyer_alert.py`
  - declare provider mode and allow safe non-mixed fallback where applicable
- `/Users/hd/Developer/cortana-external/backtester/operator_surfaces/runtime_health.py`
  - add provider-mode and cooldown incident clarity
- `/Users/hd/Developer/cortana-external/apps/mission-control/lib/trading-ops.ts`
  - show provider mode for latest trading runs
- `/Users/hd/Developer/cortana-external/apps/mission-control/lib/trading-ops-live.ts`
  - label live state as Schwab primary, fallback, or cache-backed when relevant

LLM-agnostic implementation rule:

- provider ladders, mode transitions, and allowed data-class fallbacks must live in code and config
- no essential provider rule should exist only in prose
- outputs must prefer explicit degraded labeling over guessing continuity

---

## API Changes

Document endpoint or interface changes.

### [UPDATE] Market Data Quote / History Interfaces

| Field | Value |
|-------|-------|
| **API** | `GET /market-data/quote/:symbol`, `GET /market-data/quote/batch`, `GET /market-data/history/:symbol`, `GET /market-data/history/batch`, `GET /market-data/snapshot/:symbol` |
| **Description** | Add explicit provider-mode metadata so consumers know whether the route remained in Schwab primary mode or degraded into another supported mode. |
| **Additional Notes** | The exact payload should remain backward-compatible where possible. |

| Field | Detail |
|-------|--------|
| **Authentication** | Internal/local service |
| **URL Params** | Existing params stay; provider-mode selection may add new internal query or routing controls where justified |
| **Request** | Existing request shape |
| **Success Response** | Existing response plus provider-mode fields such as `providerMode`, `fallbackEngaged`, and `providerModeReason` |
| **Error Responses** | Must still distinguish true unavailable vs degraded fallback vs explicit unsupported mode |

### [UPDATE] Market Data Ops Interface

| Field | Value |
|-------|-------|
| **API** | `GET /market-data/ops` |
| **Description** | Clarify provider cooldown state and surface enough metadata for operator and Mission Control provider-mode explanations. |
| **Additional Notes** | No major shape rewrite needed; additive fields preferred. |

| Field | Detail |
|-------|--------|
| **Authentication** | Internal/local service |
| **URL Params** | None |
| **Request** | None |
| **Success Response** | Existing ops payload plus provider-mode guidance and clearer per-lane state where needed |
| **Error Responses** | Existing service health behavior |

If there are no additional API changes beyond these additive route updates, that should be stated in implementation notes.

---

## Process Changes

Call out workflow, cron, operator, or rollout changes.

- workflow runs such as `cday`, `cop open`, `cop midday`, and trading cron paths should gain explicit provider-mode reporting
- live operator review should distinguish:
  - market opinion
  - provider degradation
- rollout should start with read-only provider-mode labeling before automatic fallback switches become authoritative in production paths

---

## Test Plan

Name the verification surface directly.

Unit and integration coverage:

- `/Users/hd/Developer/cortana-external/apps/external-service/src/__tests__/market-data.test.ts`
- `/Users/hd/Developer/cortana-external/backtester/tests/test_market_data_provider.py`
- `/Users/hd/Developer/cortana-external/backtester/tests/test_intraday_breadth.py`
- `/Users/hd/Developer/cortana-external/backtester/tests/test_market_brief_snapshot.py`
- `/Users/hd/Developer/cortana-external/backtester/tests/test_dipbuyer_alert.py`
- `/Users/hd/Developer/cortana-external/backtester/tests/test_strategy_alert_payloads.py`
- `/Users/hd/Developer/cortana-external/backtester/tests/test_runtime_surfaces.py`
- `/Users/hd/Developer/cortana-external/apps/mission-control/lib/trading-ops.test.ts`
- `/Users/hd/Developer/cortana-external/apps/mission-control/lib/trading-ops-live.test.ts`

Manual or live validation:

- induce or observe a Schwab REST cooldown while the streamer remains healthy
- verify that a breadth-heavy or market-brief run reports an explicit provider mode
- verify that fallback mode does not mix Schwab and Alpaca price/history numbers in the same persisted artifact
- verify that Mission Control and terminal output show the same provider-mode truth for the same run

Success means:

- cooldown days no longer produce ambiguous provider behavior
- fallback runs are explicit and internally consistent
- operator-facing output explains whether a run is a market opinion, a fallback run, or a cache-backed degraded state

---

## Risks / Open Questions

- CANSLIM and other enrichment-heavy flows still depend on Schwab-only fundamentals and metadata, so phase 1 intentionally limits Alpaca fallback to quote/history-oriented subsystems
- Alpaca feed semantics may differ from Schwab enough that fallback thresholds require a shadow comparison window before broader production promotion
- workflow outputs must stay honest if a workflow becomes `multi_mode`; operator wording drift between subsystem and workflow surfaces is still a real risk
