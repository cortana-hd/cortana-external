# Backtester Planning Index

This directory turns the roadmap into execution-ready planning artifacts.

Use the documents in this order:

1. [Roadmap](/Users/hd/Developer/cortana-external/backtester/planning/docs/roadmap.md)
2. [Git Workflow Plan](/Users/hd/Developer/cortana-external/backtester/planning/docs/git-workflow.md)
3. PRD for the workstream you are implementing
4. Matching Tech Spec
5. Matching Implementation Plan

The workstreams are deliberately grouped so another LLM or engineer can execute them without reconstructing the full repo history.

## Workstream Map

### W1. Foundations And Runtime Reliability

- PRD: [01-foundations-and-runtime-reliability.md](/Users/hd/Developer/cortana-external/backtester/planning/PRDs/01-foundations-and-runtime-reliability.md)
- Tech Spec: [01-foundations-and-runtime-reliability.md](/Users/hd/Developer/cortana-external/backtester/planning/TechSpecs/01-foundations-and-runtime-reliability.md)
- Implementation Plan: [01-foundations-and-runtime-reliability.md](/Users/hd/Developer/cortana-external/backtester/planning/Implementation/01-foundations-and-runtime-reliability.md)

Covers:
- Phase 0
- Phase 1
- machine contracts
- failure taxonomy
- health semantics
- pre-open readiness gate

### W2. Prediction Loop, Measurement, And Decision Math

- PRD: [02-prediction-loop-and-measurement.md](/Users/hd/Developer/cortana-external/backtester/planning/PRDs/02-prediction-loop-and-measurement.md)
- Tech Spec: [02-prediction-loop-and-measurement.md](/Users/hd/Developer/cortana-external/backtester/planning/TechSpecs/02-prediction-loop-and-measurement.md)
- Implementation Plan: [02-prediction-loop-and-measurement.md](/Users/hd/Developer/cortana-external/backtester/planning/Implementation/02-prediction-loop-and-measurement.md)

Covers:
- Phase 2
- prediction loop
- calibration
- decision math
- opportunity cost
- veto effectiveness

### W3. Trade Lifecycle, Execution, Risk, And Portfolio

- PRD: [03-trade-lifecycle-execution-risk-and-portfolio.md](/Users/hd/Developer/cortana-external/backtester/planning/PRDs/03-trade-lifecycle-execution-risk-and-portfolio.md)
- Tech Spec: [03-trade-lifecycle-execution-risk-and-portfolio.md](/Users/hd/Developer/cortana-external/backtester/planning/TechSpecs/03-trade-lifecycle-execution-risk-and-portfolio.md)
- Implementation Plan: [03-trade-lifecycle-execution-risk-and-portfolio.md](/Users/hd/Developer/cortana-external/backtester/planning/Implementation/03-trade-lifecycle-execution-risk-and-portfolio.md)

Covers:
- Phase 3
- Phase 6
- Phase 7
- entry plans
- execution policy
- paper portfolio
- sizing
- portfolio simulation

### W4. Decision Brain, Narrative Discovery, And Research Plane

- PRD: [04-decision-brain-narrative-and-research-plane.md](/Users/hd/Developer/cortana-external/backtester/planning/PRDs/04-decision-brain-narrative-and-research-plane.md)
- Tech Spec: [04-decision-brain-narrative-and-research-plane.md](/Users/hd/Developer/cortana-external/backtester/planning/TechSpecs/04-decision-brain-narrative-and-research-plane.md)
- Implementation Plan: [04-decision-brain-narrative-and-research-plane.md](/Users/hd/Developer/cortana-external/backtester/planning/Implementation/04-decision-brain-narrative-and-research-plane.md)

Covers:
- Phase 4
- Phase 5
- decision brain layer
- narrative overlays
- intraday breadth evolution
- asynchronous research plane

### W5. Governance, Validation, And Model Promotion

- PRD: [05-governance-validation-and-model-promotion.md](/Users/hd/Developer/cortana-external/backtester/planning/PRDs/05-governance-validation-and-model-promotion.md)
- Tech Spec: [05-governance-validation-and-model-promotion.md](/Users/hd/Developer/cortana-external/backtester/planning/TechSpecs/05-governance-validation-and-model-promotion.md)
- Implementation Plan: [05-governance-validation-and-model-promotion.md](/Users/hd/Developer/cortana-external/backtester/planning/Implementation/05-governance-validation-and-model-promotion.md)

Covers:
- Phase 8
- walk-forward validation
- point-in-time integrity
- leakage checks
- benchmark ladder
- promotion and retirement rules

### W6. Unified Operator Surfaces And Ops Highway

- PRD: [06-operator-surfaces-and-ops-highway.md](/Users/hd/Developer/cortana-external/backtester/planning/PRDs/06-operator-surfaces-and-ops-highway.md)
- Tech Spec: [06-operator-surfaces-and-ops-highway.md](/Users/hd/Developer/cortana-external/backtester/planning/TechSpecs/06-operator-surfaces-and-ops-highway.md)
- Implementation Plan: [06-operator-surfaces-and-ops-highway.md](/Users/hd/Developer/cortana-external/backtester/planning/Implementation/06-operator-surfaces-and-ops-highway.md)

Covers:
- Phase 9
- Ops Highway
- unified decision contracts
- operational runbooks
- deployment/runtime readiness

## Recommended Order

Execution order:

1. W1 Foundations And Runtime Reliability
2. W2 Prediction Loop, Measurement, And Decision Math
3. W3 Trade Lifecycle, Execution, Risk, And Portfolio
4. W4 Decision Brain, Narrative Discovery, And Research Plane
5. W5 Governance, Validation, And Model Promotion
6. W6 Unified Operator Surfaces And Ops Highway

This order is deliberate:
- W1 makes the system truthful and stable
- W2 creates the measurement loop
- W3 turns signals into lifecycle decisions
- W4 makes the system smarter without blocking the hot path
- W5 hardens the science and promotion rules
- W6 unifies the operator experience and long-run operations

## Authoring Rules

For every workstream:
- PRD explains why it matters and what success looks like
- Tech Spec explains how it will be built
- Implementation Plan breaks the work into verticals another LLM can execute

All three documents should stay aligned on:
- scope
- dependencies
- artifacts
- testing
- rollout order
