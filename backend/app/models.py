"""SQLAlchemy ORM models.

Mirrors the schema from the project spec, with three clearly-necessary
extensions that the functional requirements ask for:

* ``material_chunks``  -> stores indexed chunks + their embeddings so every
  card can carry a ``source_chunk_id`` / ``source_excerpt`` back-reference
  (requirement 2.A).
* ``cards.correct_option_index`` + ``cards.distractor_explanations`` -> lets an
  MCQ store "correct option index" and "why each distractor is wrong"
  (requirement 2.B.2) while keeping ``options`` as a plain JSON array of
  strings exactly as specified.
* ``codes.embedding`` / ``material_chunks.embedding`` -> JSON-stored vectors
  used for duplicate-flashcard suppression. JSON keeps SQLite and Postgres
  identical without requiring pgvector; a pgvector column can be swapped in
  later behind the same repository layer.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base
from .utils import utcnow


def _uuid() -> str:
    return uuid.uuid4().hex


class Material(Base):
    __tablename__ = "materials"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    raw_content: Mapped[str] = mapped_column(Text, nullable=False)
    source_type: Mapped[str] = mapped_column(String(16), nullable=False, default="text")
    # Original upload name, kept so a card's lineage drawer can name its file.
    source_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    char_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    chunks: Mapped[list["MaterialChunk"]] = relationship(
        back_populates="material", cascade="all, delete-orphan", order_by="MaterialChunk.ordinal"
    )
    cards: Mapped[list["Card"]] = relationship(
        back_populates="material", cascade="all, delete-orphan"
    )


class MaterialChunk(Base):
    """A semantically-coherent slice of a material, with its vector."""

    __tablename__ = "material_chunks"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    material_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("materials.id", ondelete="CASCADE"), nullable=False, index=True
    )
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[list | None] = mapped_column(JSON, nullable=True)
    embedding_backend: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    material: Mapped[Material] = relationship(back_populates="chunks")


class Card(Base):
    __tablename__ = "cards"
    __table_args__ = (
        CheckConstraint(
            "card_type IN ('flashcard', 'mcq', 'open_ended')", name="ck_cards_card_type"
        ),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    material_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("materials.id", ondelete="CASCADE"), nullable=False, index=True
    )
    card_type: Mapped[str] = mapped_column(String(16), nullable=False)

    front_prompt: Mapped[str] = mapped_column(Text, nullable=False)
    back_answer: Mapped[str] = mapped_column(Text, nullable=False)

    # MCQ payload: list[str]; NULL for flashcard / open_ended
    options: Mapped[list | None] = mapped_column(JSON, nullable=True)
    correct_option_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    explanation: Mapped[str | None] = mapped_column(Text, nullable=True)
    # {"2": "why option 2 is wrong", ...}
    distractor_explanations: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # open_ended payload: list[str] of key points / rubric
    rubric: Mapped[list | None] = mapped_column(JSON, nullable=True)
    model_answer: Mapped[str | None] = mapped_column(Text, nullable=True)

    # provenance
    source_chunk_id: Mapped[str | None] = mapped_column(
        String(32), ForeignKey("material_chunks.id", ondelete="SET NULL"), nullable=True
    )
    source_excerpt: Mapped[str | None] = mapped_column(Text, nullable=True)

    tags: Mapped[list | None] = mapped_column(JSON, nullable=True)
    embedding: Mapped[list | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    material: Mapped[Material] = relationship(back_populates="cards")
    review_state: Mapped["ReviewState | None"] = relationship(
        back_populates="card", cascade="all, delete-orphan", uselist=False
    )
    logs: Mapped[list["ReviewLog"]] = relationship(
        back_populates="card", cascade="all, delete-orphan"
    )


class ReviewState(Base):
    """SM-2 retention state, one row per card."""

    __tablename__ = "review_states"

    card_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("cards.id", ondelete="CASCADE"), primary_key=True
    )
    repetition: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    interval: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    ease_factor: Mapped[float] = mapped_column(Float, nullable=False, default=2.5)
    next_review_date: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False, index=True)
    last_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    total_reviews: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    lapses: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    card: Mapped[Card] = relationship(back_populates="review_state")


class ReviewLog(Base):
    """Immutable audit log of every graded response."""

    __tablename__ = "review_logs"
    __table_args__ = (
        CheckConstraint("quality_rating BETWEEN 0 AND 5", name="ck_review_logs_quality"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    card_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("cards.id", ondelete="CASCADE"), nullable=False, index=True
    )
    quality_rating: Mapped[int] = mapped_column(Integer, nullable=False)
    user_response: Mapped[str | None] = mapped_column(Text, nullable=True)
    socratic_feedback: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    interval_after: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ease_factor_after: Mapped[float | None] = mapped_column(Float, nullable=True)
    reviewed_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False, index=True)

    card: Mapped[Card] = relationship(back_populates="logs")
