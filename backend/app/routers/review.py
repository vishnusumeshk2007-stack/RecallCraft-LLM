"""Review queue and answer submission endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Card, ReviewLog
from ..schemas import QueueResponse, ReviewLogOut, ReviewSubmitRequest, ReviewSubmitResponse
from ..services.review import build_queue, submit_review

router = APIRouter(prefix="/review", tags=["review"])


@router.get("/queue", response_model=QueueResponse)
def review_queue(
    limit: int = Query(20, ge=1, le=100),
    material_id: str | None = None,
    card_type: str | None = Query(None, pattern="^(flashcard|mcq|open_ended)$"),
    db: Session = Depends(get_db),
):
    """Cards whose ``next_review_date`` has passed, most overdue first.
    MCQ answer keys are withheld so the queue can't be inspected for the answer.
    """
    return build_queue(db, limit=limit, material_id=material_id, card_type=card_type)


@router.post("/submit", response_model=ReviewSubmitResponse)
async def submit(request: ReviewSubmitRequest, db: Session = Depends(get_db)):
    """Grade one answer and advance the SM-2 schedule.

    Payload depends on the card type:

    * ``flashcard``   -> ``{"quality": 0-5}``, or ``{"user_response": "..."}`` to
      have the Socratic engine grade a typed recall attempt.
    * ``mcq``         -> ``{"selected_option_index": 0-3}``
    * ``open_ended``  -> ``{"user_response": "..."}``

    Send ``"commit": false`` to grade without changing the schedule.
    """
    card = db.get(Card, request.card_id)
    if card is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Card not found.")

    if card.card_type == "mcq" and request.selected_option_index is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="MCQ cards require 'selected_option_index'.",
        )
    if (
        card.card_type == "open_ended"
        and request.quality is None
        and not (request.user_response or "").strip()
    ):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Open-ended cards require a 'user_response' to grade (or an explicit 'quality').",
        )

    return await submit_review(db, card, request)


@router.get("/logs", response_model=list[ReviewLogOut])
def recent_logs(limit: int = Query(50, ge=1, le=200), db: Session = Depends(get_db)):
    logs = (
        db.execute(select(ReviewLog).order_by(ReviewLog.reviewed_at.desc()).limit(limit))
        .scalars()
        .all()
    )
    return [ReviewLogOut.model_validate(log) for log in logs]
