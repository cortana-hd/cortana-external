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
| POST | `/apple-health/import` | Validates and stores a new Apple Health export as the current local `latest.json` |

## Local Export

- Default export path:
  - `~/.openclaw/data/apple-health/latest.json`
- Override with:
  - `APPLE_HEALTH_DATA_PATH`
- Freshness window:
  - `APPLE_HEALTH_MAX_AGE_HOURS` defaults to `36`
- Optional import auth token:
  - `APPLE_HEALTH_API_TOKEN`
  - when set, `POST /apple-health/import` requires `Authorization: Bearer <token>`

The service validates the export before serving it. A valid export must include:
- `schema_version: 1`
- `generated_at` as an ISO timestamp

Freshness is derived from `generated_at`. If the export is older than the configured freshness window, `/apple-health/data` still serves the payload but adds a stale warning header and `/apple-health/health` reports `degraded`.

## Health Semantics

- `healthy`: schema is valid and the export is within the freshness window
- `degraded`: schema is valid but the export is stale
- `unconfigured`: no local export file exists yet
- `unhealthy`: file is unreadable or fails schema validation

## Import Contract

`POST /apple-health/import` accepts the same JSON export contract that `GET /apple-health/data` later serves.

Minimum payload:

```json
{
  "schema_version": 1,
  "generated_at": "2026-04-06T09:00:00.000Z",
  "days": [
    {
      "date": "2026-04-06",
      "bodyWeightKg": 78.4,
      "steps": 10432,
      "activeEnergyKcal": 612
    }
  ]
}
```

On import, the service normalizes freshness metadata and writes the payload atomically to the configured `latest.json` path.

## iPhone Exporter

The phone-side exporter now lives in:

- `apps/health-bridge-ios`

It is designed to read Apple Health on-device and send the canonical daily export to `POST /apple-health/import`.

Local core validation:

```bash
cd ~/Developer/cortana-external/apps/health-bridge-ios
swift run HealthBridgeValidation
```

Xcode project generation:

```bash
cd ~/Developer/cortana-external/apps/health-bridge-ios
xcodegen generate
```

## Verification

```bash
curl -s http://127.0.0.1:3033/apple-health/health | jq .
curl -s http://127.0.0.1:3033/apple-health/data | jq .

curl -s \
  -X POST http://127.0.0.1:3033/apple-health/import \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${APPLE_HEALTH_API_TOKEN}" \
  --data-binary @/path/to/apple-health-export.json | jq .
```

## iPhone Producer

The native iPhone producer now lives in:

- `apps/health-bridge-ios`

`HealthBridge` reads Apple Health on-device and posts the export payload to `POST /apple-health/import`.

Important operator notes:

- the iPhone must use a reachable host for `serverURL`
- `127.0.0.1` will not work from the phone
- use a LAN IP, DNS name, or Tailscale hostname instead
- if `APPLE_HEALTH_API_TOKEN` is configured, the phone must send the matching bearer token

For setup and validation details, see:

- `apps/health-bridge-ios/SETUP.md`
