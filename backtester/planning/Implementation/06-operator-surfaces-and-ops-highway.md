# Implementation Plan - Unified Operator Surfaces And Ops Highway

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Owner(s) | TBD |
| Epic | BT-W6 Unified Operator Surfaces And Ops Highway |
| Tech Spec | [06-operator-surfaces-and-ops-highway.md](/Users/hd/Developer/cortana-external/backtester/planning/TechSpecs/06-operator-surfaces-and-ops-highway.md) |
| PRD | [06-operator-surfaces-and-ops-highway.md](/Users/hd/Developer/cortana-external/backtester/planning/PRDs/06-operator-surfaces-and-ops-highway.md) |

---

## Dependency Map

| Vertical | Dependencies | Can Start? |
|----------|-------------|------------|
| V1 — Shared operator decision contract | W1-W5 contracts available | Start Now |
| V2 — Surface renderer convergence | V1 | Start after V1 |
| V3 — Cross-repo consumer hardening | V1, V2 | Start after V1, V2 |
| V4 — Runtime inventory and health snapshots | W1 readiness and watchdog baseline | Start Now |
| V5 — Retention, backup, and incident planning artifacts | V4 | Start after V4 |
| V6 — Capacity thresholds and change-management checklists | V4, V5 | Start after V4, V5 |

---

## Recommended Execution Order

```text
Week 1: V1 + V4
Week 2: V2
Week 3: V3
Week 4: V5
Week 5: V6
```

---

## Sprint 1 — One Decision Story

### Vertical 1 — Shared Operator Decision Contract

**backtester: define the shared machine-readable payload for all operator surfaces**

*Dependencies: W1-W5 contracts available*

#### Jira

- [x] Sub-task 1: Create a canonical operator payload contract that references decision state, lifecycle state, governance status, health, degraded status, and artifact lineage.
- [x] Sub-task 2: Define which fields are mandatory for all surfaces vs optional for richer surfaces.
- [x] Sub-task 3: Add contract validation and sample fixture payloads for future renderers and cross-repo consumers.

#### Testing

- Operator payload validates with required fields present.
- Payload remains stable across multiple surface use cases.
- Missing source references fail validation.

---

### Vertical 2 — Surface Renderer Convergence

**backtester: make surface-specific renderers read-only consumers of the same truth**

*Dependencies: V1*

#### Jira

- [x] Sub-task 1: Refactor `market_brief_snapshot.py`, local output formatters, and flow summaries to consume the shared operator payload.
- [x] Sub-task 2: Standardize wording for healthy-empty, market-gated, degraded-safe, degraded-risky, and failed outcomes.
- [x] Sub-task 3: Add regression fixtures proving the same run tells the same story across surfaces.

#### Testing

- Surface renderers stay semantically consistent.
- Compact surfaces remain concise without losing truthfulness.
- Formatter-only edits cannot drift from machine truth undetected.

---

## Sprint 2 — Consumer And Runtime Alignment

### Vertical 3 — Cross-Repo Consumer Hardening

**backtester + cortana: protect the operator contract across repository boundaries**

*Dependencies: V1, V2*

#### Jira

- [x] Sub-task 1: Identify every consumer in `cortana` or adjacent tooling that reads backtester/operator payloads.
- [x] Sub-task 2: Add schema-version and compatibility checks so surface changes cannot silently corrupt alerts.
- [x] Sub-task 3: Add replay fixtures or sample payloads for cross-repo verification.

#### Important Planning Notes

- Cross-repo contract drift is an operational risk, not just a formatting issue.
- Consumers should read typed fields, never scrape prose.

#### Testing

- Schema mismatches fail loudly.
- Replay fixtures prove compatibility across versions.
- Alert wording remains truthful after cross-repo changes.

---

### Vertical 4 — Runtime Inventory And Health Snapshots

**backtester + watchdog: define the Mac-mini runtime model and capture health truth centrally**

*Dependencies: W1 readiness and watchdog baseline*

#### Jira

- [x] Sub-task 1: Create a runtime inventory artifact covering services, launchd jobs, scripts, databases, and artifact families.
- [x] Sub-task 2: Add shared runtime-health snapshots that capture pre-open gate, service health, cron health, watchdog health, and delivery health.
- [x] Sub-task 3: Link health snapshots to incident markers and operator inspection paths.

#### Testing

- Runtime inventory is complete and machine-readable.
- Health snapshots preserve timestamps and freshness.
- Pre-open gate state is visible without digging through raw logs.

---

## Sprint 3 — Ops Highway Planning Outputs

### Vertical 5 — Retention, Backup, And Incident Planning Artifacts

**planning + runtime docs: codify storage, backup, and incident procedures before they become debt**

*Dependencies: V4*

#### Jira

- Sub-task 1: Produce retention tables and prune-policy artifacts by artifact family.
- Sub-task 2: Produce backup and restore manifests covering Postgres, configs, tokens, and critical artifacts.
- Sub-task 3: Produce incident markers and runbook references for common failure modes.

#### Testing

- Retention metadata is complete for major artifact families.
- Backup manifests and minimum-viable recovery steps are documented and machine-linkable.
- Common incident types map to runbook references cleanly.

---

### Vertical 6 — Capacity Thresholds And Change-Management Checklists

**planning + runtime docs: make growth and change safer on the Mac mini**

*Dependencies: V4, V5*

#### Jira

- Sub-task 1: Define acceptable runtime thresholds and warning thresholds for major flows.
- Sub-task 2: Define post-merge smoke tests, rollback checklists, and schema-change checklists.
- Sub-task 3: Define trigger conditions for when the Mac mini, local disk, or database shape should be reconsidered.

#### Testing

- Threshold docs cover all major runtime paths.
- Change-management checklists are explicit and reusable.
- Trigger conditions for infra changes remain grounded in observable evidence.

---

## Dependency Notes

### V1 before V2 and V3

No surface or consumer can converge safely until the shared operator contract exists.

### V4 before V5 and V6

Retention, backup, incident, and capacity planning depend on a clear runtime inventory and health model.

---

## Scope Boundaries

### In Scope (This Plan)

- shared operator contract
- renderer convergence
- cross-repo contract hardening
- runtime inventory
- runtime-health snapshots
- retention, backup, incident, capacity, and change-management planning artifacts

### External Dependencies

- earlier workstreams providing stable contracts and readiness signals
- `cortana` consumer updates where cross-repo payload changes are required

### Integration Points

- `backtester/market_brief_snapshot.py`
- `backtester/scripts/*`
- `watchdog/*`
- cross-repo consumers in `cortana`

---

## Realistic Delivery Notes

- **Biggest risks:** surface drift after partial adoption; over-documenting Ops Highway before the core engine is ready; cross-repo payload changes without compatibility checks.
- **Assumptions:** current operator entry points remain the right surface family; Ops Highway can remain partially planning-first until earlier roadmap phases are stronger.

## Update On Every Commit

Each implementation PR under this workstream should update this plan with:
- changed operator payload fields or schema versions
- surfaces migrated to the shared contract
- cross-repo compatibility changes
- new runtime-health, retention, backup, or runbook artifacts added
- any Ops Highway activation changes or deferred items

### Commit Log

- Sprint 1: shared operator payload contract, shared renderers, and surface convergence landed across market brief, lifecycle review, and local formatter entry points.
- Sprint 2: cross-repo compatibility checks, replay fixtures, runtime inventory artifact, and runtime-health snapshots landed with shared artifact families and CLI exporters.
