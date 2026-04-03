# Implementation Plan - Foundations And Runtime Reliability

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Owner(s) | TBD |
| Epic | BT-W1 Foundations And Runtime Reliability |
| Tech Spec | [01-foundations-and-runtime-reliability.md](/Users/hd/Developer/cortana-external/backtester/planning/TechSpecs/01-foundations-and-runtime-reliability.md) |
| PRD | [01-foundations-and-runtime-reliability.md](/Users/hd/Developer/cortana-external/backtester/planning/PRDs/01-foundations-and-runtime-reliability.md) |

---

## Dependency Map

| Vertical | Dependencies | Can Start? |
|----------|-------------|------------|
| V1 — Artifact schema baseline | None | Start Now |
| V2 — Failure taxonomy + health model | V1 | Start after V1 |
| V3 — Run manifests | V1, V2 | Start after V1, V2 |
| V4 — Strategy/brief contract wiring | V2, V3 | Start after V2, V3 |
| V5 — Pre-open canary + readiness gate | V2, V3 | Start after V2, V3 |
| V6 — Watchdog/runtime integration | V2, V5 | Start after V2, V5 |
| V7 — Consumer contract hardening | V4, V5 | Start after V4, V5 |

---

## Recommended Execution Order

```text
Week 1: V1 + V2
Week 2: V3 + V4
Week 3: V5 + V6
Week 4: V7 + replay/contract hardening
```

---

## Sprint 1 — Contract Baseline

### Vertical 1 — Artifact Schema Baseline

**backtester: create the shared machine-truth contract for critical artifact families**

*Dependencies: None*

#### Delivery Update

- Vertical complete:
  - shared artifact-contract helpers added under `backtester/evaluation`
  - baseline artifact families defined for market brief, strategy alerts, and run manifests
  - market brief payload now emits baseline machine metadata before formatter logic runs
  - CANSLIM and Dip Buyer now expose structured payload builders and opt-in JSON emission while preserving default text/stdout behavior
  - targeted tests added for serializer validation, market-brief metadata wiring, strategy-alert payload metadata, and JSON emitter behavior
- Deferred to later verticals:
  - run-manifest producer wiring begins in V3
  - normalized outcome taxonomy and failure-class semantics begin in V2

#### Jira

- Sub-task 1: Add a shared schema/constants module under `backtester/evaluation` for artifact metadata fields such as `schema_version`, `producer`, `status`, `outcome_class`, `freshness`, `degraded_status`, and `known_at` where relevant.
- Sub-task 2: Define artifact family names and expected minimum fields for market brief, strategy alerts, and run manifests.
- Sub-task 3: Add helper serializers so new machine artifacts can be emitted consistently before formatter logic runs.

#### Testing

- Shared serializer emits required metadata fields.
- Artifact family constants are reused by multiple producers.
- Missing required schema fields fail tests immediately.

---

### Vertical 2 — Failure Taxonomy + Health Model

**backtester: normalize run health and outcome classes across wrappers, alerts, and research artifacts**

*Dependencies: V1*

#### Delivery Update

- Vertical complete:
  - shared failure-taxonomy module added under `backtester/evaluation`
  - market brief now emits normalized `outcome_class` and `degraded_status` values instead of a generic snapshot placeholder
  - CANSLIM and Dip Buyer now classify `market_gate_blocked`, `healthy_no_candidates`, `healthy_candidates_found`, `degraded_safe`, `degraded_risky`, and `analysis_failed` in machine payloads
  - alert payloads now track `analysis_error_count` so failed-analysis runs stay distinct from legitimate empty results
  - targeted tests added for taxonomy helpers, market-brief degraded-safe/risky classification, and strategy-alert gated/healthy/degraded/failed states
- Deferred to later verticals:
  - formatter wording cleanup for machine-truth branches lands in V4
  - `artifact_failed` and `notify_failed` land with wrappers/manifests and downstream consumers in later verticals

#### Jira

- Sub-task 1: Add a failure-taxonomy module to normalize `healthy_candidates_found`, `healthy_no_candidates`, `market_gate_blocked`, `degraded_safe`, `degraded_risky`, `analysis_failed`, `artifact_failed`, and `notify_failed`.
- Sub-task 2: Update `market_brief_snapshot.py` to emit normalized status and outcome fields.
- Sub-task 3: Update `canslim_alert.py` and `dipbuyer_alert.py` to classify empty/gated/degraded/failed outcomes explicitly.

#### Testing

- Healthy-empty runs do not classify as failures.
- Market-gated runs do not classify as degraded or failed.
- Degraded-safe and degraded-risky stay distinct.

---

## Sprint 2 — Run Truth And Consumer Wiring

### Vertical 3 — Run Manifest Infrastructure

**backtester: add a reusable manifest writer for major runtime paths**

*Dependencies: V1, V2*

