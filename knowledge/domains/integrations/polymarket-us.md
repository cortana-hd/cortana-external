# Polymarket US

This is the compiled current-truth page for the Polymarket US integration in `cortana-external`.

## Current state

Polymarket is now a US-only integration.

The shipped stack has four connected layers:

1. `packages/market-intel` for Polymarket-aware market-intel artifacts.
2. `apps/external-service` for authenticated US account access and live runtime surfaces.
3. `apps/mission-control` for the Trading Ops Polymarket tab.
4. `backtester/` for equity-context consumption of Polymarket artifacts.

## What exists now

### External-service

External-service now exposes:

- account health
- balances
- positions
- open orders
- focus discovery for events and sports
- live snapshots for market and private streams
- pinned-market persistence
- pinned-market results and live economics

### Mission Control

Trading Ops now includes:

- live stream status
- pinned markets
- top events
- top sports
- account
- signal overlay
- linked watchlist
- results

Interaction rules:

- green/red means quote movement
- amber means roster composition changed
- pinned markets stay live while visible
- top boards refill after pinning

### Backtester bridge

The backtester still owns stock decisions.

Polymarket currently acts as:

- macro context
- narrative confirmation/divergence
- linked watchlist enrichment

It is not yet a Polymarket trade-decision engine.

## Current boundary

This integration is read and monitor capable.

It is not yet trade-entry capable from Mission Control.

Missing v2 pieces:

- order preview
- live submit/cancel
- thesis packet
- Polymarket-specific risk controls
- Polymarket trade/postmortem artifact family

## Raw source pages

- [Repo-level source note](../../../docs/source/architecture/polymarket-us-trading-ops.md)
- [Mission Control board flow](../mission-control/polymarket-board-flow.md)
- [Backtester flow source](../../../backtester/docs/source/architecture/polymarket-backtester-flow.md)
- [Polymarket v2 roadmap source](../../../backtester/docs/source/roadmap/polymarket-v2-trade-loop.md)

## Why this matters

The integration now has a real compiled shape instead of living only in chat and scattered README edits.

That matters because Polymarket US is evolving quickly. This page is meant to be the stable place to update:

- what shipped
- what changed
- what remains missing
- what v2 is supposed to become
