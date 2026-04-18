from __future__ import annotations

import sys

import prediction_accuracy_report


def test_prediction_accuracy_report_renders_richer_summary(monkeypatch, capsys):
    monkeypatch.setattr(prediction_accuracy_report, "settle_prediction_snapshots", lambda **_kwargs: None)
    monkeypatch.setattr(
        prediction_accuracy_report,
        "build_strategy_scorecard_artifact",
        lambda *_args, **_kwargs: {
            "strategies": [{"strategy_family": "canslim", "health_status": "fresh", "sample_depth": 12, "avg_opportunity_score": 74.2}]
        },
    )
    monkeypatch.setattr(
        prediction_accuracy_report,
        "build_shadow_comparison_artifact",
        lambda *_args, **_kwargs: {
            "comparisons": [{"strategy_family": "canslim", "agreement_rate": 0.81, "avg_score_delta": 1.8, "sample_depth": 12}]
        },
    )
    monkeypatch.setattr(prediction_accuracy_report, "_load_prediction_records", lambda: [])
    called = {"decision_review": False}
    monkeypatch.setattr(
        prediction_accuracy_report,
        "build_decision_review_artifact",
        lambda: (
            called.__setitem__("decision_review", True),
            {
                "opportunity_cost": {
                    "by_action": [
                        {
                            "action": "WATCH",
                            "matured_count": 8,
                            "missed_winner_count": 3,
                            "missed_winner_rate": 0.375,
                            "avg_missed_return_pct": 4.2,
                            "overblock_count": 1,
                            "top_missed_symbols": [{"symbol": "ABBV"}, {"symbol": "MSFT"}],
                        }
                    ]
                },
                "veto_effectiveness": [
                    {
                        "veto": "market_regime",
                        "matured_count": 6,
                        "preserved_bad_outcome_count": 4,
                        "preserved_bad_outcome_rate": 0.667,
                        "blocked_winner_rate": 0.333,
                        "avg_return_pct": -1.4,
                    }
                ],
            },
        )[1],
    )
    called["benchmark"] = False
    monkeypatch.setattr(
        prediction_accuracy_report,
        "build_benchmark_comparison_artifact",
        lambda: (
            called.__setitem__("benchmark", True),
            {
                "comparisons": {
                    "by_strategy_action": [
                        {
                            "strategy": "dip_buyer",
                            "action": "NO_BUY",
                            "metrics": {"matured_count": 8, "mean_return": -1.25, "hit_rate": 0.25},
                            "lift_vs_all_predictions": {"mean_return_lift": -0.55, "hit_rate_lift": 0.12},
                            "lift_vs_same_action": {"mean_return_lift": -0.25, "hit_rate_lift": 0.05},
                        }
                    ]
                }
            },
        )[1],
    )
    monkeypatch.setattr(
        prediction_accuracy_report,
        "build_prediction_accuracy_summary",
        lambda: {
            "schema_version": 1,
            "artifact_family": "prediction_accuracy_summary",
            "snapshot_count": 12,
            "record_count": 48,
            "rolling_window_sizes": [20, 50, 100],
            "settlement_status_counts": {"settled": 9, "partially_settled": 2, "insufficient_data": 1},
            "maturity_state_counts": {"matured": 9, "partial": 2, "incomplete": 1},
            "horizon_status": {
                "1d": {"matured": 16, "pending": 20, "incomplete": 12},
                "5d": {"matured": 8, "pending": 24, "incomplete": 16},
                "20d": {"matured": 3, "pending": 30, "incomplete": 15},
            },
            "validation_grade_counts": {
                "signal_validation_grade": {"good": 8, "mixed": 3, "poor": 1},
                "entry_validation_grade": {"good": 6, "unknown": 4, "not_applicable": 2},
                "execution_validation_grade": {"unknown": 10, "good": 2},
                "trade_validation_grade": {"good": 5, "mixed": 4, "unknown": 2, "poor": 1},
            },
            "summary": [
                {
                    "strategy": "dip_buyer",
                    "action": "NO_BUY",
                    "5d": {
                        "samples": 8,
                        "avg_return_pct": -1.25,
                        "median_return_pct": -0.8,
                        "hit_rate": 0.25,
                        "decision_accuracy": 0.75,
                        "decision_accuracy_label": "avoidance_rate",
                        "avg_max_drawdown_pct": -3.2,
                        "avg_max_runup_pct": 1.1,
                    }
                }
            ],
            "by_strategy": [
                {
                    "strategy": "dip_buyer",
                    "5d": {
                        "samples": 8,
                        "avg_return_pct": -1.25,
                        "median_return_pct": -0.8,
                        "hit_rate": 0.25,
                        "decision_accuracy": 0.75,
                        "decision_accuracy_label": "avoidance_rate",
                    },
                }
            ],
            "by_action": [
                {
                    "action": "NO_BUY",
                    "5d": {
                        "samples": 8,
                        "avg_return_pct": -1.25,
                        "median_return_pct": -0.8,
                        "hit_rate": 0.25,
                        "decision_accuracy": 0.75,
                        "decision_accuracy_label": "avoidance_rate",
                    },
                }
            ],
            "by_regime": [
                {
                    "strategy": "dip_buyer",
                    "market_regime": "correction",
                    "action": "NO_BUY",
                    "5d": {
                        "samples": 5,
                        "avg_return_pct": -1.8,
                        "median_return_pct": -1.2,
                        "hit_rate": 0.2,
                        "decision_accuracy": 0.8,
                        "decision_accuracy_label": "avoidance_rate",
                    },
                }
            ],
            "by_confidence_bucket": [
                {
                    "strategy": "dip_buyer",
                    "confidence_bucket": "medium",
                    "action": "NO_BUY",
                    "5d": {
                        "samples": 4,
                        "avg_return_pct": -1.1,
                        "median_return_pct": -0.9,
                        "hit_rate": 0.25,
                        "decision_accuracy": 0.75,
                        "decision_accuracy_label": "avoidance_rate",
                    },
                }
            ],
            "rolling_summary": {
                "20": {
                    "requested_window": 20,
                    "records_considered": 20,
                    "is_partial_window": False,
                    "summary": [
                        {
                            "strategy": "dip_buyer",
                            "action": "NO_BUY",
                            "5d": {
                                "samples": 6,
                                "avg_return_pct": -1.0,
                                "median_return_pct": -0.8,
                                "hit_rate": 0.2,
                                "decision_accuracy": 0.8,
                                "decision_accuracy_label": "avoidance_rate",
                            },
                        }
                    ],
                },
                "50": {
                    "requested_window": 50,
                    "records_considered": 48,
                    "is_partial_window": True,
                    "summary": [],
                },
                "100": {
                    "requested_window": 100,
                    "records_considered": 48,
                    "is_partial_window": True,
                    "summary": [],
                },
            },
        },
    )
    monkeypatch.setattr(
        prediction_accuracy_report,
        "_build_governance_summary",
        lambda: {
            "activation_hooks": {"mode": "compare_only", "enforced": False, "eligible_incumbent_count": 1},
            "status_counts": {"challenger": 1, "incumbent": 1},
            "active_incumbents": [{"experiment_key": "dip_buyer_v1"}],
            "active_challengers": [{"experiment_key": "dip_buyer_v2"}],
            "recent_authority_changes": [
                {"experiment_key": "dip_buyer_v2", "decision_type": "promotion", "decision_result": "pass"}
            ],
        },
    )
    monkeypatch.setattr(sys, "argv", ["prediction_accuracy_report.py"])

    prediction_accuracy_report.main()

    out = capsys.readouterr().out
    assert called["decision_review"] is True
    assert called["benchmark"] is True
    assert "Prediction accuracy" in out
    assert "Snapshots settled: 12" in out
    assert "Records logged: 48" in out
    assert "Settlement states: insufficient_data 1 | partially_settled 2 | settled 9" in out
    assert "Maturity states: incomplete 1 | matured 9 | partial 2" in out
    assert "Settlement coverage: 1d: matured 16 | pending 20 | incomplete 12" in out
    assert "Validation grades: signal validation: good 8 | mixed 3 | poor 1" in out
    assert "By strategy/action" in out
    assert "dip_buyer NO_BUY" in out
    assert "avoidance_rate=75%" in out
    assert "avg drawdown -3.20%" in out
    assert "By strategy" in out
    assert "By action" in out
    assert "By regime" in out
    assert "dip_buyer correction NO_BUY" in out
    assert "By confidence bucket" in out
    assert "dip_buyer medium NO_BUY" in out
    assert "Rolling windows" in out
    assert "Latest 20 samples: 20 records" in out
    assert "Latest 50 samples (partial): 48 records" in out
    assert "Opportunity cost" in out
    assert "WATCH: missed 3/8 (38%) | avg missed return +4.20% | overblocks 1 | top missed ABBV, MSFT" in out
    assert "Veto effectiveness" in out
    assert "market_regime: preserved bad 4/6 (67%) | blocked winners 33% | avg return -1.40%" in out
    assert "Benchmark comparisons" in out
    assert "dip_buyer NO_BUY: n=8 mean=-1.25% hit=25% | vs all mean -0.55% hit +12% | vs action mean -0.25% hit +5%" in out
    assert "Strategy scorecards" in out
    assert "canslim: fresh | samples 12 | avg opportunity 74.2" in out
    assert "Opportunity shadow" in out
    assert "canslim: agreement 81% | delta +1.80 | samples 12" in out
    assert "Governance status" in out
    assert "Mode: compare_only | enforced no | eligible incumbents 1" in out
    assert "Incumbents: dip_buyer_v1" in out
    assert "Challengers: dip_buyer_v2" in out


