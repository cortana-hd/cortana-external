# External Research

This directory is the research workspace for `cortana-external`.

Use it for product and runtime exploration that belongs to this repo, especially:

- backtester research
- Mission Control research
- integration/provider research tied to runtime systems

In the LLM wiki model:

- `research/raw/` stores collected source material
- `research/derived/` stores generated briefs, comparisons, and exploratory outputs
- durable conclusions should be promoted into `docs/` or `knowledge/`

## Layout

- `raw/backtester/` - source material for backtester research
- `raw/mission-control/` - source material for Mission Control research
- `derived/backtester/` - generated analysis and outputs for backtester
- `derived/mission-control/` - generated analysis and outputs for Mission Control

## Rule

Do not use this directory for final current truth.
If something becomes durable and operationally important, promote it into the appropriate source docs or knowledge pages.
