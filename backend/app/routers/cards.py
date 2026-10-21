"""Deck browsing endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..models import Card, Material, MaterialChunk, ReviewLog, ReviewState
from ..schemas import CardLineage, CardOut, ReviewLogOut
from ..services.review import build_queue
from ..utils import utcnow

router = APIRouter(prefix="/cards", tags=["cards"])


@router.get("", response_model=list[CardOut])
def list_cards(
    material_id: str | None = None,
    card_type: str | None = Query(None, pattern="^(flashcard|mcq|open_ended)$"),
    search: str | None = Query(None, max_length=200),
    due_only: bool = False,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """Browse the deck. Answers are included — this is the study view."""
    stmt = (
        select(Card)
        .options(selectinload(Card.review_state), selectinload(Card.material))
        .order_by(Card.created_at.desc())
    )
    if material_id:
        stmt = stmt.where(Card.material_id == material_id)
    if card_type:
        stmt = stmt.where(Card.card_type == card_type)
    if search:
        pattern = f"%{search.lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(Card.front_prompt).like(pattern),
                func.lower(Card.back_answer).like(pattern),
            )
        )
    if due_only:
        stmt = stmt.join(ReviewState, ReviewState.card_id == Card.id).where(
            ReviewState.next_review_date <= utcnow()
        )

    cards = db.execute(stmt.limit(limit).offset(offset)).scalars().all()
    return [CardOut.from_card(c) for c in cards]


@router.get("/{card_id}", response_model=CardOut)
def get_card(card_id: str, db: Session = Depends(get_db)):
    card = db.get(Card, card_id)
    if card is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Card not found.")
    return CardOut.from_card(card)


@router.get("/{card_id}/history", response_model=list[ReviewLogOut])
def card_history(card_id: str, limit: int = Query(50, ge=1, le=200), db: Session = Depends(get_db)):
    if db.get(Card, card_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Card not found.")
    logs = (
        db.execute(
            select(ReviewLog)
            .where(ReviewLog.card_id == card_id)
            .order_by(ReviewLog.reviewed_at.desc())
            .limit(limit)
        )
        .scalars()
        .all()
    )
    return [ReviewLogOut.model_validate(log) for log in logs]


@router.get("/{card_id}/lineage", response_model=CardLineage)
def card_lineage(card_id: str, db: Session = Depends(get_db)):
    """Full provenance for one card: source chunk text + originating file."""
    card = db.get(Card, card_id)
    if card is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Card not found.")

    material = card.material or db.get(Material, card.material_id)
    chunk = db.get(MaterialChunk, card.source_chunk_id) if card.source_chunk_id else None
    total_chunks = db.execute(
        select(func.count(MaterialChunk.id)).where(MaterialChunk.material_id == card.material_id)
    ).scalar_one()

    return CardLineage(
        card_id=card.id,
        card_type=card.card_type,
        material_id=card.material_id,
        material_title=getattr(material, "title", None) or "Untitled material",
        source_filename=getattr(material, "source_filename", None),
        source_type=getattr(material, "source_type", None),
        chunk_id=chunk.id if chunk else None,
        chunk_ordinal=chunk.ordinal if chunk else None,
        chunk_text=chunk.content if chunk else None,
        source_excerpt=card.source_excerpt,
        total_chunks=total_chunks,
    )


@router.delete("/{card_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_card(card_id: str, db: Session = Depends(get_db)):
    card = db.get(Card, card_id)
    if card is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Card not found.")
    db.delete(card)
    db.commit()
    return None


@router.get("/due/queue", response_model=dict)
def due_queue(
    limit: int = Query(20, ge=1, le=100),
    material_id: str | None = None,
    card_type: str | None = Query(None, pattern="^(flashcard|mcq|open_ended)$"),
    db: Session = Depends(get_db),
):
    """Alias for ``GET /api/review/queue`` kept for convenience."""
    return build_queue(db, limit=limit, material_id=material_id, card_type=card_type).model_dump()
