# Consumer Contracts

This document defines the stable typed subset that downstream consumers should parse from backtester artifacts.

Parse typed machine fields first. Do not scrape operator prose.

## Artifact Families

Current stable families:

- `market_brief`
- `strategy_alert`
- `run_manifest`
- `readiness_check`

Common metadata present on every family:

- `artifact_family`
- `schema_version`
- `producer`
- `status`
- `generated_at`
- `known_at`
- `degraded_status`
- `outcome_class`
- `freshness` when applicable

## Shared Enums

### `status`

- `ok`
- `degraded`
- `error`

### `degraded_status`

- `healthy`
- `degraded_safe`
- `degraded_risky`

Interpretation:

- `healthy`
  - no bounded fallback is active
- `degraded_safe`
  - bounded fallback inputs are active, but the artifact is still safe to consume as a degraded result
- `degraded_risky`
  - live inputs are missing or incomplete enough that the artifact should be treated as risky or failed

## Family-Specific Stable Fields

### `market_brief`

Safe typed fields:

- `session.phase`
- `session.is_regular_hours`
- `status`
- `degraded_status`
- `outcome_class`
- `regime.display`
- `posture.action`
- `tape.primary_source`
- `macro.state`
- `intraday_breadth.override_state`
- `focus.symbols`

Display-only / unstable fields:

- `operator_summary`
- freeform warning strings in `warnings`

### `strategy_alert`

Safe typed fields:

- `strategy`
- `status`
- `degraded_status`
- `outcome_class`
- `summary`
- `signals`
- `inputs.source_counts`
- `inputs.max_input_staleness_seconds`
- `inputs.analysis_error_count`

Display-only / unstable fields:

- `render_lines`
- freeform reason text nested inside signal records

### `run_manifest`

Safe typed fields:

- `run_id`
- `run_kind`
- `started_at`
- `finished_at`
- `status`
- `degraded_status`
- `outcome_class`
- `input_sources`
- `stages`
- `artifacts`

Display-only / unstable fields:

- freeform warning strings in `warnings`

### `readiness_check`

Safe typed fields:

- `check_name`
- `result`
- `ready_for_open`
- `checked_at`
- `status`
- `degraded_status`
- `outcome_class`
- `checks[].name`
- `checks[].result`

Semi-structured evidence:

- `checks[].evidence`

Consumers may read documented keys when present, but should tolerate missing or extra fields there.

## Outcome Classes In Active Use

These are the typed states consumers should prefer over prose:

- `healthy_candidates_found`
- `healthy_no_candidates`
- `market_gate_blocked`
- `degraded_safe`
- `degraded_risky`
- `analysis_failed`
- `run_completed`
- `run_failed`
- `readiness_pass`
- `readiness_warn`
- `readiness_fail`

## Fixture Corpus

Stable replay fixtures live under:

- `/Users/hd/Developer/cortana-external/backtester/tests/fixtures/consumer_contracts`

Those fixtures exist so downstream consumers can test typed parsing without depending on formatter output.
