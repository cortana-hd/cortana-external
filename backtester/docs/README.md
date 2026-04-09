# Backtester Docs

This directory is the raw source-document layer for the backtester.

In the LLM wiki model:
- `backtester/docs/source/` holds raw durable artifacts
- `knowledge/domains/backtester/` holds the compiled current-truth wiki pages
- detailed planning/execution artifacts stay close to the backtester instead of polluting the repo root

## Layout

- `source/guide/` - operator guides and handoff docs
- `source/architecture/` - system-shape and flow docs
- `source/prd/` - requirement docs
- `source/reference/` - compact references and API/runtime notes
- `source/runbook/` - recovery procedures
- `source/roadmap/` - current forward plan

## Start Here

- [Study guide](./source/guide/backtester-study-guide.md)
- [Roadmap](./source/roadmap/roadmap.md)
- [Session handoff](./source/guide/session-handoff.md)
- [Market-data service reference](./source/reference/market-data-service-reference.md)
- [Trading cron base/enrichment/notify decoupling PRD](./source/prd/prd-trading-cron-base-enrichment-notify-decoupling.md)
- [Polymarket market intelligence PRD](./source/prd/prd-polymarket-market-intelligence.md)
- [Schwab OAuth reauth runbook](./source/runbook/schwab-oauth-reauth-runbook.md)
- [Trading Ops QA runbook](./source/runbook/trading-ops-qa-runbook.md)
- [Knowledge overview](../../knowledge/domains/backtester/overview.md)
