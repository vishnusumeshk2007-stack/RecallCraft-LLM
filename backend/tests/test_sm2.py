"""Unit tests for the SM-2 engine.

Every expected number below is hand-derived from the SM-2 rules in the spec:
    EF' = EF + (0.1 - (5-q)(0.08 + (5-q)0.02)),  EF >= 1.3
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.services.sm2 import (
    DEFAULT_EASE_FACTOR,
    MIN_EASE_FACTOR,
    SM2Error,
    SM2State,
    initial_state,
    project_schedule,
    review,
    updated_ease_factor,
)

NOW = datetime(2026, 1, 1, 9, 0, tzinfo=timezone.utc)


def test_defaults_match_spec():
    state = initial_state()
    assert state.repetition == 0
    assert state.interval == 1
    assert state.ease_factor == DEFAULT_EASE_FACTOR == 2.5


def test_rejects_out_of_range_quality():
    with pytest.raises(SM2Error):
        review(initial_state(), 6)
    with pytest.raises(SM2Error):
        review(initial_state(), -1)


@pytest.mark.parametrize(
    ("quality", "expected_delta"),
    [
        (5, 0.1),
        (4, 0.0),
        (3, -0.14),
        (2, -0.32),
        (1, -0.54),
        (0, -0.8),
    ],
)
def test_ease_factor_delta_table(quality, expected_delta):
    assert updated_ease_factor(2.5, quality) == pytest.approx(2.5 + expected_delta)


def test_ease_factor_floor_is_1_3():
    ef = 2.5
    for _ in range(10):
        ef = updated_ease_factor(ef, 0)
    assert ef == MIN_EASE_FACTOR


def test_first_success_sets_interval_to_one_day():
    result = review(SM2State(0, 1, 2.5), 5, now=NOW)
    assert leading(result) == {
        "passed": True,
        "repetition": 1,
        "interval": 1,
        "ease_factor": 2.6,
    }
    assert result.next_review_date == NOW + timedelta(days=1)


def test_second_success_sets_interval_to_six_days():
    result = review(SM2State(1, 1, 2.6), 5, now=NOW)
    assert leading(result) == {
        "passed": True,
        "repetition": 2,
        "interval": 6,
        "ease_factor": 2.7,
    }
    assert result.next_review_date == NOW + timedelta(days=6)


def test_subsequent_success_multiplies_by_pre_update_ease_factor():
    # interval 6 * EF 2.7 = 16.2 -> 16, and EF then rises to 2.8
    result = review(SM2State(2, 6, 2.7), 5, now=NOW)
    assert leading(result) == {
        "passed": True,
        "repetition": 3,
        "interval": 16,
        "ease_factor": 2.8,
    }


def test_quality_four_leaves_ease_factor_unchanged():
    result = review(SM2State(3, 16, 2.8), 4, now=NOW)
    assert leading(result) == {
        "passed": True,
        "repetition": 4,
        "interval": round(16 * 2.8),
        "ease_factor": 2.8,
    }


def test_failure_resets_repetition_and_interval():
    result = review(SM2State(5, 120, 2.66), 2, now=NOW)
    assert result.passed is False
    assert result.repetition == 0
    assert result.interval == 1
    assert result.ease_factor == pytest.approx(2.34)
    assert result.next_review_date == NOW + timedelta(days=1)


def test_quality_three_is_a_pass():
    assert review(SM2State(0, 1, 2.5), 3, now=NOW).passed is True


def test_quality_two_is_a_failure():
    assert review(SM2State(4, 30, 2.5), 2, now=NOW).passed is False


def test_long_grade_sequence_is_monotonic_and_bounded():
    state = initial_state()
    cursor = NOW
    intervals = []
    for _ in range(6):
        result = review(state, 5, now=cursor)
        state = result.state
        cursor = result.next_review_date
        intervals.append(result.interval)
    assert intervals[0] == 1
    assert intervals[1] == 6
    assert intervals == sorted(intervals)
    assert state.ease_factor == pytest.approx(2.5 + 0.6)


def test_project_schedule_dry_runs_without_mutating_input():
    state = SM2State(0, 1, 2.5)
    projected = project_schedule(state, [5, 5, 5], now=NOW)
    assert [p.interval for p in projected] == [1, 6, 16]
    assert state.repetition == 0 and state.interval == 1
    # each step schedules relative to the previous due date
    assert projected[1].next_review_date == NOW + timedelta(days=1 + 6)


def test_state_validation():
    with pytest.raises(SM2Error):
        SM2State(repetition=-1)
    with pytest.raises(SM2Error):
        SM2State(ease_factor=1.0)


def leading(result) -> dict:
    return {
        "passed": result.passed,
        "repetition": result.repetition,
        "interval": result.interval,
        "ease_factor": round(result.ease_factor, 2),
    }
