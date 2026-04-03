# Product Requirements Document (PRD) - Decision Brain, Narrative Discovery, And Research Plane

**Document Status:** Draft

## Team

| Role | Assignee |
|------|----------|
| Primary Owner | TBD |
| Epic | BT-W4 Decision Brain, Narrative Discovery, And Research Plane |

---

## Problem / Opportunity

The roadmap correctly identifies that the system should evolve beyond scattered `if / else` gates, but the next step cannot be “replace the engine with an LLM.” The real opportunity is to build a stateful decision core that combines deterministic safety rails with evidence-backed adaptation, intraday context, bounded narrative overlays, and asynchronous research artifacts.

Today, several valuable ingredients already exist:
- regime
- breadth
- macro overlay
- X / Polymarket context
- strategy outputs
- confidence and comparison helpers

But they are not yet unified into a true decision brain with explicit state, memory, uncertainty, and policy separation. The research side also lacks a dedicated asynchronous plane, so future catalyst and narrative enrichment could easily become blocking or operationally messy if it is added ad hoc.

This workstream turns those ingredients into a coherent layer that can think more like a real decision system while remaining:
- bounded
- testable
- explainable
- non-blocking on the hot trading path

---

## Insights

- The right goal is not “less rules.” The right goal is “hard rules for safety, scored evidence for judgment, and memory for adaptation.”
- Narrative sources such as X and Polymarket are valuable, but only when used as discovery, support/conflict, and crowding context. They must never create standalone `BUY` authority.
- Research is a major missing component, but it must run asynchronously beside the main app. The hot path should only read completed research artifacts, never block on deep fetch or summarization jobs.

Problems this workstream is not intending to solve:
- statistical promotion and demotion gates
- benchmark and walk-forward governance
- live broker automation
- semantic-retrieval or vector-database infrastructure
- free-form LLM trade authority

---

## Development Overview

This workstream builds the stateful intelligence layer above the current strategy engine. It introduces a canonical decision-state model, adaptive weighting primitives, multi-timeframe confirmation, bounded intraday authority, bounded narrative overlays, and an asynchronous research plane with hot, warm, and cold lanes.

The implementation should produce a system that can:
- maintain explicit state for regime, breadth, tape, narrative, symbol quality, and position context
- remember prior outcomes and use them to adjust strategy weight, veto strength, and confidence
- distinguish between inactive, watch-only, selective-buy, and unavailable intraday states
- use X and Polymarket to improve discovery and explanation without granting them direct trade authority
- consume research artifacts instantly on the hot path while keeping heavy research work off the market-open critical path

This Development Overview must stay in sync with the matching Tech Spec.

---

## Success Metrics

- A canonical decision-state artifact exists and can be consumed by multiple surfaces without each surface re-deriving its own state.
- Confidence becomes measurably more evidence-backed and less decorative.
- Intraday state can explain when selective-buy is active, suppressed, or unavailable.
- Narrative discovery surfaces can produce:
  - new tickers
  - repeated tickers
  - accelerating tickers
  - crowded tickers
  - theme-to-ticker mappings
- Narrative and research overlays can nudge discovery and confidence while never becoming standalone `BUY` authority.
- Research artifacts are available on the hot path without blocking `cday`, trading cron, `cbreadth`, or live scans.
- Operator surfaces can explain how decision state, narrative context, and research freshness influenced the output.

---

## Assumptions

- W1 and W2 exist or are proceeding in parallel closely enough that this workstream can consume machine-truth contracts and evaluation outputs.
- This workstream can begin in shadow / compare-only mode before it gains authority over actual alert posture.
- The current TS/Python boundary remains intact:
  - TS owns external fetch and provider normalization
  - Python owns analysis, state synthesis, and decision use
- Narrative and research inputs are bounded overlays, not primary signal authority.
- The first iteration should remain interpretable; sophistication without explanation is a failure mode.

---

## Out of Scope

- free-form LLM-generated trade decisions without structured evidence
- direct X- or Polymarket-driven `BUY` outputs
- full governance and promotion gates
- vector DB or semantic retrieval infrastructure
- real-time blocking transcript or catalyst summarization on the market-open path

---

## High Level Requirements

