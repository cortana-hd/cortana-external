# HealthBridge iPhone Setup

`HealthBridge` is the iPhone-side Apple Health producer for Spartan.

It reads Apple Health on-device, builds the current export contract, and sends that payload to:

- `POST /apple-health/import`

inside `cortana-external`.

## Folder Layout

- `HealthBridge/`: SwiftUI iPhone app source
- `HealthBridgeTests/`: iOS unit tests
- `HealthBridge.xcodeproj/`: generated Xcode project
- `project.yml`: XcodeGen source of truth
- `Package.swift`: local package manifest for bridge logic and validation
- `Validation/main.swift`: deterministic CLI validation runner

## Prerequisites

- full Xcode installed
- iPhone running iOS 17 or later
- Apple ID signed into Xcode
- `cortana-external` reachable from the phone

## Generate The Xcode Project

```bash
cd ~/Developer/cortana-external/apps/health-bridge-ios
xcodegen generate
```

This regenerates:

- `HealthBridge.xcodeproj`

## Configure The App

1. Open `HealthBridge.xcodeproj`.
2. Set your signing team and bundle identifier.
3. Build to a real iPhone.
4. Grant Apple Health permissions when prompted.

Set these fields in the app:

- `Server URL`
  Use a reachable LAN IP, DNS name, or Tailscale hostname for the Mac mini. `127.0.0.1` will not work from the phone.
- `API Token`
  Optional. Use this only if `APPLE_HEALTH_API_TOKEN` is configured in `cortana-external`.
- `Device Name`
  Human-readable device label stored in export provenance.
- `Lookback Days`
  Number of recent daily summaries to resend on each sync.

## Validate Without Xcode

Run the deterministic bridge validation locally:

```bash
cd ~/Developer/cortana-external/apps/health-bridge-ios
swift run HealthBridgeValidation
```

This validates:

- config persistence and normalization
- export ordering and rounding
- manual sync behavior
- import payload formatting against the current service contract

## Verify The End-To-End Flow

After syncing from the phone:

```bash
curl -s http://127.0.0.1:3033/apple-health/health | jq .
curl -s http://127.0.0.1:3033/apple-health/data | jq .
```

Then refresh Spartan ingest:

```bash
cd ~/Developer/cortana
npx tsx tools/fitness/morning-brief-data.ts
```

## Operational Notes

- HealthBridge is the producer. `cortana-external` remains the canonical local receiver and file store.
- Background delivery is best effort and depends on iOS wakeups. Manual sync remains available in the app.
- The canonical local file stays:
  - `~/.openclaw/data/apple-health/latest.json`
