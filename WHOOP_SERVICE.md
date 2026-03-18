# Whoop Service

Whoop integration now runs inside the TypeScript external service package:
`apps/external-service` (`@cortana/external-service`).

## Runtime

- Framework: Hono on Node.js
- Bind: `127.0.0.1:${PORT}` (default `3033`)
- Startup command:
  ```bash
  cd ~/Developer/cortana-external
  pnpm --filter @cortana/external-service start
  ```
- Launchd command path:
  - `launchd-run.sh` -> `pnpm --filter @cortana/external-service start`

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/auth/url` | Returns Whoop authorization URL |
| GET | `/auth/callback` | OAuth callback (token exchange) |
| GET | `/auth/status` | Auth/token readiness status |
| GET | `/whoop/health` | Service/auth health snapshot |
| GET | `/whoop/data` | Full Whoop payload |
| GET | `/whoop/recovery` | Recovery array only |
| GET | `/whoop/recovery/latest` | Latest recovery object |

All routes are unauthenticated on localhost and keep the same contract expected by OpenClaw and downstream digest jobs.

## Auth + Token Storage

- Required env vars:
  - `WHOOP_CLIENT_ID`
  - `WHOOP_CLIENT_SECRET`
  - `WHOOP_REDIRECT_URL` (default `http://localhost:3033/auth/callback`)
- Token file defaults:
  - `whoop_tokens.json`
  - `whoop_data.json`

Token/data paths can be overridden with:
- `WHOOP_TOKEN_PATH`
- `WHOOP_DATA_PATH`

## Behavior Notes

- Automatic token refresh is built in.
- Refresh calls are deduplicated to avoid parallel refresh storms.
- If refresh fails but stale cache exists, the service can return stale data with:
  - `Warning: 110 - "Serving stale Whoop cache after token refresh failure"`

## Verification

```bash
curl -s http://127.0.0.1:3033/auth/url | jq .
curl -s http://127.0.0.1:3033/auth/status | jq .
curl -s http://127.0.0.1:3033/whoop/health | jq .
curl -s http://127.0.0.1:3033/whoop/recovery/latest | jq .
```
