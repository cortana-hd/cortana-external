# Scoring Calibration Note

This phase centralizes the small set of tuning values behind the current risk-scoring and evaluation stack in [`backtester/scoring_tuning.py`](../scoring_tuning.py). The goal is reviewable calibration, not a broad config system.

## What is now tuneable

- `TradeQualityCalibration`: setup-component weight plus the caps used when trade quality applies cost, downside, churn, and adverse-regime penalties.
- `DownsideRiskCalibration`: downside lookback window, worst-loss sample size, drawdown weight, tail-loss weight, and max penalty.
- `ChurnPenaltyCalibration`: exit-risk multiplier, recovery-not-confirmed penalty, falling-knife penalty, and max penalty.
- `RiskSizeCalibration`: how downside/churn penalties translate into a size multiplier.
- `AdverseRegimeCalibration`: adverse-regime component scores, macro stress bands, severity thresholds, and the derived confidence/trade-quality/size penalties.
- `ModelComparisonCalibration`: overlay weights for tactical/enhanced rank scoring and the default baseline minimum score used in Wave 4 comparisons.

## Where these values are used

- [`backtester/data/confidence.py`](../data/confidence.py)
- [`backtester/data/adverse_regime.py`](../data/adverse_regime.py)
- [`backtester/evaluation/comparison.py`](../evaluation/comparison.py)

## Boundaries

- Defaults match the pre-cleanup behavior so current scoring stays stable.
- Hard vetoes and safety gates are unchanged. Calibration only affects ranking/penalty math and model-comparison weighting.
- This layer is intentionally code-local. There is no runtime config loader or new strategy policy surface in this phase.
