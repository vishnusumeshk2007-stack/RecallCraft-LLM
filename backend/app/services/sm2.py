"""SuperMemo SM-2 spaced-repetition engine.

Implements the algorithm exactly as specified:

    quality  in [0, 5]
    if quality >= 3:
        n == 0 -> I = 1
        n == 1 -> I = 6
        n >  1 -> I = round(I * EF)
        n = n + 1
    else:
        n = 0, I = 1
    EF = EF + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
    EF = max(EF, 1.3)
    next_review_date = now + I days

The ease-factor update uses the *pre-update* EF when recomputing the interval,
which is the canonical SM-2 ordering.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

MIN_EASE_FACTOR = 1.3
DEFAULT_EASE_FACTOR = 2.5
PASS_THRESHOLD = 3
MAX_INTERVAL_DAYS = 365 * 10  # guard-rail against runaway intervals


class SM2Error(ValueError):
    """Raised when an SM-2 input is out of range."""


@dataclass(slots=True)
class SM2State:
    """The mutable retention state persisted in ``review_states``."""

    repetition: int = 0
    interval: int = 1
    ease_factor: float = DEFAULT_EASE_FACTOR

    def __post_init__(self) -> None:
        if self.repetition < 0:
            raise SM2Error("repetition must be >= 0")
        if self.interval < 0:
            raise SM2Error("interval must be >= 0")
        if self.ease_factor < MIN_EASE_FACTOR:
            raise SM2Error(f"ease_factor must be >= {MIN_EASE_FACTOR}")


@dataclass(slots=True)
class SM2Result:
    repetition: int
    interval: int
    ease_factor: float
    next_review_date: datetime
    passed: bool
    quality: int

    @property
    def state(self) -> SM2State:
        return SM2State(self.repetition, self.interval, self.ease_factor)


def updated_ease_factor(ease_factor: float, quality: int) -> float:
    """EF' = EF + (0.1 - (5-q)(0.08 + (5-q)0.02)), floored at 1.3."""
    if not 0 <= quality <= 5:
        raise SM2Error(f"quality must be between 0 and 5, got {quality}")
    delta = 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)
    return max(MIN_EASE_FACTOR, round(ease_factor + delta, 4))


def review(
    state: SM2State,
    quality: int,
    *,
    now: datetime | None = None,
) -> SM2Result:
    """Apply one graded review and return the next state + due date."""
    if not 0 <= quality <= 5:
        raise SM2Error(f"quality must be between 0 and 5, got {quality}")

    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)

    n = state.repetition
    interval = state.interval

    if quality >= PASS_THRESHOLD:
        if n == 0:
            interval = 1
        elif n == 1:
            interval = 6
        else:
            interval = round(interval * state.ease_factor)
        n += 1
        passed = True
    else:
        n = 0
        interval = 1
        passed = False

    interval = max(1, min(interval, MAX_INTERVAL_DAYS))
    ease_factor = updated_ease_factor(state.ease_factor, quality)
    next_review_date = now + timedelta(days=interval)

    return SM2Result(
        repetition=n,
        interval=interval,
        ease_factor=ease_factor,
        next_review_date=next_review_date,
        passed=passed,
        quality=quality,
    )


def project_schedule(
    state: SM2State,
    qualities: list[int],
    *,
    now: datetime | None = None,
) -> list[SM2Result]:
    """Dry-run a sequence of hypothetical grades (used by the UI preview)."""
    out: list[SM2Result] = []
    current = state
    cursor = now or datetime.now(timezone.utc)
    for q in qualities:
        result = review(current, q, now=cursor)
        out.append(result)
        current = result.state
        cursor = result.next_review_date
    return out


def initial_state() -> SM2State:
    return SM2State(repetition=0, interval=1, ease_factor=DEFAULT_EASE_FACTOR)
