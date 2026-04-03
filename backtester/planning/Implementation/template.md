# Implementation Plan - [Project Title]

**Document Status:** Not Started

## Team

| Role | Assignee |
|------|----------|
| Owner(s) | @mention owner |
| Epic | *Include Epic* |
| Tech Spec | [Link to Tech Spec]() |
| PRD | [Link to PRD]() |

---

## Dependency Map

| Vertical | Dependencies | Can Start? |
|----------|-------------|------------|
| V1 — [Name] | None | Start Now |
| V2 — [Name] | V1 | Start after V1 |
| V3 — [Name] | V1, V2 | Start after V1, V2 |

---

## Recommended Execution Order

```text
Week 1: V1 + V2 (parallel — no dependencies)
Week 2: V3 + V4 (parallel — need V1/V2)
Week 3: V5 + V6
Week N: ...
```

---

## Sprint 1 — [Sprint Theme]

### Vertical 1 — [Vertical Name]

**[Repo]: [Brief description of the work]**

*Dependencies: None | Depends on V__*

#### Jira

- Sub-task 1: [Actionable description of the work. Include specific file paths, function names, and what changes.]
- Sub-task 2: [Next piece of work.]
- Sub-task 3: [Continue as needed.]

#### Testing

- [Expected behavior or assertion 1.]
- [Expected behavior or assertion 2.]
- [Expected behavior or assertion 3.]

---

### Vertical 2 — [Vertical Name]

**[Repo]: [Brief description of the work]**

*Dependencies: None | Depends on V__*

#### Jira

- Sub-task 1: [Actionable description.]
- Sub-task 2: [Actionable description.]

#### Testing

- [Expected behavior or assertion 1.]
- [Expected behavior or assertion 2.]

---

## Sprint 2 — [Sprint Theme]

### Vertical 3 — [Vertical Name]

**[Repo]: [Brief description of the work]**

*Dependencies: Depends on V__*

#### Jira

- Sub-task 1: [Actionable description.]
- Sub-task 2: [Actionable description.]

#### Important Planning Notes

*Any gotchas, codebase nuances, or non-obvious constraints the implementer should know.*

#### Testing

- [Expected behavior or assertion 1.]
- [Expected behavior or assertion 2.]

---

*Repeat Sprint / Vertical sections as needed.*

---

## Dependency Notes

### V__ before V__

*Explain why this ordering is required (e.g., codegen depends on schema changes, mutations depend on generated types).*

### V__ before V__

*Continue as needed.*

---

## Scope Boundaries

### In Scope (This Plan)

- [Major deliverable 1]
- [Major deliverable 2]

### External Dependencies

- [Dependency on another team or developer — describe the work and integration point.]

### Integration Points

*Describe how your scope connects to external dependencies (e.g., "reads from X table that Team Y owns").*

---

## Realistic Delivery Notes

*Summarize the sequencing rationale, biggest planning risks, and any assumptions that could change the timeline.*

- **Biggest risks:** [e.g., stale assumptions about file shapes, underestimated codegen work]
- **Assumptions:** [e.g., no CI/CD changes needed, rollout can stay compare-only before enforcement]
