# Health Bridge iPhone Exporter

Health Bridge is the phone-side Apple Health exporter for Spartan.

It reads HealthKit on-device, builds the current `schema_version: 1` daily export contract, and sends it to:

- `POST /apple-health/import`

That means the phone app now matches the file-based Apple Health path already used by `cortana-external` and `cortana`.

## What It Exports

Per day, Health Bridge collects the metrics Spartan currently consumes best:

- `steps`
- `activeEnergyKcal`
- `restingEnergyKcal`
- `walkingRunningDistanceKm`
- `bodyWeightKg`
- `bodyFatPct`
- `leanMassKg`

It writes them into the canonical payload shape served later by:

- `GET /apple-health/data`
- `GET /apple-health/health`

## Local Validation

You can validate the shared exporter core on a machine without full Xcode by running:

```bash
cd ~/Developer/cortana-external/apps/health-bridge-ios
swift run HealthBridgeValidation
```

That validates:

- config persistence and lookback-day handling
- export payload sorting and rounding
- Home view-model sync behavior
- import payload construction against the live Apple Health contract

## Generating The Xcode Project

This repo includes `project.yml`, so you do not need to create the project by hand.

Run:

```bash
cd ~/Developer/cortana-external/apps/health-bridge-ios
xcodegen generate
```

This will create `HealthBridge.xcodeproj`.

## Xcode Prerequisites

- Xcode 15 or later
- Apple ID signed in to Xcode
- iPhone running iOS 17+ for real HealthKit access

HealthKit does not work in the simulator, so final sync validation must happen on a physical iPhone.

## First Device Run

1. Open `HealthBridge.xcodeproj` in Xcode.
2. Set your signing team and a unique bundle identifier if needed.
3. Build and run on your iPhone.
4. Grant HealthKit access when prompted.
5. In Settings, enter:
   - the Mac mini service URL, for example `http://192.168.x.x:3033`
   - `APPLE_HEALTH_API_TOKEN` if you configured one on the server
   - a device name
   - the desired lookback window
6. Tap `Test Connection`.
7. Tap `Sync Apple Health`.

## Server Checklist

Before the iPhone app can sync successfully:

1. `cortana-external` must be running.
2. `POST /apple-health/import` must be reachable from the phone.
3. If auth is enabled, `APPLE_HEALTH_API_TOKEN` on the phone must match the server.

Quick verification:

```bash
curl -s http://127.0.0.1:3033/apple-health/health | jq .
```

## Background Behavior

The app enables HealthKit background delivery for:

- steps
- active energy
- resting energy
- walking/running distance
- body weight
- body fat percentage
- lean body mass

Background delivery is best effort. iOS decides when to wake the app.

## Current Limitation

This machine does not have a full Xcode installation selected, so the shared exporter core is validated locally, but the actual iPhone app build must be completed on a machine with Xcode + a real device.

## Troubleshooting

- `Connection failed`: confirm the phone can reach the Mac mini on the same network and that the URL includes the correct port.
- `Unauthorized`: the app token does not match `APPLE_HEALTH_API_TOKEN` on the server.
- `No Apple Health metrics found`: the selected lookback window has no HealthKit samples for the exported metrics.
- `HealthKit not available`: run on a physical iPhone, not the simulator.
