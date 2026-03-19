# PRD: Next-Gen Profit Advancements for Trading Stack

**Status:** Phase-1 slice partially implemented (research + operator annotations only)  
**Owner:** Cortana / OpenClaw trading workflow  
**Scope:** `cortana` trading cron + `cortana-external` intel inputs (read-only)  
**Intent:** Push the current decoupled architecture toward institutional-grade selection, sizing, and execution readiness to maximize PnL without breaking reliability.

---

## Why

The decoupled base/enrichment/notify stack is stable. To materially improve PnL, we need higher-quality selection, better risk-adjusted sizing, and execution-aware surfacing—without reintroducing fragility.

Quant-style or OSINT-style writeups can be useful as conceptual inputs, but they are not evidence of a tradeable edge by themselves. This PRD treats those ideas as hypotheses that must survive forward testing, slippage accounting, and timing-risk review before they influence production.

---

## Objectives

1) Improve selection quality inside the scan cap  
2) Improve risk-adjusted sizing and exposure discipline  
3) Reduce execution drag and forced errors  
4) Use cross-asset/context signals to time aggression and filtering  
5) Keep reliability: base compute stays minimal; enrichments fail-open; notify stays strict/idempotent

---

## What Is Implemented Now (Production-Safe Slice)

1) Operator-facing overlays are bounded annotations only.
- The live/operator surfaces can show risk-budget and execution-quality context when present.
- These annotations do not replace regime gates and do not create trade authority.

2) Research path now logs overlay dimensions for calibration.
- `backtester/experimental_alpha.py` snapshots now include:
  - risk budget state
  - aggression posture
  - execution quality
  - liquidity tier
  - optional spread/slippage/ADV notes
- Settled records carry those same fields for forward-outcome review.
- Calibration output includes overlay slice metrics (5d buckets, informational only).

3) Promotion gate remains strict and research-only.
- Promotion gate still keys off paper-long sample count, hit rate, avg return, and Brier score.
- Overlay slice metrics are diagnostic in this phase; they do not change production scoring by themselves.

---

## Deferred / Future Work

- No direct execution logic, broker routing, wallet flows, or auto-trading.
- No live adaptive weighting from overlay slices yet.
- No production hard gates from overlay slices yet.
- No full factor-tilt engine, cross-asset hedge engine, or portfolio optimizer in base compute.

---

## Proposed Capability Set

### A) Regime/Vol-Aware Sizing & Risk Budget Meter
- Inputs: realized/imp vol (SPY, QQQ), VIX term structure, HY spreads, drawdown stats
- Outputs: aggression dial + recommended exposure cap; mark “risk budget remaining” in alerts
- Placement: enrichment (annotation-only); base sizing rules remain intact

### B) Liquidity & Slippage Modeling
- Compute per-name liquidity quality: spread × size × volatility; average dollar volume; halt/ADR flags
- Treat liquidity/slippage as central to the thesis, not a footnote; if the edge vanishes after realistic execution costs, it is not a production edge
- Filter or down-rank illiquid names; surface expected slippage/impact next to BUYs
- Placement: enrichment ranking modifier + alert annotations

### C) Factor Tilt Overlay
- Lightweight cross-sectional tilts (quality, momentum, low-vol, value proxies)
- Rank marginal BUY/WATCH names by factor alignment and portfolio overexposure
- Placement: enrichment ranking modifier; cap factor concentrations

### D) Event/Earnings-Aware Scheduling
- Down-rank or flag names with imminent earnings/lockups unless event-driven
- Mark binary-event proximity in alerts
- Placement: enrichment annotation + optional veto for short-horizon holds

### E) Cross-Asset Confirmation/Divergence
- Inputs: ES/NQ futures, credit (CDX/HY), rates (2s/10s), vol surface (VIX/VVIX/term), crypto beta for proxies
- Outputs: risk-on/off boost/veto for marginal names; aggression timing cues
- Placement: enrichment; never overrides base gates

### F) Stop/Target Policy Suggestions
- Suggest ATR/structure-based stops and first targets for BUY names
- Placement: enrichment annotations only (operator guidance)

### G) Short/Hedge Candidates
- Surface clean hedge candidates (index/sector/ETF) when regime/vol triggers risk-off posture
- Placement: enrichment-only list; no auto sizing

### H) Outcome Tracking & Adaptive Weights
- Daily/weekly settlement of BUY/WATCH outcomes (1d/5d/10d)
- Learn which buckets (regime, factor, liquidity, event proximity, Polymarket posture) are hot/cold
- Adjust ranking weights and “turn down” cold buckets automatically
- Placement: enrichment + weight file consumed by ranking modifiers; base untouched

### I) Execution Readiness Signals
- Mark illiquid windows (first/last 10m), halts, extreme spreads
- Placement: enrichment annotations in alerts

### J) Adaptive Scan Cadence
- Slow scans in dead markets; speed up when vol/event risk is high
- Placement: scheduler/config; keep base contract stable

### K) Research-Grade Validation Gates
- Require out-of-sample validation and walk-forward testing before any ranking or sizing idea is promoted
- Treat high in-sample R^2 as a hypothesis signal, not evidence of durable edge
- Measure latency, slippage assumptions, and resolution/timing behavior before promotion
- Track binary-resolution risk explicitly so being directionally right but late does not masquerade as edge
- Keep real-money execution out until there is forward evidence and a reviewable sample size
- Placement: promotion gate only; never base compute

---

## Architecture Rules (unchanged)
- Base compute stays minimal: regime + CANSLIM/Dip Buyer core + gating + metrics + message
- Enrichments are fail-open, run by `run_id`, write to `enrichments/`, never flip base status
- Notify merges only fresh, matching run_id artifacts and stays strict/idempotent

---

## Phased Rollout (recommended)

Phase 1 (Low risk, high value)  
- Liquidity/slippage scoring + alert annotations  
- Risk budget meter (vol/regime-aware aggression)  
- Delivery audit artifact (already added) extended to include merge flags

Phase 2 (Selection quality)  
- Factor tilt overlay + concentration caps  
- Event proximity flags and down-rank  
- Cross-asset confirmation/divegence cues

Phase 3 (Execution & hedging)  
- Stop/target suggestions  
- Hedge candidate surfacing in risk-off regimes  
- Adaptive scan cadence knobs

Phase 4 (Learning loop)  
- Outcome settlement + bucket hit rates  
- Adaptive weights for ranking modifiers

---

## Success Criteria
- Higher hit rate / return per BUY and WATCH buckets vs. current baseline
- Lower slippage/impact on executed names (measured via liquidity score bins)
- Fewer bad longs during adverse cross-asset signals (tracked in outcome settlement)
- No increase in cron failures or notify false greens

---

## Risks / Mitigations
- Overfitting: keep adaptive weight changes bounded and reviewable
- Latency: heavy data fetch must stay out of base; use cached/overnight precomputation
- Marketing claims are not evidence; do not promote ideas based on unverified “earned X” or “inevitable success” language
- Binary markets are timing-sensitive; a model can be right on probability and still lose on resolution timing
- Complexity creep: each enrichment must be optional; base must succeed alone

---

## Notes on Data Sources
- Prefer cached/precomputed inputs where possible; avoid live multi-API fanout in market session
- Use Polymarket only as context/rank modifier, never as a hard gate
- Use existing MarketDataProvider caches for liquidity/vol metrics when feasible
- OSINT/news-latency pipelines can be useful research inputs, but naive scrape + LLM + auto-trade behavior is excluded from production until it proves itself forward
- Build a research-grade signal engine first; do not promote a production trading bot until validation gates clear
