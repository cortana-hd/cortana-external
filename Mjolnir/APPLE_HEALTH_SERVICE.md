# Apple Health Service

Apple Health integration runs inside the TypeScript external service package:
`apps/external-service` (`@cortana/external-service`).

## Runtime

- Framework: Hono on Node.js
- Bind: `127.0.0.1:${PORT}` (default `3033`)
- Startup command:
  ```bash
  cd ~/Developer/cortana-external
  pnpm --filter @cortana/external-service start
  ```

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/apple-health/data` | Returns the latest validated Apple Health export |
| GET | `/apple-health/health` | Returns schema and freshness status for the export |

## Local Export

- Default export path:
  - `~/.openclaw/data/apple-health/latest.json`
- Override with:
  - `APPLE_HEALTH_DATA_PATH`
- Freshness window:
  - `APPLE_HEALTH_MAX_AGE_HOURS` defaults to `36`

The service validates the export before serving it. A valid export must include:
- `schema_version: 1`
- `generated_at` as an ISO timestamp

Freshness is derived from `generated_at`. If the export is older than the configured freshness window, `/apple-health/data` still serves the payload but adds a stale warning header and `/apple-health/health` reports `degraded`.

## Health Semantics

- `healthy`: schema is valid and the export is within the freshness window
- `degraded`: schema is valid but the export is stale
- `unhealthy`: file is missing, unreadable, or fails schema validation

## Verification

```bash
curl -s http://127.0.0.1:3033/apple-health/health | jq .
curl -s http://127.0.0.1:3033/apple-health/data | jq .
```
