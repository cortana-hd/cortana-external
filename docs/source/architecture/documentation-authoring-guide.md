# Documentation Authoring Guide

This guide is for any human or LLM adding or updating docs in `cortana-external`.

It is intentionally model-agnostic.

## Core Rule

Put docs in the narrowest place that matches their ownership.

- App-specific docs live near that app.
- Backtester docs live under `backtester/`.
- Repo-wide system docs live under top-level `docs/`.
- Canonical "current truth" pages live under `knowledge/`.

Do not create the same document in multiple places.

## The Two-Layer Model

### 1. Source docs

Source docs are the raw artifacts.

Examples:
- PRDs
- tech specs
- implementation plans
- runbooks
- architecture notes
- migration plans
- guides
- references

These live in repo/app/backtester doc folders.

### 2. Knowledge docs

Knowledge docs are canonical summaries of current truth.

Examples:
- system overviews
- current-state pages
- roadmap landing pages
- indexes

These live under `knowledge/`.

If you update a major source doc and it changes the current truth, update the matching `knowledge/` page too.

## Placement Matrix

### Repo-wide docs

Use top-level `docs/` sparingly.

Top-level source docs are reserved for the smallest shared front door:
- documentation authoring guidance
- Mission Control architecture / repo-level orientation

If a doc is primarily about trading, runtime operations, or backtester behavior, it should not live in root `docs/source/`.

Paths:
- `docs/source/architecture/`
- `docs/archive/`

Examples:
- Mission Control architecture
- documentation placement guidance
- archived repo-wide notes that no longer belong in the active surface

### Mission Control docs

Use `apps/mission-control/docs/` when the doc only belongs to Mission Control.

Paths:
- `apps/mission-control/docs/source/architecture/`
- `apps/mission-control/docs/source/notes/`

Use `architecture/` for durable technical docs.
Use `notes/` for idea dumps or future-work notes.

### Backtester source docs

Use `backtester/docs/source/` for durable backtester docs, including trading PRDs and trading/operator runbooks that used to live at the repo root.

Paths:
- `backtester/docs/source/guide/`
- `backtester/docs/source/architecture/`
- `backtester/docs/source/prd/`
- `backtester/docs/source/reference/`
- `backtester/docs/source/runbook/`
- `backtester/docs/source/roadmap/`

Use:
- `guide/` for conceptual learning docs and handoff docs
- `architecture/` for system flow and design docs
- `prd/` for requirement docs that belong to the backtester/trading docs set
- `reference/` for compact operational or technical reference docs
- `runbook/` for recovery procedures and operator QA playbooks
- `roadmap/` for the main forward plan

### Backtester planning artifacts

Use `backtester/planning/` only for execution-planning artifacts.

Paths:
- `backtester/planning/PRDs/`
- `backtester/planning/TechSpecs/`
- `backtester/planning/Implementation/`
- `backtester/planning/docs/`

Important:
- `PRDs/`, `TechSpecs/`, and `Implementation/` are the authoritative planning artifact folders.
- `backtester/planning/docs/` is only for planning-process docs, workflow docs, or closeout notes.
- Do not recreate copies of roadmap/runbook/reference/guide docs under `backtester/planning/docs/`.

### Canonical knowledge pages

Use `knowledge/` for current-truth summaries and navigation.

Paths:
- `knowledge/domains/backtester/`
- `knowledge/domains/mission-control/`
- `knowledge/domains/integrations/`
- `knowledge/indexes/`

Use these docs to help a new reader or LLM understand:
- what exists now
- where the source docs are
- which pages are canonical

## When To Create A New Doc

Create a new doc when:
- the subject is durable and deserves a stable home
- the content is too large to bolt onto an unrelated existing doc
- the subject has a different purpose than existing docs

Update an existing doc when:
- the information is the same subject and same document type
- you are revising current behavior, not creating a new artifact

Do not create a new doc just because the current one is messy.
Clean the existing doc first unless the document purpose has changed.

## Naming Rules

- Use kebab-case file names.
- Name docs by subject, not by vague date, unless the doc is explicitly a dated closeout or note.
- Keep one subject per file.
- Prefer names like `market-data-service-reference.md` over names like `notes-final-v2.md`.

Allowed exceptions:
- dated closeouts, migration logs, or incident notes
- numbered planning workstreams that already follow a sequence

## Link Rules

- Use relative markdown links for repo-local docs whenever possible.
- Prefer linking to the canonical source path, not to deleted legacy paths.
- After moving docs, update inbound links in READMEs, related docs, and code comments/refs.

## Templates

When creating backtester planning artifacts, start from these templates:

- PRD: `backtester/planning/PRDs/template.md`
- Tech Spec: `backtester/planning/TechSpecs/template.md`
- Implementation Plan: `backtester/planning/Implementation/template.md`

Required rule:
- PRD, Tech Spec, and Implementation Plan for the same workstream must stay aligned on scope, dependencies, testing, and rollout order.

## Recommended Authoring Workflow

For significant new work:

1. Decide whether this is source material or canonical knowledge.
2. Pick the owning area using the placement matrix above.
3. If it is a backtester planning workstream, create PRD + Tech Spec + Implementation Plan from templates.
4. Add or update the relevant source doc.
5. Update the matching `knowledge/` page if current truth changed.
6. Update nearby README/index pages if discovery changed.
7. Verify relative links before finishing.

## Anti-Patterns

Avoid these:

- copying the same doc into both `backtester/docs/` and `backtester/planning/docs/`
- putting app-specific docs in top-level `docs/`
- putting raw planning artifacts in `knowledge/`
- creating "misc" or "random-notes" style folders
- leaving stale links to old paths after moves

## Fast Decision Table

- "This is a repo-wide docs/front-door note" -> `docs/source/architecture/`
- "This is a Mission Control-specific design note" -> `apps/mission-control/docs/source/architecture/`
- "This is a backtester runbook" -> `backtester/docs/source/runbook/`
- "This is a trading/backtester PRD" -> `backtester/docs/source/prd/`
- "This is a backtester PRD/Tech Spec/Implementation Plan" -> `backtester/planning/...`
- "This explains current truth for a whole system" -> `knowledge/domains/...`
- "This is only a planning workflow helper or closeout note" -> `backtester/planning/docs/`
