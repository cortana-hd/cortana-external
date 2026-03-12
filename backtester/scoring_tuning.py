"""Bounded calibration knobs for backtester risk scoring and model comparison."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class ThresholdScoreBand:
    threshold: float
    score: float


@dataclass(frozen=True)
class ThresholdDetailBand:
    threshold: float
    score: float
    detail: str


@dataclass(frozen=True)
class DownsideRiskCalibration:
    lookback_bars: int = 63
    tail_loss_sample_size: int = 5
    drawdown_weight: float = 0.85
    tail_loss_weight: float = 2.0
    max_penalty: float = 25.0
    source_label: str = "63d_drawdown_tail_loss"


@dataclass(frozen=True)
class ChurnPenaltyCalibration:
    exit_risk_multiplier: float = 5.0
    recovery_not_confirmed_penalty: float = 8.0
    falling_knife_penalty: float = 10.0
    max_penalty: float = 25.0


@dataclass(frozen=True)
class RiskSizeCalibration:
    combined_penalty_cap: float = 40.0
    divisor: float = 50.0
    min_multiplier: float = 0.45
    max_multiplier: float = 1.0


@dataclass(frozen=True)
class TradeQualityCalibration:
    setup_component_weight: float = 55.0
    regime_modifier_floor: float = 0.4
    regime_modifier_ceiling: float = 1.05
    cost_penalty_cap: float = 40.0
    downside_penalty_cap: float = 30.0
    churn_penalty_cap: float = 25.0
    adverse_regime_penalty_cap: float = 20.0


@dataclass(frozen=True)
class AdverseRegimeCalibration:
    correction_score: float = 28.0
    under_pressure_score: float = 12.0
    rally_attempt_score: float = 8.0
    position_sizing_scale: float = 10.0
    position_sizing_min_component: float = 1.0
    distribution_day_bands: tuple[ThresholdScoreBand, ...] = field(
        default_factory=lambda: (
            ThresholdScoreBand(6, 13.0),
            ThresholdScoreBand(5, 9.0),
            ThresholdScoreBand(3, 5.0),
        )
    )
    drawdown_bands: tuple[ThresholdScoreBand, ...] = field(
        default_factory=lambda: (
            ThresholdScoreBand(-10.0, 12.0),
            ThresholdScoreBand(-6.0, 8.0),
            ThresholdScoreBand(-3.0, 4.0),
        )
    )
    down_trend_score: float = 6.0
    sideways_trend_score: float = 2.0
    below_21d_score: float = 2.0
    below_50d_score: float = 4.0
    vix_percentile_bands: tuple[ThresholdDetailBand, ...] = field(
        default_factory=lambda: (
            ThresholdDetailBand(85.0, 6.0, "VIX percentile is stretched"),
            ThresholdDetailBand(70.0, 4.0, "VIX percentile is elevated"),
        )
    )
    hy_percentile_bands: tuple[ThresholdDetailBand, ...] = field(
        default_factory=lambda: (
            ThresholdDetailBand(85.0, 6.0, "HY spread percentile is stressed"),
            ThresholdDetailBand(70.0, 4.0, "HY spread percentile is elevated"),
        )
    )
    hy_spread_bands: tuple[ThresholdDetailBand, ...] = field(
        default_factory=lambda: (
            ThresholdDetailBand(650.0, 6.0, "HY spreads are in veto territory"),
            ThresholdDetailBand(550.0, 4.0, "HY spreads remain wide"),
        )
    )
    fear_greed_bands: tuple[ThresholdDetailBand, ...] = field(
        default_factory=lambda: (
            ThresholdDetailBand(75.0, 4.0, "fear proxy remains elevated"),
            ThresholdDetailBand(60.0, 2.0, "fear proxy is leaning risk-off"),
        )
    )
    hy_change_10d_bands: tuple[ThresholdDetailBand, ...] = field(
        default_factory=lambda: (
            ThresholdDetailBand(75.0, 4.0, "HY spreads are widening fast"),
            ThresholdDetailBand(40.0, 2.0, "HY spreads are still widening"),
        )
    )
    macro_component_cap: float = 12.0
    severe_threshold: float = 55.0
    elevated_threshold: float = 35.0
    caution_threshold: float = 18.0
    confidence_penalty_divisor: float = 4.0
    confidence_penalty_cap: float = 18.0
    trade_quality_penalty_divisor: float = 7.0
    trade_quality_penalty_cap: float = 12.0
    size_multiplier_divisor: float = 120.0
    size_multiplier_floor: float = 0.55
    size_multiplier_ceiling: float = 1.0


@dataclass(frozen=True)
class ModelComparisonCalibration:
    breakout_weight: float = 0.75
    sentiment_weight: float = 0.5
    sector_weight: float = 0.75
    catalyst_weight: float = 0.5
    exit_risk_weight: float = 0.75
    baseline_min_score: float = 7.0


DOWNSIDE_RISK_CALIBRATION = DownsideRiskCalibration()
CHURN_PENALTY_CALIBRATION = ChurnPenaltyCalibration()
RISK_SIZE_CALIBRATION = RiskSizeCalibration()
TRADE_QUALITY_CALIBRATION = TradeQualityCalibration()
ADVERSE_REGIME_CALIBRATION = AdverseRegimeCalibration()
MODEL_COMPARISON_CALIBRATION = ModelComparisonCalibration()
