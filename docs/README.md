# External Docs

This directory holds the small repo-level docs surface for `cortana-external`.

Top-level source docs are intentionally limited to Mission Control and doc-authoring guidance.

In the LLM wiki model:
- this folder is a tiny raw-source front door
- system-owned raw docs live closer to the code, especially under `backtester/docs/`
- exploratory product/runtime research lives in `../research/`
- `knowledge/` is the compiled wiki/current-truth layer
- `archive/` is for old repo-level notes that should not stay in the active surface

## Layout

- `source/architecture/` - active repo-level docs
- `archive/` - historical repo-wide docs kept out of the active front door

## Start Here

- [Documentation authoring guide](./source/architecture/documentation-authoring-guide.md)
- [Mission Control architecture](./source/architecture/mission-control.md)
- [Polymarket US in Trading Ops](./source/architecture/polymarket-us-trading-ops.md)
- [Research workspace](../research/README.md)
- [Archive guide](./archive/README.md)
- [Knowledge index](../knowledge/README.md)
