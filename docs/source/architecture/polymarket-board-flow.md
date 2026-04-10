# Polymarket Board Flow

This note explains the live Trading Ops Polymarket board in small pieces.

## Goal

The key split is:

- the backend decides which contracts belong on the board
- the streamer provides the live numbers inside those cards
- Mission Control renders snapshots from that backend-owned board

## Main files

Start with these files:

- `apps/mission-control/app/api/trading-ops/polymarket/live/stream/route.ts`
- `apps/mission-control/lib/trading-ops-polymarket-live.ts`
- `apps/external-service/src/polymarket/service.ts`
- `apps/external-service/src/polymarket/board.ts`
- `apps/external-service/src/polymarket/focus.ts`

## Snapshot flow

The current flow is:

1. The browser opens `GET /api/trading-ops/polymarket/live/stream`.
2. Mission Control keeps that SSE stream open.
3. Every stream tick, Mission Control calls `loadTradingOpsPolymarketLiveData()`.
4. That loader fetches `GET /polymarket/board/live` from external-service.
5. External-service builds one board payload containing:
   - pinned rows
   - top event rows
   - top sports rows
   - live bid / ask / last / spread data for those rows
6. Mission Control sends that payload to the browser as a `snapshot` event.
7. The UI compares the new snapshot to the previous one and re-renders changed cards.

Short version:

- Mission Control SSE sends snapshots
- external-service builds snapshots
- the browser renders snapshots

## What each file does

### `trading-ops-polymarket-live.ts`

This is the Mission Control loader.

Its job is simple now:

- fetch `/polymarket/board/live`
- normalize the payload into `TradingOpsPolymarketLiveData`
- return it to the SSE route and API route

It no longer decides the top 5 event or sports cards itself.

### `service.ts`

This is the external-service orchestrator.

The important function is:

- `boardLiveHandler()`

Its job is to:

1. read pinned markets
2. get the current discovery snapshot
3. ask the live Polymarket streamer for current market data
4. combine all of that into one board payload

Think of `service.ts` as the conductor.

### `focus.ts`

This module discovers candidate markets.

It does the upstream Polymarket discovery work for:

- event candidates
- sports candidates

This is where we build the larger candidate pool that the board can pick from.

### `board.ts`

This module decides what becomes visible on the board.

Important rules:

- pinned markets stay separate
- top events excludes pinned event titles/slugs
- top sports excludes pinned sports titles/slugs
- each board is capped at 5 visible rows

This is the selection layer, not the live-price layer.

### `streamer.ts`

This is still the live data source.

It owns:

- tracked market subscriptions
- private account stream state
- current market snapshots

So:

- `focus.ts` finds candidates
- `board.ts` chooses visible rows
- `streamer.ts` provides current live values

## Why this architecture is better

Before this change, Mission Control was doing too much:

- calling focus discovery logic
- reading pins
- asking for live data
- merging those pieces itself

Now the responsibility is cleaner:

- backend owns board composition
- frontend just asks for the board and renders it

That reduces UI complexity and makes it easier to evolve the board logic later.

## Event-driven vs timer-driven

Right now:

- live values inside the cards are driven by the backend live snapshot state
- the board composition is owned by the backend
- roster discovery is still refreshed on a backend cadence, not in the UI

So this is not fully “only update when markets change” yet.

But it is a major step toward that model because:

- the frontend no longer owns roster refresh logic
- the backend is now the single place where board composition is decided

## Mental model

Use this simple model:

- `focus.ts` = what could be shown
- `board.ts` = what should be shown
- `streamer.ts` = what is happening right now
- `service.ts` = build me the board
- Mission Control SSE = send the board to the browser
