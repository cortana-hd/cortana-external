# Product Requirements Document (PRD) - Provider Mode Market Data Fallback

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Primary Owner | Cortana trading stack |
| Epic | Provider Mode Market Data Fallback |

---

## Problem / Opportunity

The trading stack now has a healthy Schwab streamer lane, but the system still enters Schwab REST cooldown.

What exists today:

- `cortana-external` uses the Schwab streamer for live subscribed quotes
- the same system still uses Schwab REST for history, fundamentals, metadata, snapshot enrichment, and quote fallback
- Alpaca already exists in the market-data service as an explicit provider for stock history and stock quotes
- FRED already exists for macro series used by risk signals

What is broken, missing, or unreliable:

- one run can still push enough Schwab REST requests to trigger `provider_cooldown`
- large quote batches, especially breadth-style batches, can silently fall through to Schwab REST when streamer coverage is limited
- the current stack does not have a first-class concept of a run-level provider mode
- if we add fallback casually, we risk mixing Schwab and Alpaca numbers inside one decision payload and lowering operator trust

Why the current state is not good enough:

- cooldown can degrade scans on exactly the days where live market awareness matters most
- empty or degraded scan output can look like a market opinion instead of an operational limitation
- the operator cannot currently tell whether a run was fully Schwab-backed, cache-backed, or using another live provider lane

What opportunity this work unlocks:

- keep Schwab as the primary market-data source and preserve trust in the current stack
- reduce avoidable Schwab REST pressure by shifting selected quote/history workloads to Alpaca only when the run explicitly enters fallback mode
- make provider behavior legible in the backtester, workflow output, and Mission Control

Call out explicit non-goals early:

- this project does not replace Schwab as the primary provider
- this project does not make Alpaca the default truth source for all data
- this project does not blend Schwab and Alpaca values in a single decision payload

---

## Insights

Observed evidence that makes this worth doing:

- live `market-data/ops` showed the streamer healthy while Schwab REST was cooling down at the same time
- the streamer had only `55` active equity subscriptions while quote-batch breadth paths can ask for hundreds of names
- usage metrics showed both lanes active:
  - `schwab_streamer` very high
  - `schwab` still materially high
- intraday breadth currently builds quote batches over the TS-owned base universe plus the growth watchlist, which can silently turn into a large Schwab REST fan-out

Constraints that shape the design:

- the operator wants Schwab to remain the default and trusted source
- the operator does not want mixed-provider numbers in the same run
- Alpaca currently covers stock quotes and stock history, but not the Schwab-only enrichment surfaces we rely on
- FRED is already reserved for macro/economic data, not price rescue

Prior work or repo context that matters:

- `apps/external-service` already has a working dual-lane Schwab design:
  - streamer for live subscribed quotes
  - REST for history, fundamentals, metadata, snapshot fallback
- `apps/external-service` already has Alpaca market-data clients and routes
- `backtester` already has `MarketDataProvider`, `MarketRegimeDetector`, `FundamentalsFetcher`, `intraday_breadth`, and Mission Control operator surfaces

Problems this project is not intended to solve:

- fully replacing Schwab fundamentals or metadata with Alpaca
- changing the trading strategy logic itself
- adding broker execution or order routing

---

## Development Overview

This project introduces an explicit provider-mode layer for trading runs and operator surfaces.

The intended build:

- `cortana-external` remains the main implementation repo
- most implementation will live in:
  - `apps/external-service/src/market-data`
  - `backtester/data`
  - `backtester/operator_surfaces`
  - `apps/mission-control`
- provider choice rules must be deterministic in code, config, and persisted artifacts
- prompt behavior must not decide whether a run used Schwab or Alpaca

The core model:

- `Schwab primary mode`
  - use Schwab streamer, Schwab REST, Schwab cache
  - this is the default for normal operation
- `Alpaca fallback mode`
  - only enter when the run or subsystem explicitly decides Schwab REST is unavailable enough
  - use Alpaca only for quote/history lanes that it can support reliably
  - keep Schwab-only lanes on Schwab or cache