#### Jira

- Sub-task 1: Create `run_manifest.py` with write/read helpers and a stable manifest shape.
- Sub-task 2: Wire `daytime_flow.sh`, `nighttime_flow.sh`, and trading/brief-producing paths to emit manifests.
- Sub-task 3: Ensure manifests include stage timings, input source ladder, degraded fallbacks, and artifact references.

#### Testing

- Each producer writes a manifest with required fields.
- Manifests correctly record degraded fallback usage.
- Missing timing/input fields fail tests.

---

### Vertical 4 — Strategy And Brief Contract Wiring

**backtester: separate machine truth from operator prose**

*Dependencies: V2, V3*

#### Jira

- Sub-task 1: Refactor strategy alert producers to build structured payloads before rendering text.
- Sub-task 2: Refactor market brief snapshot formatter so operator prose is derived from machine state, not vice versa.
- Sub-task 3: Add explicit operator wording branches for healthy-empty, market-gated, degraded, and failed cases.

#### Testing

- Formatted text stays aligned with machine truth.
- No operator path says `unavailable` when the machine state is `healthy_no_candidates`.
- Emergency fallback never renders as fresh data.

---

## Sprint 3 — Readiness And Runtime Guardrails

### Vertical 5 — Pre-Open Canary + Readiness Gate

**backtester + external-service: prove the live trading lane before market open**

*Dependencies: V2, V3*

#### Jira

- Sub-task 1: Define the canary scope: service reachable, auth valid, quote smoke pass, regime path pass, reduced end-to-end trading path pass.
- Sub-task 2: Implement a canary script/artifact emitter and store/check result locally.
- Sub-task 3: Expose a machine-readable readiness result usable by cron and operator tooling.

#### Testing

- Healthy stack yields `pass`.
- Provider/auth/service failures yield `warn` or `fail` with explicit evidence.
- Canary failure does not masquerade as “all clear.”

---

### Vertical 6 — Watchdog And Runtime Integration

**watchdog: align restart, alerting, and readiness behavior with the new machine truth**

*Dependencies: V2, V5*

#### Jira

- Sub-task 1: Update watchdog health logic to consume or align with the normalized failure taxonomy.
- Sub-task 2: Ensure brief flaps remain low-noise while hard failures stay loud.
- Sub-task 3: Align pre-open readiness and watchdog escalation rules.

#### Important Planning Notes

- Restart authority must stay bounded.
- Watchdog should not reintroduce noisy cooldown/recovery flapping.

#### Testing

- Hard failures alert immediately.
- Brief cooldowns do not spam.
- Readiness state and watchdog state do not contradict each other.

---

## Sprint 4 — Downstream Consumer Hardening

### Vertical 7 — Consumer Contract Hardening

**cortana + backtester: make downstream parsing depend on typed fields instead of prose**

*Dependencies: V4, V5*

#### Jira

- Sub-task 1: Identify every `cortana` path that consumes backtester output and confirm whether it uses typed machine state vs human prose.
- Sub-task 2: Update consumers to rely on the new artifact metadata fields first.
- Sub-task 3: Add replay fixtures to prove downstream consumers classify empty/gated/degraded/failed runs correctly.

#### Testing

- Backtest notify path distinguishes latest failed run from healthy-empty run.
- Market brief consumers handle degraded-safe vs failed correctly.
- Replay fixtures remain stable across future formatter changes.

---

## Dependency Notes

### V1 before V2

Failure taxonomy is only useful once the artifact schema baseline exists.

### V2 before V4/V5/V6

Readiness, watchdog, and formatter truth all depend on normalized status semantics.

### V3 before V4/V5/V7

Run manifests provide the machine context later consumers and operator surfaces need.

---

## Scope Boundaries

### In Scope (This Plan)

- machine-readable artifact contracts
- failure taxonomy
- run manifests
- readiness gate
- watchdog/runtime alignment
- downstream consumer truthfulness

### External Dependencies

- `cortana` consumer updates for any changed artifact shape
- existing external-service health endpoints remaining available or being extended safely

### Integration Points

- `cortana` trading and market-brief cron consumption
- watchdog health checks
- TS market-data health and ops endpoints

---

## Realistic Delivery Notes

- **Biggest risks:** contract drift between Python producers and `cortana` consumers; too much scope in one pass; under-specified failure semantics.
- **Assumptions:** no new infrastructure beyond Postgres/local artifacts is needed; machine-readable contracts can be introduced additively; readiness can start as advisory before it becomes authoritative.

## Update On Every Commit

Each implementation PR under this workstream should update this plan with:
- shipped artifact schemas or manifest fields
- changed failure-taxonomy semantics or status names
- new readiness checks or watchdog/runtime integrations added
- new replay fixtures or consumer compatibility checks added
- blocked dependencies, rollout changes, or deviations from the original sequencing
