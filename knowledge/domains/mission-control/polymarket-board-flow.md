# Mission Control Polymarket Board Flow

This page explains how the Trading Ops Polymarket board updates.

## Main idea

The split is:

- external-service decides what belongs on the board
- the live streamer provides the current numbers
- Mission Control renders snapshots from that backend-owned board

## Main files

- `apps/mission-control/app/api/trading-ops/polymarket/live/stream/route.ts`
- `apps/mission-control/lib/trading-ops-polymarket-live.ts`
- `apps/external-service/src/polymarket/service.ts`
- `apps/external-service/src/polymarket/board.ts`
- `apps/external-service/src/polymarket/focus.ts`

## Snapshot flow

1. The browser opens `GET /api/trading-ops/polymarket/live/stream`.
2. Mission Control keeps an SSE stream open.
3. On each stream tick, Mission Control calls `loadTradingOpsPolymarketLiveData()`.
4. That loader fetches `GET /polymarket/board/live` from external-service.
5. External-service returns one payload containing:
   - pinned markets
   - top event markets
   - top sports markets
   - live bid / ask / last / spread data for those rows
6. Mission Control sends that payload to the browser as a `snapshot`.
7. The UI compares the new snapshot to the previous one and re-renders changed cards.

Short version:

- Mission Control SSE sends snapshots
- external-service builds snapshots
- the browser renders snapshots

## File roles

### `trading-ops-polymarket-live.ts`

Mission Control loader.

It:

- fetches `/polymarket/board/live`
- normalizes the payload into `TradingOpsPolymarketLiveData`
- returns it to the API route and SSE route

### `service.ts`

External-service orchestrator.

Important function:

- `boardLiveHandler()`

It:

1. reads pinned markets
2. gets the current discovery snapshot
3. asks the live streamer for current market data
4. combines everything into one board payload

### `focus.ts`

Candidate discovery layer.

It builds the larger pool of:

- event candidates
- sports candidates

### `board.ts`

Board-selection layer.

It decides which rows become visible.

Rules:

- pinned markets stay separate
- pinned rows are excluded from rotating top boards
- `Top Events` is capped at 5 rows
- `Top Sports` is capped at 5 rows

### `streamer.ts`

Live data layer.

It owns:

- tracked market subscriptions
- private account stream state
- current market snapshots

## Why this is better

Before this change, Mission Control was assembling the board itself.

Now:

- external-service owns board composition
- Mission Control just asks for the current board and renders it

That makes the UI simpler and keeps board-selection logic in one backend place.

## Event-driven vs timer-driven

Current state:

- live card values come from the backend live snapshot state
- board composition is backend-owned
- roster discovery is refreshed in the backend, not in the UI

So the frontend is no longer responsible for “what should be shown.”

## Related source docs

- [Polymarket board source note](../../../docs/source/architecture/polymarket-board-flow.md)
- [Polymarket US source note](../../../docs/source/architecture/polymarket-us-trading-ops.md)
