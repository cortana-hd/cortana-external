# Mission Control

Next.js + PostgreSQL dashboard for Cortana agents and Trading Ops truth surfaces. Provides a unified view of agents, runs/jobs, alerts/events, and live market ops with shadcn/ui components.

## Stack
- Next.js (App Router, TypeScript)
- shadcn/ui + Tailwind v4
- PostgreSQL + Prisma

## Setup
1) Install deps
```bash
cd apps/mission-control
pnpm install
```
2) Configure the database
```bash
cat > .env.local <<'EOF'
DATABASE_URL=postgresql://hd@localhost:5432/mission_control
EOF
# Update DATABASE_URL for your Postgres instance
# e.g., createdb mission_control
# Required for governance/task reads: CORTANA_DATABASE_URL
# Required for approval notifications: TELEGRAM_BOT_TOKEN
# Optional source/runtime overrides:
#   CORTANA_SOURCE_REPO=/Users/hd/Developer/cortana
#   DOCS_PATH=/Users/hd/Developer/cortana/docs
#   AGENT_MODELS_PATH=/Users/hd/Developer/cortana/config/agent-models.json
#   HEARTBEAT_STATE_PATH=/Users/hd/.openclaw/memory/heartbeat-state.json
#   TELEGRAM_USAGE_HANDLER_PATH=/Users/hd/Developer/cortana/skills/telegram-usage/handler.ts
```
3) Apply schema + seed data (creates agents Huragok, Oracle, Researcher, Librarian, Monitor)
```bash
pnpm db:migrate
pnpm db:seed
```
4) Run the app
```bash
pnpm dev
# open http://localhost:3000
```

## Scripts
- `pnpm dev` — start Next.js dev server
- `pnpm build` / `pnpm start` — production build & manual foreground start
- `pnpm lint` — lint
- `pnpm db:migrate` — apply Prisma migrations
- `pnpm db:deploy` — deploy migrations in production
- `pnpm db:seed` — load starter agents/runs/events
- `pnpm db:generate` — regenerate Prisma client
- `pnpm task-autoclose:post-merge` — close mapped `cortana_tasks` for a merged PR and enforce verification gate
- `pnpm test:task-autoclose` — regression test for PR→task mapping

Use `scripts/restart-mission-control.sh` for the launchd-managed local app.
That path rewrites the LaunchAgent to a direct `next start` entrypoint, clears stale Mission Control `next-server` processes, waits for `/api/heartbeat-status`, and can run the Trading Ops smoke guard.

## Data model (Prisma)
- `Agent`: id, name, role, description, capabilities, status (active/idle/degraded/offline), healthScore, lastSeen, timestamps.
- `Run`: id, agentId (nullable FK), jobType, status (queued/running/completed/failed/cancelled), summary, payload/result JSON, startedAt/completedAt, timestamps.
- `Event`: id, agentId (nullable FK), runId (nullable FK), type, severity (info/warning/critical), message, metadata JSON, createdAt, acknowledged.

## API routes
- `GET /api/dashboard` — aggregated metrics + recent rows
- `GET /api/agents` — agent roster
- `GET /api/runs` — recent runs/jobs
- `GET /api/events` — latest alerts/events
- `GET /api/approvals` / `POST /api/approvals` — list and create approval requests
- `PATCH /api/approvals/:id` — approve/reject/update approval state
- `POST /api/approvals/:id/resume` — resume a paused/approved flow
- `GET /api/council` / `POST /api/council` — list and create council sessions
- `POST /api/council/jobs/deliberate` — council deliberation fanout job
- `GET /api/feedback` / `POST /api/feedback` — feedback item list/create
- `GET /api/feedback/:id` — fetch single feedback item and action history
- `PATCH /api/feedback/:id` — update workflow and remediation fields (`status`, `owner`, `remediationStatus`, `remediationNotes`, `resolvedBy`)
- `GET /api/task-board` — task board slices (ready, blocked, due, pillar rollups, recent outcomes)
- `GET /api/live` — SSE stream for near-live UI refresh ticks
- `GET /api/trading-ops/live` — Trading Ops live summary payload
- `GET /api/trading-ops/live/stream` — Trading Ops SSE stream
- `GET /api/trading-ops/polymarket` — Polymarket Trading Ops summary payload
- `GET /api/trading-ops/polymarket/live` — Polymarket live snapshot
- `GET /api/trading-ops/polymarket/live/stream` — Polymarket SSE stream
- `POST /api/trading-ops/polymarket/pins` / `DELETE /api/trading-ops/polymarket/pins/:marketSlug` — pinned-market mutations
- `POST /api/openclaw/subagent-events` — OpenClaw sub-agent lifecycle ingestion (queued/running/done/failed/timeout/killed)
- `POST /api/github/post-merge-task-autoclose` — webhook endpoint for merged PR task auto-closure + verification gate