def test_prediction_accuracy_report_json_emits_bundle(monkeypatch, capsys):
    monkeypatch.setattr(prediction_accuracy_report, "settle_prediction_snapshots", lambda **_kwargs: None)
    monkeypatch.setattr(prediction_accuracy_report, "build_prediction_accuracy_summary", lambda: {"artifact_family": "prediction_accuracy_summary"})
    monkeypatch.setattr(prediction_accuracy_report, "build_decision_review_artifact", lambda: {"artifact_family": "decision_review_summary"})
    monkeypatch.setattr(prediction_accuracy_report, "build_benchmark_comparison_artifact", lambda: {"artifact_family": "benchmark_comparison_summary"})
    monkeypatch.setattr(prediction_accuracy_report, "build_strategy_scorecard_artifact", lambda *_args, **_kwargs: {"artifact_family": "strategy_scorecard_summary"})
    monkeypatch.setattr(prediction_accuracy_report, "build_shadow_comparison_artifact", lambda *_args, **_kwargs: {"artifact_family": "opportunity_shadow_summary"})
    monkeypatch.setattr(prediction_accuracy_report, "_load_prediction_records", lambda: [])
    monkeypatch.setattr(prediction_accuracy_report, "_build_governance_summary", lambda: {"artifact_family": "governance_status_summary"})
    monkeypatch.setattr(sys, "argv", ["prediction_accuracy_report.py", "--json"])

    prediction_accuracy_report.main()

    payload = capsys.readouterr().out
    assert '"prediction_accuracy"' in payload
    assert '"decision_review"' in payload
    assert '"benchmark_comparisons"' in payload
    assert '"strategy_scorecard"' in payload
    assert '"opportunity_shadow"' in payload
    assert '"governance"' in payload
