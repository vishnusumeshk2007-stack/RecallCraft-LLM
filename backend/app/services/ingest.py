"""Material ingestion: extract -> chunk -> embed -> persist."""

from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from ..models import Material, MaterialChunk
from .chunking import chunk_material
from .embeddings import get_embedder
from .extraction import extract_text

logger = logging.getLogger(__name__)

MIN_USEFUL_CHARS = 40


class IngestError(ValueError):
    """Raised when material cannot be turned into usable chunks."""


async def _store(
    db: Session,
    title: str,
    content: str,
    source_type: str,
    source_filename: str | None = None,
) -> Material:
    material = Material(
        title=title.strip()[:300] or "Untitled material",
        raw_content=content,
        source_type=source_type,
        source_filename=(source_filename or "").strip()[:255] or None,
        char_count=len(content),
    )
    db.add(material)
    db.flush()

    chunks = chunk_material(content)
    if not chunks:
        raise IngestError(
            "Could not extract enough text to build study material. "
            "Try pasting a longer passage."
        )

    embedder = get_embedder()
    vectors = await embedder.embed(chunks)

    for ordinal, (chunk, vector) in enumerate(zip(chunks, vectors)):
        db.add(
            MaterialChunk(
                material_id=material.id,
                ordinal=ordinal,
                content=chunk,
                embedding=vector,
                embedding_backend=embedder.name,
            )
        )

    db.commit()
    db.refresh(material)
    return material


async def create_material(
    db: Session,
    *,
    title: str,
    content: str,
    source_type: str = "text",
) -> Material:
    """Ingest pasted / typed material."""
    content = (content or "").strip()
    if len(content) < MIN_USEFUL_CHARS:
        raise IngestError(
            f"Material is too short ({len(content)} chars). Add at least "
            f"{MIN_USEFUL_CHARS} characters of study content."
        )
    return await _store(db, title, content, source_type)


async def create_material_from_upload(
    db: Session,
    *,
    filename: str,
    data: bytes,
    title: str | None = None,
) -> Material:
    """Ingest an uploaded PDF / Markdown / text file."""
    text, source_type = extract_text(filename, data)
    text = text.strip()
    if len(text) < MIN_USEFUL_CHARS:
        raise IngestError(
            f"Only {len(text)} characters of text were extracted from '{filename}'. "
            "It is probably a scanned or image-only document."
        )
    fallback_title = filename.rsplit(".", 1)[0].replace("_", " ").strip() or "Uploaded material"
    return await _store(db, title or fallback_title, text, source_type, source_filename=filename)
