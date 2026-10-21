"""Small shared helpers."""

from __future__ import annotations

from datetime import datetime, timezone


def utcnow() -> datetime:
    """Naive UTC 'now'.

    All ``DateTime`` columns are timezone-naive UTC so SQLite and Postgres
    behave identically and comparisons never mix aware/naive values.
    """
    return datetime.now(timezone.utc).replace(tzinfo=None)


def to_naive_utc(value: datetime) -> datetime:
    """Normalise any datetime to naive UTC."""
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def day_key(value: datetime) -> str:
    return to_naive_utc(value).strftime("%Y-%m-%d")
