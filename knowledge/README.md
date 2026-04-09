# Knowledge Layer

This directory is the canonical layer for `cortana-external`.

Use it for current truth.
Use the repo `docs/` folders for raw source artifacts.

In the Karpathy-style workflow:
- raw material is collected near ownership boundaries
- the LLM compiles that material into a smaller markdown wiki here
- new outputs should usually add to this layer instead of creating more scattered summary docs elsewhere

## Domains

- [Backtester](./domains/backtester/overview.md)
- [Mission Control](./domains/mission-control/overview.md)
- [Integrations](./domains/integrations/overview.md)

## Indexes

- [Systems index](./indexes/systems.md)

## Rule

When raw docs and knowledge pages disagree, update the knowledge page first and then reconcile the source docs.
