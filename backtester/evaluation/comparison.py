"""Wave 4 helpers for comparing simple scoring models against overlay-aware ranks."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Iterable, Optional, Sequence

import pandas as pd


@dataclass(frozen=True)
class ModelFamily:
    """Configuration for a practical scoring model comparison."""

    name: str
    score_column: str
    description: str
    top_n: Optional[int] = None
    min_score: Optional[float] = None


def score_enhanced_rank(
    total_score: float,
    breakout_score: float,
    sentiment_score: float,
    exit_risk_score: float,
    sector_score: float = 0.0,
    catalyst_score: float = 0.0,
) -> float:
    """Shared overlay-aware rank used by advisor outputs and Wave 4 comparisons."""
    return round(
        float(total_score)
        + float(breakout_score) * 0.75
        + float(sentiment_score) * 0.5
        + float(sector_score) * 0.75
        + float(catalyst_score) * 0.5
        - float(exit_risk_score) * 0.75,
        2,
    )


def _numeric(frame: pd.DataFrame, column: str) -> pd.Series:
    if column not in frame.columns:
        return pd.Series(0.0, index=frame.index, dtype=float)
    return pd.to_numeric(frame[column], errors="coerce").fillna(0.0)


def attach_model_family_scores(candidates: pd.DataFrame) -> pd.DataFrame:
    """Add comparable score columns for baseline, tactical, and enhanced models."""
    if candidates is None:
        return pd.DataFrame()
    if candidates.empty:
        return candidates.copy()

    frame = candidates.copy()
    total = _numeric(frame, "total_score")
    breakout = _numeric(frame, "breakout_score")
    sentiment = _numeric(frame, "sentiment_score")
    exit_risk = _numeric(frame, "exit_risk_score")
    sector = _numeric(frame, "sector_score")
    catalyst = _numeric(frame, "catalyst_score")

    frame["baseline_score"] = total.round(2)
    frame["tactical_score"] = (
        total
        + breakout * 0.75
        - exit_risk * 0.75
    ).round(2)

    computed_enhanced = (
        total
        + breakout * 0.75
        + sentiment * 0.5
        + sector * 0.75
        + catalyst * 0.5
        - exit_risk * 0.75
    ).round(2)
    if "rank_score" in frame.columns:
        frame["enhanced_score"] = pd.to_numeric(frame["rank_score"], errors="coerce").fillna(computed_enhanced)
    else:
        frame["enhanced_score"] = computed_enhanced

    return frame


def build_default_model_families(
    *,
    top_n: int = 5,
    baseline_min_score: Optional[float] = 7.0,
) -> list[ModelFamily]:
    """Default Wave 4 comparison path from simple score to overlay-aware rank."""
    return [
        ModelFamily(
            name="baseline_total",
            score_column="baseline_score",
            description="Core CANSLIM total score only.",
            top_n=top_n,
            min_score=baseline_min_score,
        ),
        ModelFamily(
            name="tactical_overlay",
            score_column="tactical_score",
            description="Adds breakout follow-through and exit-risk discipline.",
            top_n=top_n,
        ),
        ModelFamily(
            name="enhanced_rank",
            score_column="enhanced_score",
            description="Uses the full Wave 2/3 overlay-aware rank.",
            top_n=top_n,
        ),
    ]


def _symbol_list(frame: pd.DataFrame) -> list[str]:
    if "symbol" in frame.columns:
        return frame["symbol"].astype(str).tolist()
    return [str(idx) for idx in frame.index]


def _select_candidates(frame: pd.DataFrame, family: ModelFamily) -> pd.DataFrame:
    if frame.empty or family.score_column not in frame.columns:
        return frame.iloc[0:0].copy()

    selected = frame.copy()
    if family.min_score is not None:
        selected = selected[pd.to_numeric(selected[family.score_column], errors="coerce") >= family.min_score]

    sort_columns = [family.score_column]
    for column in ("effective_confidence", "confidence", "uncertainty_pct", "total_score", "symbol"):
        if column in selected.columns and column not in sort_columns:
            sort_columns.append(column)

    if selected.empty:
        return selected

    ascending = [False] * len(sort_columns)
    if "uncertainty_pct" in sort_columns:
        ascending[sort_columns.index("uncertainty_pct")] = True
    if "symbol" in sort_columns:
        ascending[sort_columns.index("symbol")] = True

    selected = selected.sort_values(sort_columns, ascending=ascending, kind="mergesort")
    if family.top_n is not None:
        selected = selected.head(family.top_n)
    return selected.reset_index(drop=True)


def _safe_mean(frame: pd.DataFrame, column: str) -> float:
    if column not in frame.columns or frame.empty:
        return 0.0
    series = pd.to_numeric(frame[column], errors="coerce").dropna()
    if series.empty:
        return 0.0
    return float(series.mean())


def _safe_median(frame: pd.DataFrame, column: str) -> float:
    if column not in frame.columns or frame.empty:
        return 0.0
    series = pd.to_numeric(frame[column], errors="coerce").dropna()
    if series.empty:
        return 0.0
    return float(series.median())


def _safe_mean_with_fallback(frame: pd.DataFrame, primary: str, fallback: str) -> float:
    if primary in frame.columns:
        return _safe_mean(frame, primary)
    return _safe_mean(frame, fallback)


def _rate(frame: pd.DataFrame, series: pd.Series) -> float:
    if frame.empty or series.empty:
        return 0.0
    return round(float(series.mean() * 100.0), 1)


def compare_model_families(
    candidates: pd.DataFrame,
    families: Sequence[ModelFamily],
    *,
    baseline_name: Optional[str] = None,
    future_return_column: str = "future_return_pct",
    outcome_bucket_column: str = "outcome_bucket",
    action_column: str = "action",
) -> tuple[pd.DataFrame, Dict[str, pd.DataFrame]]:
    """Compare how different score families rank and filter the same candidate set."""
    frame = attach_model_family_scores(candidates)
    selections = {family.name: _select_candidates(frame, family) for family in families}

    if baseline_name is None and families:
        baseline_name = families[0].name
    baseline_symbols = set(_symbol_list(selections.get(baseline_name, frame.iloc[0:0])))

    rows = []
    universe_size = len(frame)
    for family in families:
        selected = selections[family.name]
        symbols = set(_symbol_list(selected))
        row = {
            "model": family.name,
            "score_column": family.score_column,
            "description": family.description,
            "universe_size": int(universe_size),
            "selected_count": int(len(selected)),
            "coverage_pct": round((len(selected) / universe_size) * 100.0, 1) if universe_size else 0.0,
            "avg_score": round(_safe_mean(selected, family.score_column), 2),
            "avg_confidence": round(_safe_mean_with_fallback(selected, "confidence", "effective_confidence"), 1),
            "avg_effective_confidence": round(_safe_mean_with_fallback(selected, "effective_confidence", "confidence"), 1),
            "avg_uncertainty_pct": round(_safe_mean(selected, "uncertainty_pct"), 1),
            "buy_count": int((selected.get(action_column) == "BUY").sum()) if action_column in selected.columns else 0,
            "watch_count": int((selected.get(action_column) == "WATCH").sum()) if action_column in selected.columns else 0,
            "no_buy_count": int((selected.get(action_column) == "NO_BUY").sum()) if action_column in selected.columns else 0,
            "abstain_count": int(pd.to_numeric(selected.get("abstain", pd.Series(dtype=float)), errors="coerce").fillna(0).astype(bool).sum()) if "abstain" in selected.columns else 0,
            "abstain_rate_pct": 0.0,
            "avg_future_return_pct": round(_safe_mean(selected, future_return_column), 2),
            "median_future_return_pct": round(_safe_median(selected, future_return_column), 2),
            "hit_rate_pct": 0.0,
            "win_rate_pct": 0.0,
            "loss_rate_pct": 0.0,
            "overlap_with_baseline": 0,
            "model_only_count": 0,
            "baseline_only_count": 0,
        }

        if future_return_column in selected.columns and not selected.empty:
            future_returns = pd.to_numeric(selected[future_return_column], errors="coerce").dropna()
            if not future_returns.empty:
                row["hit_rate_pct"] = _rate(selected, future_returns > 0)

        if outcome_bucket_column in selected.columns and not selected.empty:
            buckets = selected[outcome_bucket_column].fillna("").astype(str).str.lower()
            row["win_rate_pct"] = _rate(selected, buckets == "win")
            row["loss_rate_pct"] = _rate(selected, buckets == "loss")

        if baseline_symbols:
            row["overlap_with_baseline"] = len(symbols.intersection(baseline_symbols))
            row["model_only_count"] = len(symbols - baseline_symbols)
            row["baseline_only_count"] = len(baseline_symbols - symbols)

        if row["selected_count"]:
            row["abstain_rate_pct"] = round((row["abstain_count"] / row["selected_count"]) * 100.0, 1)

        rows.append(row)

    return pd.DataFrame(rows), selections


def render_model_comparison_report(
    summary: pd.DataFrame,
    selections: Dict[str, pd.DataFrame],
    *,
    baseline_name: Optional[str] = None,
    title: str = "Wave 4 Model Comparison",
    symbol_limit: int = 5,
) -> str:
    """Format a concise text report for reviewing model-family differences."""
    if summary.empty:
        return f"{title}\nNo candidates available for comparison."

    if baseline_name is None:
        baseline_name = str(summary.iloc[0]["model"])

    universe_size = int(summary.iloc[0].get("universe_size", 0))
    lines = [title, f"Universe: {universe_size} candidates"]

    for row in summary.to_dict(orient="records"):
        model = row["model"]
        selected = selections.get(model, pd.DataFrame())
        symbols = _symbol_list(selected)[:symbol_limit]
        line = (
            f"{model}: picked {row['selected_count']} | avg {row['score_column']} {row['avg_score']:.2f}"
            f" | buys {row['buy_count']} | watches {row['watch_count']}"
        )
        if row["avg_confidence"] > 0:
            line += f" | avg conf {row['avg_confidence']:.1f}%"
        if row.get("avg_uncertainty_pct", 0.0) > 0:
            line += f" | avg uncertainty {row['avg_uncertainty_pct']:.1f}%"
        if row.get("abstain_count", 0) > 0:
            line += f" | abstain {row['abstain_count']}"
        if row["avg_future_return_pct"] != 0.0 or row["hit_rate_pct"] != 0.0:
            line += (
                f" | avg return {row['avg_future_return_pct']:+.2f}%"
                f" | hit rate {row['hit_rate_pct']:.1f}%"
            )
        if row["win_rate_pct"] != 0.0 or row["loss_rate_pct"] != 0.0:
            line += (
                f" | win/loss {row['win_rate_pct']:.1f}%/{row['loss_rate_pct']:.1f}%"
            )
        lines.append(line)

        if model != baseline_name:
            lines.append(
                f"  overlap vs {baseline_name}: {row['overlap_with_baseline']} | "
                f"model-only {row['model_only_count']} | baseline-only {row['baseline_only_count']}"
            )

        if symbols:
            lines.append(f"  picks: {', '.join(symbols)}")

    return "\n".join(lines)
