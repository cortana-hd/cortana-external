# Product Requirements Document (PRD) - Unified Operator Surfaces And Ops Highway

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Primary Owner | TBD |
| Epic | BT-W6 Unified Operator Surfaces And Ops Highway |

---

## Problem / Opportunity

The roadmap already makes clear that the system is becoming a coherent decision engine, but the operator experience is still distributed across multiple surfaces, wrappers, artifacts, and runtime behaviors. The system can be strong internally while still feeling fragmented externally if each surface speaks a slightly different language, exposes different health semantics, or requires the operator to stitch together multiple artifacts manually.

The opportunity is twofold:

1. unify the operator-facing decision surfaces so the system tells one story at different levels of detail
2. document and later implement the Ops Highway so the Mac-mini deployment becomes safe, understandable, and recoverable over long periods

This workstream makes the engine feel like one product instead of a growing set of adjacent tools.

---

## Insights

- Human trust is lost quickly when `market brief`, `daytime flow`, `trading cron`, and lifecycle summaries disagree or imply different health semantics.
- The Mac mini is enough infrastructure for the current roadmap, but only if the runtime is supervised, backed up, pruned, and measured intentionally.
- Ops work should not displace core backtester work too early, but the roadmap needs the operational lane fully specified now so later implementation is not improvised.

Problems this workstream is not intending to solve immediately:
- inventing new alpha
- replacing existing wrappers with an entirely new UI
- prematurely adding Redis, a vector database, or distributed systems without need
- fully activating Ops Highway before the earlier core workstreams reach a stronger baseline

---

## Development Overview

This workstream unifies the machine-readable decision contract consumed by:
- market brief
- strategy alerts
- daytime flow
- nighttime flow
- trading cron
- future lifecycle and governance summaries

It also formalizes the future Ops Highway for the Mac mini deployment, covering runtime inventory, supervision, health, retention, backup and restore, incident runbooks, capacity thresholds, and change management.

The result should be a system where:
- every operator surface tells the same story using the same machine truth
- each surface differs only in level of detail, not in underlying state
- the operator can inspect runtime health, storage growth, and incident status without guessing
- future operational hardening has a defined execution lane rather than being left to ad hoc fixes

This Development Overview must stay in sync with the matching Tech Spec.

---

## Success Metrics

- A shared operator decision contract exists across market brief, daytime flow, nighttime flow, and trading cron.
- Operator surfaces can all distinguish:
  - healthy candidates found
  - healthy no candidates
  - market gate blocked
  - degraded-safe
  - degraded-risky
  - failed
- The same run should not tell contradictory stories across different surfaces.
- Ops Highway planning artifacts exist for:
  - runtime inventory
  - health and supervision
  - retention and pruning
  - backup and restore
  - incident runbooks
  - capacity thresholds
  - change-management checklists
- When Ops Highway becomes active later, it can be implemented without another architecture rewrite.

---

## Assumptions

- W1-W5 provide the contracts, lifecycle objects, measurement outputs, and governance status this workstream will unify and present.
- Existing operator entry points such as `cday`, `cnight`, `cbreadth`, `cdip`, watchdog, and related cron surfaces remain valid and should be preserved rather than replaced wholesale.
- The Mac mini remains the near-term deployment target.
- Postgres remains the primary structured store; object storage is future archive only; Redis and vector DB remain optional later considerations.
- Ops Highway is documented now but should become an active implementation track only after earlier reliability, measurement, and lifecycle phases are stronger.

---

## Out of Scope

- replacing current operator tools with a browser dashboard
- distributed deployment or multi-host orchestration
- adding infrastructure layers solely because other trading systems use them
- activating all Ops Highway automation immediately before the core decision engine is ready

---

## High Level Requirements

| Requirement | Description | Notes |
|-------------|-------------|-------|
| Shared operator decision contract | All user-facing surfaces must consume a canonical decision contract and shared health semantics. | Formatters may differ; truth may not. |
| Surface-specific renderers | Each surface must stay a read-only consumer of machine truth and render the same state at the right detail level. | No surface-level rescoring. |
| Runtime inventory and health model | The system must specify what runs on the Mac mini, what must always be healthy, and how readiness is judged. | Includes pre-open readiness and canaries. |
| Retention, backup, and incident planning | The system must define how artifacts, logs, backups, and recovery procedures work over long periods. | Future archive layer fits here. |
| Capacity and change discipline | Runtime thresholds, smoke tests, and change checklists must be explicit before the system is considered production-safe. | Part of the Ops Highway. |

---

## Detailed User Stories

### Glossary

| Term | Meaning |
|------|---------|
| Operator decision contract | The canonical machine-readable payload shared by all decision surfaces. |
| Surface renderer | A read-only formatter that turns machine truth into surface-specific prose or compact summaries. |
| Ops Highway | The post-core operational hardening track for running the system safely on the Mac mini. |
| Pre-open gate | Operational readiness result that says whether the live trading lane is trustworthy before the market opens. |
| Runtime inventory | List of services, jobs, artifact families, and ownership needed to keep the system healthy. |

---

### Shared Operator Decision Contract

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As an operator, I want the market brief, daytime flow, trading cron, and future lifecycle surfaces to tell the same underlying story so that I do not need to mentally reconcile contradictory outputs. | Core coherence requirement. |
| Draft | As a maintainer, I want each surface to be a formatter on top of machine truth so that changing prose does not silently break downstream logic. | Required for future extensibility. |

---

### Runtime Inventory And Health Model

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As an operator, I want one place to understand which services and jobs must be healthy on the Mac mini so that runtime debugging is systematic rather than improvised. | Includes `external-service`, Python workflows, Postgres, watchdog, launchd jobs, and artifacts. |
| Draft | As a system owner, I want pre-open readiness and health snapshots so that the open is not the first time I learn the lane is broken. | Builds on W1 readiness work. |

---

### Retention, Backup, And Incident Planning

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As an operator, I want retention, pruning, backup, and restore rules defined before local disk and local-only artifacts become operational debt. | Includes future object-storage archive decision criteria. |
| Draft | As a maintainer, I want runbooks for recurring failures so that common incidents become boring to fix. | Provider cooldown, auth failure, silent Telegram, empty scans, disk growth, etc. |

---

### Capacity And Change Discipline

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As an operator, I want runtime thresholds and smoke-test checklists so that I know when the Mac mini is overloaded or a change is risky. | Operational discipline, not feature logic. |

---

## Appendix

### Additional Considerations

- This workstream is partly product-facing and partly operationally preparatory.
- The shared operator contract should land before any surface-specific redesign.
- The Ops Highway should not become the top implementation priority until the earlier phases are in better shape, but it must be fully specified now.

### User Research

The operator repeatedly asked for:
- clear readable summaries
- truthful degraded wording
- less surface contradiction
- stronger operational reliability on the Mac mini
- explicit future infra guidance without prematurely adding complexity

### Open Questions

- Which operator surfaces should be considered canonical first: market brief + trading cron, or the entire wrapper family at once?
- How much machine detail should be included directly in compact alerts versus linked artifacts only?
- Which runtime health facts need to be visible in day-to-day operator surfaces versus only in runbooks?
- At what retention threshold should cold object storage become active?

### Collaboration Topics

- `cortana` consumers may need contract updates as the shared decision payload becomes more explicit.
- Ops Highway docs may later produce launchd, backup, or prune scripts outside the backtester tree.

### Technical Considerations

- Keep all operator surfaces read-only on top of the canonical contract.
- Keep the Mac-mini runtime intentionally simple until real bottlenecks force change.
- Treat operational safety as a product feature once the system is closer to production use.