## Pages
- `/` — Dashboard with stats, agent health widgets, runs table, and alerts feed
- `/trading-ops` — latest-run truth, live tape, streamer health, watchlists, system health, deep dive, and Polymarket boards
- `/task-board` — Task board cards (Ready now, Blocked, Due soon/Overdue, By pillar, and Recent execution log)
- `/agents` — Agent overview
- `/approvals` — Approvals inbox with Mission Control review flow, Telegram deep links, and resume/execution controls
- `/council` — Council deliberation sessions, member votes, and synthesis rationale
- `/feedback` — Feedback inbox with remediation status, notes/actions, and resolution metrics
- `/jobs` — Runs/jobs list

## Task board data model
- Mission Control reads from the Cortana task queue tables when available: `cortana_tasks` and `cortana_epics` (see `prisma/schema.prisma`).
- Task board reads can use a dedicated Cortana DB URL (`CORTANA_DATABASE_URL`). If unset and `DATABASE_URL` points to `mission_control`, Mission Control automatically tries the same Postgres instance with database `cortana` for task reads to avoid stale adapter copies.
- Enable live sync triggers in Cortana DB:
  ```bash
  export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
  psql cortana -f scripts/sql/task-change-triggers.sql
  ```
- If your Postgres doesn't already expose these tables, running `pnpm db:migrate` will create adapter/read-model tables with the same names/columns:
  - `cortana_epics`: id (serial), title, source, status, deadline, created_at, completed_at, metadata JSONB
  - `cortana_tasks`: id (serial), title, description, priority (1-5), status (text), due_at, remind_at, execute_at, auto_executable, execution_plan, depends_on int[], completed_at, outcome, metadata JSONB, epic_id FK, parent_id FK, assigned_to, source, created_at, updated_at
- Pillar grouping uses `metadata -> 'pillar'` (expected values: Time, Health, Wealth, Career; falls back to Unspecified).
- Ready Now = `status = 'pending'` + `auto_executable = true` + dependencies either empty or all `done`.
- Blocked = `status = 'pending'` with dependencies not marked `done`.
- Due soon = pending + due within 48h; Overdue = pending + due_at in the past.
- Recent outcomes list tasks with `completed_at` or `outcome` populated.

## Realtime + OpenClaw lifecycle bridge
- UI live updates are implemented in `components/auto-refresh.tsx`.
  - Uses `EventSource` against `/api/live` (2s server tick) and falls back to visibility-aware polling.
  - Applied on Dashboard, Jobs, Agents, Agent detail, and Task Board pages.
- OpenClaw lifecycle bridge supports two ingestion paths:
  1) Push webhook adapter in `lib/openclaw-bridge.ts` + `/api/openclaw/subagent-events`
  2) Pull sync adapter in `lib/openclaw-sync.ts` that reads `~/.openclaw/subagents/runs.json` (or `OPENCLAW_SUBAGENT_RUNS_PATH`) and upserts real sub-agent runs into Mission Control on data fetch.
- Reliability/autonomy controls now implemented:
  - **Two-phase launch confirmation**: queued (phase 1) and running (phase 2). Running without prior queue evidence is marked `phase2_running_unconfirmed` and emits warning events.
  - **Stale UI guard + auto-reconcile**: long-running states not present in live run store are auto-marked `stale` and emit `subagent.reconciled_stale` events.
  - **Event-driven live sync**: PostgreSQL LISTEN/NOTIFY (`task_change`) streams `cortana_tasks` / `cortana_epics` inserts, updates, and deletes into Mission Control immediately.
