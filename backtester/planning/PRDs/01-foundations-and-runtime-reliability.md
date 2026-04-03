# Product Requirements Document (PRD) - Foundations And Runtime Reliability

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Primary Owner | TBD |
| Epic | BT-W1 Foundations And Runtime Reliability |

---

## Problem / Opportunity

The current system is materially stronger than it was, but the roadmap makes clear that the entire stack still depends on one non-negotiable truth: the machine path must be trustworthy before higher-order prediction work matters.

Today, degraded provider behavior, stale caches, contract drift, ambiguous empty outputs, and inconsistent failure semantics can still create operator confusion or reduce trust in the system. The opportunity is to make the system causally truthful and operationally predictable before deeper prediction and adaptive logic are promoted.

This workstream exists to establish a hard foundation for every later roadmap item:
- typed artifacts
- explicit health states
- explicit failure taxonomy
- bounded degraded behavior
- pre-open readiness checks
- contract discipline between `cortana-external` and `cortana`

Without this workstream, later work on decision brains, research planes, and lifecycle logic will sit on unreliable ground.

---

## Insights

- The system already has meaningful intelligence, but it still has places where machine truth can be inferred from prose instead of being emitted as typed state. That is not strong enough for a “bulletproof” prediction engine.
- Recent failures showed the same pattern more than once: the human-readable output was not always enough to distinguish `no candidates`, `degraded-safe`, `failed analysis`, or `notify failure`. This is fixable and high leverage.
- Reliability work here is not “ops-only.” It is the enabling layer for every later feature because all later calibration and strategy promotion depend on trustworthy artifacts.

Problems this workstream is not intending to solve:
- deeper prediction quality itself
- research-plane enrichment
- position sizing sophistication
- portfolio-level decision quality
- strategy weighting and challenger promotion logic

---

## Development Overview

This workstream hardens the runtime contract and truth model of the system. The implementation will introduce versioned machine-readable artifact schemas, explicit health and failure classes, stronger run manifests, and pre-open readiness validation. It will also tighten the boundary between human-readable formatted output and machine-ingested state so downstream systems consume structured truth rather than prose.

The expected result is a system where every major path can clearly answer:
- what inputs were used
- what fallback behavior was used
- whether the result was healthy, degraded-safe, degraded-risky, or failed
- whether the outcome was a valid empty result, a market-gated result, or a broken computation

This Development Overview must stay in sync with the matching Tech Spec.

---

## Success Metrics

- 100% of major artifacts emitted by W1 surfaces include `schema_version`, `producer`, `freshness`, and health status.
- 100% of trading/daytime/nighttime/market-brief runs can be machine-classified into explicit outcome states.
- 0 operator-facing cases where a healthy-empty run is indistinguishable from a degraded or failed run.
- Pre-open readiness gate exists and can determine whether the `9:30 ET` trading lane is safe to trust.
- Reduction in manual forensic debugging needed from local run folders for common failure cases.
- Reduction in noisy or contradictory operator messaging during degraded provider conditions.

---

## Assumptions

- The current TS/Python repo boundary remains intact.
- Postgres remains the main structured state store.
- Existing wrapper entrypoints remain the operator surface; this work hardens them rather than replacing them.
- The main `cortana` repo will continue consuming compact machine-readable exports from `cortana-external`.
- This workstream is a prerequisite for deeper model and lifecycle work, so some downstream docs will depend on the artifact and failure contracts defined here.

---

## Out of Scope

- strategy-specific alpha improvements
- prediction calibration logic beyond the health/status fields required for safe downstream use
- research-plane fetchers and summarization
- paper portfolio or broker-aware position management
- semantic retrieval, vector storage, or object storage archive work

---

## High Level Requirements

