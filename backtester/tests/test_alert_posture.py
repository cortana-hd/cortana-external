from evaluation.alert_posture import describe_alert_posture, describe_calibration_note


def test_describe_alert_posture_marks_correction_watchlists_as_review_only():
    line = describe_alert_posture(market_regime="correction", buy_count=0, watch_count=3)
    assert line == (
        "Alert posture: review only — correction regime. "
        "Treat surfaced names as a watchlist, not a buy-now alert."
    )


def test_describe_alert_posture_marks_empty_correction_scans_as_stand_aside():
    line = describe_alert_posture(market_regime="correction", buy_count=0, watch_count=0)
    assert line == (
        "Alert posture: stand aside — correction regime. "
        "This is a status update, not a buy-now alert."
    )


def test_describe_alert_posture_stays_quiet_outside_correction():
    assert describe_alert_posture(market_regime="confirmed_uptrend", buy_count=2, watch_count=1) == ""


def test_describe_calibration_note_marks_empty_history_as_uncalibrated():
    line = describe_calibration_note({"reason": "no_settled_records", "settled_candidates": 0, "is_stale": True})
    assert line == (
        "Calibration note: uncalibrated — no settled outcomes yet, "
        "so confidence is still model-estimated rather than proven."
    )


def test_describe_calibration_note_uses_stale_and_fresh_states():
    stale = describe_calibration_note({"reason": "age_limit", "settled_candidates": 12, "is_stale": True})
    fresh = describe_calibration_note({"reason": None, "settled_candidates": 24, "is_stale": False})

    assert stale == (
        "Calibration note: stale — learning is based on 12 settled outcomes, "
        "so treat confidence as provisional."
    )
    assert fresh == "Calibration note: learning on 24 settled outcomes."
