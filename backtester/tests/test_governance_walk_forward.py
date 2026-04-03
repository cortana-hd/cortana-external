from __future__ import annotations

from governance.walk_forward import build_walk_forward_summary


def _record(index: int, *, regime: str = "correction", value: float = 1.0, params: dict | None = None) -> dict:
    return {
        "generated_at": f"2026-03-{(index % 28) + 1:02d}T12:00:00+00:00",
        "known_at": f"2026-03-{(index % 28) + 1:02d}T11:55:00+00:00",
        "market_regime": regime,
        "forward_returns_pct": {"1d": value / 2.0, "5d": value, "20d": value * 1.5},
        "parameter_set": params or {"entry": "base", "threshold": 6},
    }


def test_walk_forward_summary_emits_windows_and_stress_slices():
    records = [
        _record(i, regime="correction" if i % 2 == 0 else "confirmed_uptrend", value=1.0 + (i % 3) * 0.2)
        for i in range(80)
    ]
    artifact = build_walk_forward_summary(
        experiment_key="dip_buyer_v2",
        records=records,
        train_size=20,
        validation_size=10,
        test_size=10,
    )

    assert artifact["artifact_family"] == "walk_forward_summary"
    assert len(artifact["window_results"]) >= 4
    assert artifact["regime_segment_summary"]["regime_count"] == 2
    assert "5d" in artifact["stress_test_summary"]["hold_window_summary"]


def test_walk_forward_marks_fragile_parameter_sets():
    records = []
    for i in range(40):
        records.append(_record(i, value=1.0, params={"entry": "tight", "threshold": 6}))
    for i in range(40, 50):
        records.append(_record(i, value=-1.0, params={"entry": "loose", "threshold": 4}))

    artifact = build_walk_forward_summary(
        experiment_key="dip_buyer_v2",
        records=records,
        train_size=20,
        validation_size=10,
        test_size=10,
    )

    assert artifact["parameter_stability_summary"]["fragile_parameter_count"] >= 1
    assert artifact["pass_fail_summary"]["passed"] is False