| Requirement | Description | Notes |
|-------------|-------------|-------|
| Contracted artifact schemas | Every critical artifact family must become versioned and machine-validated. | Includes market brief, run manifests, prediction artifacts, and health-bearing outputs. |
| Explicit health and failure taxonomy | The system must distinguish healthy, degraded-safe, degraded-risky, failed, market-gated, and healthy-empty outcomes. | Must be reflected in artifacts and operator surfaces. |
| Runtime readiness gating | The system must prove readiness for the live trading lane before market open. | Includes a pre-open canary and readiness gate. |
| Truthful degraded behavior | Bounded fallback behavior must carry machine-readable downgrade semantics and audit reasons. | No silent degradation. |
| Human/machine separation | Human-readable summaries must be derived from machine truth, not vice versa. | Required for scalability and safe downstream consumption. |

---

## Detailed User Stories

### Glossary

| Term | Meaning |
|------|---------|
| Healthy-empty | A valid run that found no candidates under current rules. |
| Market-gated | A valid run where the market/regime policy blocked new risk. |
| Degraded-safe | A run that used bounded fallback inputs but still produced a conservative, usable result. |
| Degraded-risky | A run that completed, but data quality is weak enough that output should not be treated as strongly authoritative. |
| Run manifest | A machine-readable summary of what ran, what inputs it used, what degraded, and what artifacts were written. |

---

### Contracted Artifact Schemas

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As a downstream consumer, I want every critical artifact to include schema/version/health metadata so that I can parse it safely without relying on prose. | Applies to `cortana`, wrappers, and future research/lifecycle consumers. |
| Draft | As an operator, I want machine-readable artifact truth to match the human-readable summary so that I can trust what I see. | Prevents “fresh-looking” degraded outputs. |

---

### Explicit Health And Failure Taxonomy

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As an operator, I want the system to distinguish a healthy empty result from a degraded or failed one so I do not misread an empty watchlist as a broken scan. | Core trust requirement. |
| Draft | As a later learning loop, I want all run outcomes categorized explicitly so that research metrics do not mix valid no-candidate runs with genuine compute failures. | Needed for later model evaluation. |

---

### Runtime Readiness Gating

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As an operator, I want a pre-open readiness gate that tells me whether the live trading lane is trustworthy before market open so that I do not discover broken state at 9:30 ET. | Should cover auth, quote smoke, regime path, reduced E2E path. |
| Draft | As watchdog/cron infrastructure, I want a machine-readable readiness result so that downstream alerts can adapt automatically. | Supports future orchestration. |

---

### Truthful Degraded Behavior

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As an operator, I want all degraded outputs to say exactly what was stale or unavailable so I can scale my trust correctly. | No vague “unavailable” messaging. |
| Draft | As a future analyst, I want degraded reason and fallback class embedded in the artifact so I can measure how degraded runs affect decision quality. | Needed for later calibration. |

---

### Human/Machine Separation

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As a platform maintainer, I want machine-state artifacts to be the source of truth and human-readable summaries to be derived formatters so that new surfaces do not multiply parser fragility. | Critical for roadmap scalability. |

---

## Appendix

### Additional Considerations

- This workstream should finish before any major prediction-authority increase.
- It defines the artifact and health semantics later PRDs assume.
- It should include a source-of-truth catalog for which outputs are safe for machine consumption.

### User Research

Operator evidence from recent sessions has repeatedly shown confusion or unnecessary debugging around:
- empty scans vs broken scans
- degraded vs healthy market-brief outputs
- notifier delivery vs compute success
- market-open readiness and provider flapping

### Open Questions

- Which artifact families should be schema-validated first versus later?
- Should schema validation be enforced inside Python only, or also at `cortana` ingestion boundaries?
- Should the readiness gate fail open (informational) or fail closed (blocks alert authority) in early rollout?
- How much of the run manifest should be persisted in Postgres versus file artifacts?

### Collaboration Topics

- Main `cortana` repo may need matching contract updates for safer artifact consumption.
- Watchdog and launchd policy should align with the readiness gate and failure taxonomy.

### Technical Considerations

- Favor additive schemas and explicit versions.
- Keep machine-readable payloads separate from operator prose.
- Use this workstream to define the baseline for later PRDs rather than repeating contract debates in each later spec.
