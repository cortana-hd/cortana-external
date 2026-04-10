# Backtester Current State

The backtester is the active decision engine for market analysis in `cortana-external`.

Current shape:

- Python engine owns the main analysis and operator flow.
- The TypeScript market-data and Polymarket layers provide bounded context and supporting data.
- Operator docs now live under `backtester/docs/source/` by artifact type.
- Planning artifacts stay under `backtester/planning/`.
- Duplicate copies that previously lived under `backtester/planning/docs/` were removed in favor of the canonical source set under `backtester/docs/source/`.
- Polymarket US artifacts now bridge into both the equity backtester and the live Trading Ops operator surface.

Start here:

- [Operator manual](../../../backtester/README.md)
- [Study guide](../../../backtester/docs/source/guide/backtester-study-guide.md)
- [Polymarket + backtester flow](../../../backtester/docs/source/architecture/polymarket-backtester-flow.md)
- [Market-data service reference](../../../backtester/knowledge/reference/market-data-service-reference.md)
