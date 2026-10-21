"""Dashboard analytics: due counts, retention, streaks, trends and forecast."""

from __future__ import annotations

from collections import Counter
from datetime import date, datetime, time, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import Card, Material, ReviewLog, ReviewState
from ..schemas import ForecastPoint, StatsOut, TrendPoint
from ..utils import to_naive_utc, utcnow

PASS_QUALITY = 3
TREND_DAYS = 14
FORECAST_DAYS = 14
MATURE_INTERVAL = 21  # days — SM-2 "mature card" convention


def _day_start(day: date) -> datetime:
    return datetime.combine(day, time.min)


def _day_end(day: date) -> datetime:
    return datetime.combine(day, time.max)


def build_stats(db: Session) -> StatsOut:
    now = utcnow()
    today = now.date()

    total_materials = db.execute(select(func.count(Material.id))).scalar_one()
    total_cards = db.execute(select(func.count(Card.id))).scalar_one()

    type_rows = db.execute(select(Card.card_type, func.count(Card.id)).group_by(Card.card_type)).all()
    cards_by_type = {card_type: count for card_type, count in type_rows}
    for known in ("flashcard", "mcq", "open_ended"):
        cards_by_type.setdefault(known, 0)

    # ---- due buckets ------------------------------------------------------
    due_now = db.execute(
        select(func.count(ReviewState.card_id)).where(ReviewState.next_review_date <= now)
    ).scalar_one()

    end_of_today = _day_end(today)
    due_today = db.execute(
        select(func.count(ReviewState.card_id)).where(ReviewState.next_review_date <= end_of_today)
    ).scalar_one()

    # ---- maturity ---------------------------------------------------------
    states = db.execute(
        select(ReviewState.repetition, ReviewState.interval, ReviewState.ease_factor)
    ).all()

    new_cards = learning_cards = mature_cards = 0
    for repetition, interval, _ef in states:
        if interval >= MATURE_INTERVAL:
            mature_cards += 1
        elif repetition == 0:
            new_cards += 1
        else:
            learning_cards += 1

    avg_ef = round(sum(s[2] for s in states) / len(states), 3) if states else 0.0
    avg_interval = round(sum(s[1] for s in states) / len(states), 2) if states else 0.0

    # ---- review history ---------------------------------------------------
    logs = db.execute(select(ReviewLog.quality_rating, ReviewLog.reviewed_at)).all()
    total_reviews = len(logs)
    retention_rate = (
        round(sum(1 for q, _ in logs if q >= PASS_QUALITY) / total_reviews, 4) if total_reviews else 0.0
    )

    trend_start = _day_start(today - timedelta(days=TREND_DAYS - 1))
    per_day: Counter[str] = Counter()
    correct_per_day: Counter[str] = Counter()
    for quality, reviewed_at in logs:
        if reviewed_at < trend_start:
            continue
        key = to_naive_utc(reviewed_at).strftime("%Y-%m-%d")
        per_day[key] += 1
        if quality >= PASS_QUALITY:
            correct_per_day[key] += 1

    trend: list[TrendPoint] = []
    for offset in range(TREND_DAYS):
        key = (today - timedelta(days=TREND_DAYS - 1 - offset)).strftime("%Y-%m-%d")
        reviews = per_day.get(key, 0)
        correct = correct_per_day.get(key, 0)
        trend.append(
            TrendPoint(
                date=key,
                reviews=reviews,
                correct=correct,
                accuracy=round(correct / reviews, 4) if reviews else 0.0,
            )
        )

    accuracy_7d = 0.0
    window = trend[-7:]
    window_reviews = sum(p.reviews for p in window)
    if window_reviews:
        accuracy_7d = round(sum(p.correct for p in window) / window_reviews, 4)

    # ---- streak -----------------------------------------------------------
    streak_days = 0
    cursor = today
    if not per_day.get(cursor.strftime("%Y-%m-%d")):
        cursor = today - timedelta(days=1)  # a streak survives until today ends
    while per_day.get(cursor.strftime("%Y-%m-%d")):
        streak_days += 1
        cursor -= timedelta(days=1)

    # ---- forecast ---------------------------------------------------------
    upcoming = db.execute(select(ReviewState.next_review_date)).scalars().all()
    bucket: Counter[str] = Counter()
    overdue = 0
    for next_review in upcoming:
        next_review = to_naive_utc(next_review)
        if next_review <= now:
            overdue += 1
            continue
        delta = (next_review.date() - today).days
        if 0 <= delta < FORECAST_DAYS:
            bucket[(today + timedelta(days=delta)).strftime("%Y-%m-%d")] += 1

    forecast: list[ForecastPoint] = [
        ForecastPoint(date=today.strftime("%Y-%m-%d"), due=overdue)
    ]
    for offset in range(1, FORECAST_DAYS):
        key = (today + timedelta(days=offset)).strftime("%Y-%m-%d")
        forecast.append(ForecastPoint(date=key, due=bucket.get(key, 0)))

    return StatsOut(
        total_materials=total_materials,
        total_cards=total_cards,
        cards_by_type=cards_by_type,
        due_now=due_now,
        due_today=due_today,
        new_cards=new_cards,
        learning_cards=learning_cards,
        mature_cards=mature_cards,
        total_reviews=total_reviews,
        accuracy_7d=accuracy_7d,
        retention_rate=retention_rate,
        average_ease_factor=avg_ef,
        average_interval=avg_interval,
        streak_days=streak_days,
        trend=trend,
        forecast=forecast,
    )
