# Implementation Plan - Provider Mode Market Data Fallback

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Owner(s) | Cortana trading stack |
| Epic | Provider Mode Market Data Fallback |
| Tech Spec | `../techspec/techspec-provider-mode-market-data-fallback.md` |
| PRD | `../prd/prd-provider-mode-market-data-fallback.md` |

---

## Dependency Map

| Vertical | Dependencies | Can Start? |
|----------|-------------|------------|
| V1 - Provider Mode Contract And Telemetry | None | Start Now |
| V2 - Service Routing And Fallback Ladders | V1 | Start after V1 |
| V3 - Backtester And Mission Control Adoption | V1, V2 | Start after V1, V2 |

---

## Recommended Execution Order

```text
Week 1: V1 contract + ops telemetry + route metadata
Week 2: V2 service routing for quote/history lanes and guarded fallback behavior
Week 3: V3 backtester adoption, operator surfaces, Mission Control, and end-to-end validation
```

---

## Sprint 1 - Make Provider Mode Explicit

### Vertical 1 - Provider Mode Contract And Telemetry

**cortana-external: Define deterministic provider-mode schema and expose it everywhere operators already look.**

*Dependencies: None*

#### Jira

- [x] Sub-task 1: Update `/Users/hd/Developer/cortana-external/apps/external-service/src/market-data/provider-chain.ts` so quote/history/snapshot responses can emit explicit provider-mode metadata.
- [x] Sub-task 2: Update `/Users/hd/Developer/cortana-external/apps/external-service/src/market-data/query-routes.ts` so route responses preserve provider-mode, fallback-engaged, and provider-mode-reason fields.
- [x] Sub-task 3: Update `/Users/hd/Developer/cortana-external/backtester/operator_surfaces/runtime_health.py` and `/Users/hd/Developer/cortana-external/apps/mission-control/lib/trading-ops.ts` so operator surfaces render provider mode instead of inferring it from degraded text.
- [x] Sub-task 4: Add or update tests in `/Users/hd/Developer/cortana-external/apps/external-service/src/__tests__/market-data.test.ts`, `/Users/hd/Developer/cortana-external/backtester/tests/test_runtime_surfaces.py`, and `/Users/hd/Developer/cortana-external/apps/mission-control/lib/trading-ops.test.ts`.

#### Testing

- quote/history route responses include explicit provider-mode fields
- `market-data/ops` still reports cooldown safely and does not lose existing fields
- Mission Control shows provider mode for a mocked Schwab-primary run and a mocked fallback run

---

## Sprint 2 - Route The Right Work To The Right Provider

### Vertical 2 - Service Routing And Fallback Ladders

**cortana-external: Reduce avoidable Schwab REST pressure by adding deterministic fallback only for supported quote/history lanes.**

*Dependencies: Depends on V1*

#### Jira

- [x] Sub-task 1: Update `/Users/hd/Developer/cortana-external/apps/external-service/src/market-data/provider-chain.ts` so supported quote/history paths can enter `alpaca_fallback` mode when Schwab REST is unavailable enough.
- [x] Sub-task 2: Update `/Users/hd/Developer/cortana-external/apps/external-service/src/market-data/alpaca-client.ts` only as needed to support the targeted quote/history ladders already defined by the provider chain.
- [x] Sub-task 3: Keep `/Users/hd/Developer/cortana-external/apps/external-service/src/market-data/provider-chain.ts` and `/Users/hd/Developer/cortana-external/apps/external-service/src/market-data/query-routes.ts` strict about non-supported fallback so fundamentals and metadata remain Schwab-first or cache-backed.
- [x] Sub-task 4: Add or update tests in `/Users/hd/Developer/cortana-external/apps/external-service/src/__tests__/market-data.test.ts` for:
  - Schwab primary mode
  - Alpaca fallback mode
  - cache fallback mode
  - explicit refusal to mix unsupported fundamentals/metadata fallback

#### Important Planning Notes

- The operator explicitly does not want mixed Schwab and Alpaca numbers inside a single decision payload.
- Fallback should be deterministic by data class, not symbol-by-symbol improvisation.
- Breadth and tape are the priority lanes because they can generate large quote-batch pressure.
- Provider mode is selected per subsystem, and workflows that contain more than one subsystem mode must explicitly declare themselves `multi_mode`.

#### Testing

