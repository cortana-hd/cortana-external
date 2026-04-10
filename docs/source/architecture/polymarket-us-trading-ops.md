# Polymarket US in Trading Ops

This page is the repo-level source note for the Polymarket US work that now spans market-intel, external-service, Mission Control, watchdog, and the backtester bridge.

## What shipped

The repo is now on a US-only Polymarket posture.

Shipped surfaces:

- `packages/market-intel` reads and normalizes Polymarket US market data.
- `apps/external-service` owns authenticated account access, focus discovery, live snapshots, pins, and pinned-market results.
- `apps/mission-control` exposes a dedicated `Polymarket` tab inside Trading Ops.
- `watchdog/` monitors Polymarket health alongside the other external-service checks.
- `backtester/` consumes Polymarket market-intel artifacts as context for equity regime and watchlist flows.

## Runtime shape

The current runtime layers are:

1. Public and authenticated Polymarket US access in external-service.
2. A read-mostly Trading Ops surface in Mission Control.
3. Artifact-backed context into the stock-analysis backtester.

Current external-service routes:

- `/polymarket/health`
- `/polymarket/balances`
- `/polymarket/positions`
- `/polymarket/orders`
- `/polymarket/focus`
- `/polymarket/live`
- `/polymarket/results`
- `/polymarket/pins`

Current Mission Control routes:

- `/api/trading-ops/polymarket`
- `/api/trading-ops/polymarket/live`
- `/api/trading-ops/polymarket/live/stream`
- `/api/trading-ops/polymarket/pins`

## Trading Ops UI

Trading Ops now has a dedicated Polymarket tab with:

- `Live stream`
- `Pinned`
- `Top events`
- `Top sports`
- `Account`
- `Signal overlay`
- `Linked watchlist`
- `Results`

Key interaction behavior:

- quote movement uses green/red motion
- roster changes use amber motion
- pinned markets stay live
- top events and top sports are refilled after pinning so the visible boards stay full
- settled pinned markets move into `Results`
- open pinned positions show live economics when the account holds them

## Current boundary

What exists now:

- authenticated account reads
- live market and private websocket-backed snapshots
- pinned-market tracking
- settled/open economics surfaces
- market-intel artifact bridge into the equity stack

What does not exist yet:

- order preview
- order submit/cancel
- operator-side trade thesis packet
- position-sizing and notional guardrails for Polymarket orders

## Source + compiled pages

This page is the raw source note.

Compiled current-truth pages live in:

- `knowledge/domains/integrations/polymarket-us.md`
- `knowledge/domains/mission-control/current-state.md`
- `knowledge/domains/backtester/current-state.md`

Backtester-facing source pages live in:

- `backtester/docs/source/architecture/polymarket-backtester-flow.md`
- `backtester/docs/source/roadmap/polymarket-v2-trade-loop.md`
