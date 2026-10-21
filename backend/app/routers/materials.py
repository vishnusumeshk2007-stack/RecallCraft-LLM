"""Material ingestion endpoints."""

from __future__ import annotations

import logging
import re

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Card, Material, MaterialChunk, ReviewState
from ..schemas import (
    ChunkOut,
    GenerationRequest,
    GenerationResult,
    MaterialCreate,
    MaterialDetail,
    MaterialOut,
)
from ..services.anki import AnkiExportError, build_anki_package
from ..services.extraction import ExtractionError
from ..services.generation import generate_cards
from ..services.ingest import IngestError, create_material, create_material_from_upload
from ..utils import utcnow

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/materials", tags=["materials"])

_UNSAFE_FILENAME_RE = re.compile(r"[^\w\-. ]+")


def get_material_or_404(db: Session, material_id: str) -> Material:
    material = db.get(Material, material_id)
    if material is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Material not found.")
    return material


def _counts(db: Session) -> tuple[dict[str, int], dict[str, int], dict[str, int]]:
    chunk_counts = dict(
        db.execute(
            select(MaterialChunk.material_id, func.count(MaterialChunk.id)).group_by(
                MaterialChunk.material_id
            )
        ).all()
    )
    card_counts = dict(
        db.execute(select(Card.material_id, func.count(Card.id)).group_by(Card.material_id)).all()
    )
    due_counts = dict(
        db.execute(
            select(Card.material_id, func.count(Card.id))
            .join(ReviewState, ReviewState.card_id == Card.id)
            .where(ReviewState.next_review_date <= utcnow())
            .group_by(Card.material_id)
        ).all()
    )
    return chunk_counts, card_counts, due_counts


def _to_out(material: Material, chunks: int, cards: int, due: int) -> MaterialOut:
    return MaterialOut(
        id=material.id,
        title=material.title,
        source_type=material.source_type,
        source_filename=material.source_filename,
        char_count=material.char_count,
        created_at=material.created_at,
        chunk_count=chunks,
        card_count=cards,
        due_count=due,
    )


def _apkg_filename(title: str) -> str:
    stem = _UNSAFE_FILENAME_RE.sub("", (title or "").strip()).strip() or "recallcraft-deck"
    return f"{stem[:80]}.apkg"


@router.post("", response_model=MaterialOut, status_code=status.HTTP_201_CREATED)
async def create_material_endpoint(payload: MaterialCreate, db: Session = Depends(get_db)):
    """Ingest pasted text or Markdown: chunk it and index embeddings."""
    try:
        material = await create_material(
            db, title=payload.title, content=payload.content, source_type=payload.source_type
        )
    except IngestError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    chunks, cards, due = _counts(db)
    return _to_out(material, chunks.get(material.id, 0), cards.get(material.id, 0), due.get(material.id, 0))


@router.post("/upload", response_model=MaterialOut, status_code=status.HTTP_201_CREATED)
async def upload_material_endpoint(
    file: UploadFile = File(..., description="PDF, Markdown or plain-text file"),
    title: str | None = Form(None),
    db: Session = Depends(get_db),
):
    """Ingest an uploaded PDF / Markdown / text file."""
    data = await file.read()
    try:
        material = await create_material_from_upload(
            db, filename=file.filename or "upload", data=data, title=title
        )
    except (ExtractionError, IngestError) as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    chunks, cards, due = _counts(db)
    return _to_out(material, chunks.get(material.id, 0), cards.get(material.id, 0), due.get(material.id, 0))


@router.get("", response_model=list[MaterialOut])
def list_materials(
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    materials = (
        db.execute(select(Material).order_by(Material.created_at.desc()).limit(limit)).scalars().all()
    )
    chunks, cards, due = _counts(db)
    return [
        _to_out(m, chunks.get(m.id, 0), cards.get(m.id, 0), due.get(m.id, 0)) for m in materials
    ]


@router.get("/{material_id}", response_model=MaterialDetail)
def get_material(material_id: str, db: Session = Depends(get_db)):
    material = get_material_or_404(db, material_id)
    chunks, cards, due = _counts(db)
    chunk_rows = (
        db.execute(
            select(MaterialChunk)
            .where(MaterialChunk.material_id == material_id)
            .order_by(MaterialChunk.ordinal)
        )
        .scalars()
        .all()
    )
    base = _to_out(material, chunks.get(material.id, 0), cards.get(material.id, 0), due.get(material.id, 0))
    return MaterialDetail(
        **base.model_dump(),
        raw_content=material.raw_content,
        chunks=[ChunkOut.model_validate(c) for c in chunk_rows],
    )


@router.get("/{material_id}/chunks", response_model=list[ChunkOut])
def list_chunks(material_id: str, db: Session = Depends(get_db)):
    get_material_or_404(db, material_id)
    rows = (
        db.execute(
            select(MaterialChunk)
            .where(MaterialChunk.material_id == material_id)
            .order_by(MaterialChunk.ordinal)
        )
        .scalars()
        .all()
    )
    return [ChunkOut.model_validate(c) for c in rows]


@router.post("/{material_id}/generate", response_model=GenerationResult)
async def generate_material_cards(
    material_id: str,
    payload: GenerationRequest,
    db: Session = Depends(get_db),
):
    """Run the LLM over the material's chunks to build the deck.

    Provider failures are returned in ``notes`` rather than raised so a partial
    batch is never thrown away.
    """
    material = get_material_or_404(db, material_id)
    return await generate_cards(db, material, payload)


@router.get("/{material_id}/export/anki")
def export_material_anki(material_id: str, db: Session = Depends(get_db)):
    """Package every card of this material as a downloadable Anki ``.apkg`` deck."""
    material = get_material_or_404(db, material_id)
    cards = list(
        db.execute(
            select(Card).where(Card.material_id == material_id).order_by(Card.created_at.asc())
        )
        .scalars()
        .all()
    )
    if not cards:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="This material has no cards yet — generate some before exporting.",
        )

    try:
        blob = build_anki_package(material, cards)
    except AnkiExportError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    return Response(
        content=blob,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{_apkg_filename(material.title)}"',
            "X-Card-Count": str(len(cards)),
        },
    )


@router.delete("/{material_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_material(material_id: str, db: Session = Depends(get_db)):
    material = get_material_or_404(db, material_id)
    db.delete(material)
    db.commit()
    return None