- `FRED macro mode`
  - stays separate and continues to cover only macro/economic series

Intentionally deferred:

- no per-tick browser streaming redesign here
- no full options or crypto provider redesign
- no attempt to force Alpaca into fundamentals/metadata parity

---

## Success Metrics

- `0` mixed-provider price/history decision payloads in a persisted run artifact
- `100%` of persisted run summaries include explicit provider-mode metadata
- `100%` of degraded fallback runs make it clear whether they were:
  - Schwab primary
  - Alpaca fallback
  - cache fallback
- `>= 80%` reduction in quote/history-triggered Schwab REST cooldown incidents during normal live operator flows, measured over a representative observation window
- `0` cases where a provider fallback silently changes the run without operator-visible labeling
- Mission Control and terminal outputs show the same provider-mode truth for the same run

---

## Assumptions

- `cortana-external` remains the repo that owns market-data provider routing and backtester analysis behavior
- Schwab streamer remains healthy enough to be the default live quote lane
- Alpaca credentials and endpoints remain available for stock quote/history fallback
- FRED remains available for macro risk series only
- tests can cover route behavior, provider routing, artifact persistence, and operator output
- rollout will be done in stages, not as an all-at-once provider rewrite

---

## Out of Scope

- replacing Schwab account/trader APIs
- migrating all CANSLIM enrichment to Alpaca
- blending symbol-level data from multiple providers inside a single decision result
- building a new provider abstraction for options or crypto in this phase

---

## High Level Requirements

> **Note:** Include provisioning, access, or environment requirements if they block development.