- **Source-of-truth reconciliation job**: fallback guardrail runs every 15 minutes to catch missed updates and surfaces drift warnings when listener is disconnected.
  - **Fallback transparency layer**: Jobs/Agent detail display provider/model/auth path and explicit fallback-path badges when detected in run payload metadata.
  - **Evidence-graded status messaging**: each run gets confidence grade (`high|medium|low`) based on observed lifecycle evidence.
- Upserts runs by `Run.openclaw_run_id`, stores raw lifecycle in `Run.external_status`, and writes `Event` rows (`subagent.<status>`).
- Optional webhook auth: set `OPENCLAW_EVENT_TOKEN` and send `Authorization: Bearer <token>`.

Example local ingestion:
```bash
curl -X POST http://localhost:3000/api/openclaw/subagent-events \
  -H "content-type: application/json" \
  -d '{"runId":"sub-123","status":"queued","agentName":"Huragok","jobType":"mission-control-sync"}'
```

## Trading Ops

Trading Ops is the main market operator surface.

It combines:
- latest-run truth from `mc_trading_runs`
- explicit file fallback when DB-backed truth is unavailable
- live tape and watchlist prices from `/api/trading-ops/live`
- live SSE updates from `/api/trading-ops/live/stream`
- streamer/runtime health from the external service
- a dedicated Polymarket tab for account, pinned markets, top events, top sports, linked watchlists, and results

Primary operator tabs:
- `Overview`
- `Live`
- `Watchlists`
- `System Health`
- `Deep Dive`
- `Polymarket`

Operational notes:
- `DB-backed` means the latest run card came from Mission Control's stored run state
- `fallback` means the card had to fall back to file/artifact truth instead of the preferred DB path
- live quote rows can be `live`, `rest`, `cache`, or degraded depending on provider state
- restart the app with `apps/mission-control/scripts/restart-mission-control.sh`; it uses the launchd direct-start pattern by rewriting the LaunchAgent to a direct `next start` entrypoint, then `kickstart`s the updated agent so stale wrapper processes do not leak Prisma pools

## Live data sources and fallback rules

- Mission Control does not call Schwab or Polymarket directly from the browser.
- The browser-facing boundary is Mission Control itself.
- Mission Control reads live trading data from the external service:
  - `/market-data/quote/batch`
  - `/market-data/ops`
  - Polymarket live endpoints
- If the streamer is down but REST still works, the UI should show that as degraded, not healthy.
- If latest-run DB truth is unavailable, the UI can fall back to artifact truth, but it should say so explicitly.

## Launchd / restart

Preferred local production-style restart:

```bash
./apps/mission-control/scripts/restart-mission-control.sh
```

Manual install/update of the LaunchAgent plist:

```bash
cd apps/mission-control
pnpm exec tsx scripts/install-launch-agent.ts
```

Verification:
- `curl http://127.0.0.1:3000/api/heartbeat-status`
- `pnpm exec tsx scripts/check-trading-ops-smoke.ts`


## Governance integration notes
- Approval notifications use the Telegram Bot API (`TELEGRAM_BOT_TOKEN`) for inline approve/reject UX.
- Council deliberation policy is enforced as **OpenAI `gpt-4o` only** for both member voting and synthesis.
- Council voting calls are made directly from Mission Control to OpenAI (not routed through the OpenClaw gateway).

## Notes
- Migrations are stored in `prisma/migrations`. Update schema in `prisma/schema.prisma`, then run `pnpm db:migrate`.
- Seed data lives in `prisma/seed.ts`; safe to re-run.


### Feedback remediation PATCH API

`PATCH /api/feedback/:id` body:

```json
{
  "remediationStatus": "in_progress",
  "remediationNotes": "Investigating root cause in parser pipeline",
  "resolvedBy": "hamel"
}
```

Rules:
- `remediationStatus` is required and must be one of: `open`, `in_progress`, `resolved`, `wont_fix`
- Returns `404` when the feedback item id does not exist
- When set to `resolved`, `resolved_at` is stamped automatically