| Requirement | Description | Notes |
|-------------|-------------|-------|
| Canonical decision brain state | The system must promote a shared state model covering market, regime, breadth, narrative, symbol quality, and policy context. | Surfaces should read this state, not invent their own. |
| Adaptive weighting and uncertainty | Strategy weights, veto strength, and confidence must become regime-aware, evidence-backed, and bounded. | Keep hard safety rails. |
| Bounded intraday and narrative authority | Intraday breadth/tape and narrative overlays must have explicit states, ceilings, and non-authority rules. | No narrative-only buys. |
| Asynchronous research plane | Research must run in hot/warm/cold lanes, publish versioned artifacts, and never block the hot decision path. | This is a major architectural requirement. |
| Readable operator truth | The system must explain why decision state, narrative overlays, and research artifacts changed the posture. | The “brain” must remain understandable. |

---

## Detailed User Stories

### Glossary

| Term | Meaning |
|------|---------|
| Decision state | Canonical machine-readable snapshot of regime, breadth, narrative, symbol-quality, and policy context. |
| Adaptive weight | Bounded strategy or overlay influence informed by evidence rather than hardcoded preference alone. |
| Narrative discovery | Use of X, Polymarket, and theme mapping to surface candidates or warnings without granting direct trade authority. |
| Research plane | Asynchronous system that publishes completed research artifacts for the hot path to consume instantly. |
| Selective-buy | Bounded intraday authority state where limited buying is allowed despite a broader defensive regime. |

---

### Canonical Decision Brain State

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As a decision engine, I want one canonical decision-state artifact so that market brief, daytime flow, strategy alerts, and future surfaces all read the same state rather than invent their own logic. | Core coherence requirement. |
| Draft | As an operator, I want the system to explain how regime, breadth, narrative, and uncertainty combined into the final posture so that the engine feels intelligent without becoming opaque. | Prevents “black box” feel. |

---

### Adaptive Weighting And Uncertainty

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As a multi-strategy engine, I want strategy weighting, veto strength, and confidence to adapt by regime, breadth, and settled outcomes so that decisions improve by evidence instead of operator taste. | Must stay bounded and auditable. |
| Draft | As a skeptical maintainer, I want the engine to preserve hard safety rails and never let text reasoning or recent noise overrule clearly unsafe conditions. | Adaptive does not mean unconstrained. |

---

### Bounded Intraday And Narrative Authority

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As an operator, I want explicit intraday states such as inactive, watch-only, selective-buy, and unavailable so that I know how much authority the intraday layer currently has. | Required for trust. |
| Draft | As a discovery system, I want X and Polymarket to surface new names, repeated names, theme support, and crowding warnings without directly manufacturing `BUY` calls. | Discovery and overlay, not direct authority. |

---

### Asynchronous Research Plane

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As a live trading system, I want research artifacts available instantly on the hot path so that I can use them without blocking on deep fetch, scraping, or summarization. | Hot path must remain fast. |
| Draft | As a research maintainer, I want hot/warm/cold lanes with explicit freshness and `known_at` timestamps so that late or stale research does not silently contaminate decisions. | Research quality must be measurable. |

---

### Readable Operator Truth

| Status | User story | Notes |
|--------|------------|-------|
| Draft | As an operator, I want the system to explain when selective-buy is active, why confidence was nudged, why crowding reduced trust, and how stale research affected the posture so that the “brain” remains understandable. | Machine-first, operator-readable. |

---

## Appendix

### Additional Considerations

- This workstream should start in shadow mode where possible.
- Adaptive behavior must be bounded, smoothed, and reversible.
- Research freshness and `known_at` timestamps are non-negotiable.
- If narrative data is noisy or manipulated, the system must degrade toward discovery-only behavior, not accidental authority.

### User Research

The operator has repeatedly pushed toward:
- a system that behaves more like an actual brain
- richer intraday understanding
- research that informs the system without blocking it
- narrative awareness without social-hype-driven buys

This workstream is the architecture response to those needs.

### Open Questions

- Which decision-state fields are mandatory in the first version versus derived later?
- How should the system behave when research artifacts disagree or arrive late?
- Which multi-timeframe confirmations matter enough to ship first without creating an indicator zoo?
- How much adaptive weighting should be visible directly in operator surfaces versus only in detailed artifacts?

### Collaboration Topics

- Governance workstream will consume adaptive-weighting outputs and research-quality metadata.
- Operator-surface workstream will depend on the decision-state contract and research summary outputs.
- TS-owned research and narrative fetchers must preserve producer ownership and normalized contracts for Python.

### Technical Considerations

- Preserve strict separation between deterministic safety rails and adaptive evidence weighting.
- Make the research plane asynchronous from day one.
- Keep decision-state and research artifacts versioned, replayable, and point-in-time safe.
