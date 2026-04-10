# Cortana Watchdog

Local reliability monitor — pure shell, $0 cost, runs every 15 min via launchd.
Current location: `~/Developer/cortana-external/watchdog` · Status: **active** (`com.cortana.watchdog`).

## What it checks

| Check | Action on failure |
|-------|-------------------|
| **Cron Quarantine** | Alert if any preflight quarantine marker exists (`~/.openclaw/cron/quarantine/*.quarantined`) |
| **Cron Health** | Alert if any cron has 3+ consecutive failures |
| **Heartbeat Health (variance + degradation)** | Classify heartbeat as healthy/warning/critical using process count, process age, restart churn (6h), and timing drift variance |
| **Degraded Agents** | Alert when mission-control agents are degraded/offline or stale (`last_seen > 45m`) |
| **Mission Control UI** | Probe `http://127.0.0.1:3000/api/heartbeat-status`; restart `com.cortana.mission-control` once, then alert if still down |
| **gog (Gmail)** | Log failure |
| **Tonal API** | Health probe + retry; Tonal service self-heals via refresh-token flow |
| **Whoop API** | Log failure |
| **Polymarket US** | Probe `/polymarket/health`; warn only on sustained degraded/rate-limit state; alert immediately on auth or unconfigured failures |
| **Schwab market-data lane** | Probe `/market-data/ready`, `/market-data/ops`, and `SPY,QQQ` quote smoke test; restart local service once only when unreachable; warn only on sustained provider cooldown; alert for auth/operator action |
| **Pre-open readiness artifact** | Consume `backtester/var/readiness/pre-open-canary-latest.json`; keep pure market-data warnings owned by the market-data lane; alert on higher-level trade-lane failures or sustained degraded readiness |
| **PostgreSQL** | Alert |
| **API Budget** | Alert if <30% remaining before day 20 |

All results logged to `cortana_events` table.

## Related operator artifacts

Use these when you want the structured operator view instead of raw shell logs:

```bash
cd /Users/hd/Developer/cortana-external/backtester

# What exists and what should be inspected
uv run python runtime_inventory_snapshot.py --pretty

# Current runtime health truth
uv run python runtime_health_snapshot.py --pretty

# Retention, backup, incident, and change-management plan
uv run python ops_highway_snapshot.py --pretty
```

## Install

```bash
chmod +x ~/Developer/cortana-external/watchdog/watchdog.sh
chmod +x ~/Developer/cortana-external/watchdog/send_telegram.sh
cp ~/Developer/cortana-external/watchdog/com.cortana.watchdog.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.cortana.watchdog.plist
```

## Test manually

```bash
~/Developer/cortana-external/watchdog/watchdog.sh
```

## Validate heartbeat classifier logic

```bash
~/Developer/cortana-external/watchdog/tests/heartbeat-classifier-test.sh
~/Developer/cortana-external/watchdog/tests/polymarket-check-test.sh
~/Developer/cortana-external/watchdog/tests/market-data-check-test.sh
~/Developer/cortana-external/watchdog/tests/pre-open-readiness-test.sh
~/Developer/cortana-external/watchdog/tests/mission-control-check-test.sh
```

## Check logs

```bash
tail -f ~/Developer/cortana-external/watchdog/logs/watchdog.log
```

## Manage

```bash
launchctl list | grep cortana.watchdog
launchctl unload ~/Library/LaunchAgents/com.cortana.watchdog.plist  # stop
launchctl load ~/Library/LaunchAgents/com.cortana.watchdog.plist    # start
```

## Config

- Bot token: read from `/Users/hd/.openclaw/openclaw.json`
- Chat ID: `8171372724`
- Interval: 900s (15 min)
- Fitness base URL: `FITNESS_BASE_URL` env var (default: `http://localhost:3033`)
- Mission Control URL: `MISSION_CONTROL_BASE_URL` env var (default: `http://127.0.0.1:3000`)
- Optional Slack bridge: `WATCHDOG_SLACK_WEBHOOK_URL` (Telegram remains canonical notification path)

### Heartbeat thresholds (tunable)

- `critical`: no heartbeat process, pileup (`>1`), age `>=3600s`, or restart churn `>=4` restarts in 6h
- `warning`: age `>=2400s`, restart churn `>=2` in 6h, or timing drift variance `>=300s`
- `ok`: none of the above; recovery alert is emitted after previously degraded state clears
