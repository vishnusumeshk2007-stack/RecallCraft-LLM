"""Review submission + queue assembly.

Ties the three grading paths to the SM-2 scheduler:

* **flashcard**  -> learner self-grade, or a typed free-recall answer graded by
  the Socratic engine when one is supplied.
* **mcq**        -> deterministic auto-grade (correct = quality 5, wrong = 2).
* **open_ended** -> Socratic evaluation, whose ``grade`` becomes the SM-2 quality.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..models import Card, ReviewLog, ReviewState
from ..schemas import (
    CardOut,
    DueCard,
    QueueResponse,
    ReviewStateOut,
    ReviewSubmitRequest,
    ReviewSubmitResponse,
)
from ..utils import to_naive_utc, utcnow
from .sm2 import DEFAULT_EASE_FACTOR, SM2State, review
from .socratic import clamp_quality, evaluate_response, grade_mcq


def _state_for(card: Card, db: Session) -> ReviewState:
    state = card.review_state
    if state is None:
        state = ReviewState(
            card_id=card.id,
            repetition=0,
            interval=1,
            ease_factor=DEFAULT_EASE_FACTOR,
            next_review_date=utcnow(),
        )
        db.add(state)
        db.flush()
    return state


def _overdue_days(next_review_date: datetime, now: datetime) -> int:
    delta = (now - to_naive_utc(next_review_date)).days
    return max(0, delta)


# ---------------------------------------------------------------------------
# Queue
# ---------------------------------------------------------------------------


def build_queue(
    db: Session,
    *,
    limit: int = 20,
    material_id: str | None = None,
    card_type: str | None = None,
) -> QueueResponse:
    """Cards that are due now, most overdue first (new cards included)."""
    now = utcnow()

    filters = [ReviewState.next_review_date <= now]
    if material_id:
        filters.append(Card.material_id == material_id)
    if card_type:
        filters.append(Card.card_type == card_type)

    total_due = db.execute(
        select(func.count(Card.id)).join(ReviewState, ReviewState.card_id == Card.id).where(*filters)
    ).scalar_one()

    cards = (
        db.execute(
            select(Card)
            .join(ReviewState, ReviewState.card_id == Card.id)
            .where(*filters)
            .options(selectinload(Card.review_state), selectinload(Card.material))
            .order_by(ReviewState.next_review_date.asc(), Card.created_at.asc())
            .limit(limit)
        )
        .scalars()
        .all()
    )

    due_cards = []
    for card in cards:
        payload = CardOut.from_card(card, reveal=False)
        due_cards.append(
            DueCard(
                **payload.model_dump(exclude={"review_state"}),
                review_state=ReviewStateOut.model_validate(card.review_state)
                if card.review_state
                else None,
                overdue_days=_overdue_days(card.review_state.next_review_date, now)
                if card.review_state
                else 0,
            )
        )

    return QueueResponse(total_due=total_due, cards=due_cards)


# ---------------------------------------------------------------------------
# Submission
# ---------------------------------------------------------------------------


async def submit_review(
    db: Session,
    card: Card,
    request: ReviewSubmitRequest,
) -> ReviewSubmitResponse:
    state = _state_for(card, db)

    evaluation = None
    is_correct: bool | None = None
    offline_stub = False
    user_response = (request.user_response or "").strip() or None

    if card.card_type == "mcq":
        is_correct, quality = grade_mcq(card, request.selected_option_index)
        if request.selected_option_index is not None and card.options:
            user_response = card.options[request.selected_option_index]

    elif card.card_type == "open_ended":
        evaluation, offline_stub = await evaluate_response(card, request.user_response)
        quality = evaluation.grade

    elif user_response and len(user_response) >= 2:
        # Optimisation: a typed answer on a concept card gets graded too.
        evaluation, offline_stub = await evaluate_response(card, user_response)
        quality = evaluation.grade

    else:
        quality = clamp_quality(request.quality)

    result = review(
        SM2State(
            repetition=state.repetition,
            interval=state.interval,
            ease_factor=state.ease_factor,
        ),
        quality,
        now=utcnow(),
    )
    next_review_date = to_naive_utc(result.next_review_date)

    if request.commit:
        state.repetition = result.repetition
        state.interval = result.interval
        state.ease_factor = result.ease_factor
        state.next_review_date = next_review_date
        state.last_reviewed_at = utcnow()
        state.total_reviews += 1
        if quality < 3:
            state.lapses += 1

        db.add(
            ReviewLog(
                card_id=card.id,
                quality_rating=quality,
                user_response=user_response,
                socratic_feedback=evaluation.model_dump() if evaluation else None,
                interval_after=result.interval,
                ease_factor_after=result.ease_factor,
            )
        )
        db.commit()
        db.refresh(card)
        db.refresh(state)

    return ReviewSubmitResponse(
        card_id=card.id,
        card_type=card.card_type,
        quality=quality,
        passed=result.passed,
        is_correct=is_correct,
        user_response=user_response,
        evaluation=evaluation,
        answer_reveal=CardOut.from_card(card, reveal=True, include_state=False),
        review_state=ReviewStateOut.model_validate(state),
        next_review_date=next_review_date,
        interval=result.interval,
        ease_factor=result.ease_factor,
        repetition=result.repetition,
        offline_stub=offline_stub,
    )