- quote routes use streamer/shared state first and do not hit Schwab REST when not needed
- history routes can switch to Alpaca in a declared fallback mode
- fundamentals/metadata remain Schwab-only or cache-backed
- cooldown-day route responses stay explicit and replayable

---

## Sprint 3 - Make Backtester Runs And UI Honest

### Vertical 3 - Backtester And Mission Control Adoption

**cortana-external: Teach market briefs, strategy alerts, workflows, and Mission Control to persist and display provider mode consistently.**

*Dependencies: Depends on V1, V2*

#### Jira

- [x] Sub-task 1: Update `/Users/hd/Developer/cortana-external/backtester/data/market_data_provider.py`, `/Users/hd/Developer/cortana-external/backtester/data/market_regime.py`, and `/Users/hd/Developer/cortana-external/backtester/data/intraday_breadth.py` so quote/history callers can respect deterministic provider-mode ladders.
- [x] Sub-task 2: Update `/Users/hd/Developer/cortana-external/backtester/market_brief_snapshot.py`, `/Users/hd/Developer/cortana-external/backtester/canslim_alert.py`, and `/Users/hd/Developer/cortana-external/backtester/dipbuyer_alert.py` so persisted artifacts and terminal output include provider-mode truth.
- [x] Sub-task 3: Update `/Users/hd/Developer/cortana-external/apps/mission-control/lib/trading-ops.ts`, `/Users/hd/Developer/cortana-external/apps/mission-control/lib/trading-ops-live.ts`, and related UI files so Mission Control matches the persisted artifacts.
- [x] Sub-task 4: Add or update tests in `/Users/hd/Developer/cortana-external/backtester/tests/test_market_data_provider.py`, `/Users/hd/Developer/cortana-external/backtester/tests/test_intraday_breadth.py`, `/Users/hd/Developer/cortana-external/backtester/tests/test_market_brief_snapshot.py`, `/Users/hd/Developer/cortana-external/backtester/tests/test_dipbuyer_alert.py`, `/Users/hd/Developer/cortana-external/backtester/tests/test_strategy_alert_payloads.py`, and `/Users/hd/Developer/cortana-external/apps/mission-control/lib/trading-ops-live.test.ts`.

#### Important Planning Notes

- This phase should identify where provider mode is best expressed per full run versus per subsystem.
- If a subsystem cannot stay internally consistent under Alpaca fallback, it should stay Schwab/cache only and say so explicitly.
- The first acceptance bar is operator trust, not maximum fallback coverage.

#### Testing

- market brief output shows the correct provider mode
- breadth-heavy runs do not silently present mixed-provider numbers
- Mission Control and terminal output agree on provider mode
- degraded runs remain understandable during live market hours

---

## Dependency Notes

### V1 before V2

Provider-mode routing should not be implemented before the contract and telemetry exist. Otherwise fallback behavior will become another hidden implementation detail.

### V2 before V3

Backtester and Mission Control should adopt provider mode only after the service-level routing rules are stable. Otherwise the UI and artifacts will encode assumptions that later drift from the real route behavior.

---

## Scope Boundaries

### In Scope (This Plan)

- explicit provider-mode schema
- deterministic quote/history fallback ladders
- Schwab-first fundamentals/metadata behavior
- backtester and Mission Control labeling
- automatic Alpaca fallback only for approved quote/history-oriented subsystems

### External Dependencies

- healthy Schwab streamer credentials and runtime
- valid Alpaca credentials for stock quote/history routes
- existing FRED configuration for macro risk data

### Integration Points

- `apps/external-service` market-data routes
- `backtester` strategy, market-state, and operator-surface artifacts
- `apps/mission-control` trading ops views

### Provider Surface Decisions

- Approved automatic Alpaca fallback:
  - `market_brief` tape
  - `live watchlists`
  - `intraday breadth`
  - `clive`
  - `cwatch`
  - `pre_open_canary`
  - `market_regime` history when recent Schwab cache is insufficient
- Explicitly not approved in phase 1:
  - `CANSLIM` full scan
  - `Dip Buyer` full scan
  - `fundamentals`
  - `metadata`
  - monolithic `snapshot` enrichment

---

## Realistic Delivery Notes

State the smallest credible implementation order and the main risks.

- **Biggest risks:** hidden mixed-provider behavior, Alpaca-vs-Schwab data-shape drift, overbroad fallback activating in the wrong workflows
- **Assumptions:** Schwab remains the primary source of truth, and the operator prefers explicit fallback labeling over silent resilience tricks