| Requirement | Description | Notes |
|-------------|-------------|-------|
| [Requirement 1 - Provider Mode Contract](#requirement-1---provider-mode-contract) | Every run and operator surface must declare its provider mode explicitly. | No hidden fallback. |
| [Requirement 2 - Deterministic Routing By Data Class](#requirement-2---deterministic-routing-by-data-class) | Quote/history/fundamentals/metadata paths must have fixed provider ladders. | No ad hoc mixing. |
| [Requirement 3 - Safe Fallback Without Mixed Numbers](#requirement-3---safe-fallback-without-mixed-numbers) | Alpaca fallback must be run-consistent and operator-visible. | The operator already rejected mixed payloads. |

---

## Detailed User Stories

State how the completed system should behave and where users or operators will interact with it.

### Glossary

| Term | Meaning |
|------|---------|
| Provider mode | The declared market-data lane a run used for its price/history truth, such as `schwab_primary` or `alpaca_fallback`. |
| Run-consistent | A run or subsystem uses one declared price/history lane rather than mixing providers field-by-field. |
| Schwab-only lane | A data class such as fundamentals, metadata, or trader/account data that currently depends on Schwab semantics. |
| Fallback mode | An explicit degraded mode entered when Schwab REST is unavailable enough to justify another provider for supported paths. |

---

### Requirement 1 - Provider Mode Contract

| Status | User story | Notes |
|--------|------------|-------|
| Accepted | As an operator, I want every market brief, strategy alert, and workflow summary to state which provider mode it used so that I can trust or challenge the output appropriately. | This must appear in persisted artifacts and user-facing summaries. |
| Accepted | As a developer, I want provider-mode selection encoded in deterministic code and config so that fallback behavior is testable and not hidden in prose. | Must be LLM-agnostic. |
| Accepted | As a Mission Control user, I want to see whether a live or completed run was Schwab primary, Alpaca fallback, or cache-backed so that degraded behavior is easy to interpret. | Same truth in UI and terminal output. |

---

### Requirement 2 - Deterministic Routing By Data Class

| Status | User story | Notes |
|--------|------------|-------|
| Accepted | As a developer, I want quote and history paths to have explicit primary and fallback ladders so that REST cooldown pressure can be reduced without confusing the rest of the stack. | Quote/history can use Alpaca in a controlled way. |
| Accepted | As a strategy owner, I want Schwab-only enrichment paths to remain Schwab-first or cache-backed so that CANSLIM and related logic do not quietly drift to incompatible vendor semantics. | Fundamentals and metadata remain separate from price/history fallback. |
| Accepted | As an operator, I want intraday breadth and market-state surfaces to stop silently converting large quote batches into Schwab REST fan-outs so that live-day reliability improves. | Breadth is a priority caller. |

---

### Requirement 3 - Safe Fallback Without Mixed Numbers

| Status | User story | Notes |
|--------|------------|-------|
| Accepted | As the operator, I want Alpaca fallback to activate only in clearly defined scenarios so that we reduce Schwab cooldown risk without losing trust in the output. | Schwab stays the default. |
| Accepted | As a developer, I want one run or subsystem to use one declared price/history provider mode so that the system never produces blended price/history numbers inside one decision payload. | Per-run or per-subsystem consistency. |
| Accepted | As a reviewer, I want fallback runs to be labeled and replayable so that missed-opportunity or degraded-day investigations can tell whether the issue was strategy logic or provider behavior. | Provider mode should be part of artifacts. |

---

## Appendix

Include any supporting material that helps the next implementer.

### Additional Considerations

This repo should remain LLM agnostic.

That means:

- name exact repos, files, services, and tests when they matter
- provider-mode and fallback rules must live in deterministic code, typed config, or persisted schema fields
- no essential provider-switching behavior should live only in documentation text
- operator wording must reflect actual routing, not inferred intent

### User Research

Observed evidence supporting the project:

- live `market-data/ops` showed streamer healthy while REST was in `provider_cooldown`
- streamer had bounded subscriptions while intraday breadth could request the full S&P base universe plus growth watchlist symbols
- the operator explicitly prefers:
  - Schwab as the default source of truth
  - no mixed Schwab/Alpaca numbers inside the same run
  - explicit fallback labeling

### Resolved Design Decisions

- Provider mode should be selected **per subsystem**, not strictly per full run.
  - Example:
    - `market_brief`: `alpaca_fallback`
    - `strategy_scan`: `schwab_primary`
  - Hard rule: each subsystem must remain internally single-mode for price/history truth.
  - If a workflow contains multiple subsystem modes, the workflow should be labeled `multi_mode` and list the mode used by each subsystem.

- Cache vs Alpaca priority should depend on the data class.
  - Freshness-sensitive paths:
    - `live tape / live watchlists`
      - `schwab_streamer -> shared_state -> alpaca -> unavailable`
    - `intraday breadth`
      - `schwab_streamer/shared_state -> alpaca -> unavailable`
  - Semantics-sensitive paths:
    - `market regime / daily history`
      - `schwab_rest -> recent_schwab_cache -> alpaca -> stale_cache -> unavailable`
    - `fundamentals`
      - `schwab_rest -> cache -> unavailable`
    - `metadata`
      - `schwab_rest -> cache -> unavailable`

- Automatic Alpaca fallback should be limited to workflows and subsystems where quote/history continuity is more important than Schwab-specific enrichment.
  - Allow automatic Alpaca fallback:
    - `market_brief` tape
    - `live watchlists`
    - `intraday breadth`
    - `clive`
    - `cwatch`
    - `pre_open_canary`
    - `market_regime` history when Schwab REST is down and recent Schwab cache is not good enough
  - Do not allow automatic Alpaca fallback yet:
    - `CANSLIM` full scan
    - `Dip Buyer` full scan
    - `fundamentals`
    - `metadata`
    - monolithic `snapshot` enrichment

- Enrichment-heavy flows such as CANSLIM should stay:
  - `schwab_primary`
  - or `cache_fallback`
  - but not `alpaca_fallback` in the first implementation phase

- Alpaca fallback promotion should require a shadow comparison window before production trust is granted.
  - Initial promotion bar:
    - regime agreement `>= 95%`
    - breadth state agreement `>= 90%`
    - no repeated operator-visible contradictions on strong market days

- If a subsystem enters `alpaca_fallback`, it should not attempt to rebuild a blended Schwab-style snapshot from mixed providers.
  - Unsupported fields should be omitted or explicitly marked unavailable.
  - The output should prefer clarity over field completeness.
