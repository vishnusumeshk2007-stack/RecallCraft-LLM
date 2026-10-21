"""Pydantic v2 schemas.

Two families live here:

1. **LLM contract schemas** (``GeneratedItemSet`` and friends). These are handed
   to the model as a JSON schema and re-validated on the way back, so a
   malformed generation can never reach the database.
2. **HTTP schemas** for the REST API.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# ---------------------------------------------------------------------------
# 1. LLM structured-output contracts
# ---------------------------------------------------------------------------

CardType = Literal["flashcard", "mcq", "open_ended"]


class ConceptCard(BaseModel):
    """Front (question/term) + Back (explanation incl. key formula/concept)."""

    front_prompt: Annotated[
        str, Field(description="A single self-contained question or term, <= 200 chars.")
    ]
    back_answer: Annotated[
        str, Field(description="Concise explanation answering the front, 1-4 sentences.")
    ]
    key_formula: Annotated[
        str | None, Field(description="Key formula / rule / definition, or null if none applies.")
    ] = None
    source_excerpt: Annotated[
        str, Field(description="Verbatim span from the source notes that justifies this card.")
    ]
    tags: Annotated[list[str], Field(description="1-4 lowercase topic tags.")] = Field(
        default_factory=list
    )


class DistractorExplanation(BaseModel):
    option_index: Annotated[int, Field(ge=0, le=3, description="Zero-based index of the option.")]
    why_wrong: Annotated[str, Field(description="One sentence explaining the misconception.")]


class DiagnosticMCQ(BaseModel):
    """Question + exactly 4 options + correct index + distractor diagnostics."""

    question: Annotated[str, Field(description="The multiple-choice question stem.")]
    options: Annotated[
        list[str], Field(description="Exactly 4 answer options, as plain strings.")
    ]
    correct_option_index: Annotated[
        int, Field(ge=0, le=3, description="Zero-based index of the correct option.")
    ]
    explanation: Annotated[str, Field(description="Why the correct option is correct.")]
    distractor_explanations: Annotated[
        list[DistractorExplanation],
        Field(description="One entry per incorrect option, explaining the misconception."),
    ]
    source_excerpt: str

    @field_validator("options")
    @classmethod
    def _exactly_four_distinct_options(cls, value: list[str]) -> list[str]:
        cleaned = [o.strip() for o in value]
        if len(cleaned) != 4:
            raise ValueError(f"need exactly 4 options, got {len(cleaned)}")
        if len(set(cleaned)) != 4:
            raise ValueError("options must be distinct")
        return cleaned

    @model_validator(mode="after")
    def _distractors_cover_wrong_options(self):
        wrong = {i for i in range(4) if i != self.correct_option_index}
        provided = {d.option_index for d in self.distractor_explanations}
        if not provided:
            raise ValueError("distractor_explanations must not be empty")
        # Tolerate extra/partial coverage but drop anything pointing at the key.
        self.distractor_explanations = [
            d for d in self.distractor_explanations if d.option_index in wrong
        ]
        if not self.distractor_explanations:
            raise ValueError("no valid distractor_explanations survived validation")
        return self


class OpenEndedQuestion(BaseModel):
    """Deep-reasoning prompt + rubric / key points used by the Socratic grader."""

    prompt: Annotated[str, Field(description="An open-ended reasoning question, no yes/no answers.")]
    rubric: Annotated[
        list[str],
        Field(
            min_length=2,
            description="2-5 key points a strong answer must contain. Used as the grading rubric.",
        ),
    ]
    model_answer: Annotated[str, Field(description="An exemplar full-marks answer.")]
    source_excerpt: str


class GeneratedItemSet(BaseModel):
    """Top-level object the LLM must return."""

    concept_cards: list[ConceptCard] = Field(default_factory=list)
    diagnostic_mcqs: list[DiagnosticMCQ] = Field(default_factory=list)
    open_ended_questions: list[OpenEndedQuestion] = Field(default_factory=list)


class SocraticEvaluation(BaseModel):
    """Result of grading a typed answer against the source notes."""

    grade: Annotated[
        int,
        Field(
            ge=0,
            le=5,
            description=(
                "SM-2 quality rating. 5=flawless, 4=correct with minor gaps, "
                "3=adequate but shallow, 2=partial/major gaps, 1=mostly wrong, "
                "0=no relevant knowledge."
            ),
        ),
    ]
    matched_points: Annotated[list[str], Field(description="Nuances the learner got right.")]
    missing_nuances: Annotated[list[str], Field(description="Essential details that were missed.")]
    socratic_feedback: Annotated[
        str,
        Field(
            description=(
                "2-3 sentences. Name the gap and ask a guiding question. "
                "Never state the full answer outright."
            )
        ),
    ]


# ---------------------------------------------------------------------------
# 2. HTTP schemas
# ---------------------------------------------------------------------------


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class MaterialCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    content: str = Field(min_length=1)
    source_type: Literal["text", "markdown"] = "text"


class ChunkOut(ORMModel):
    id: str
    ordinal: int
    content: str
    embedding_backend: str | None = None


class CardLineage(BaseModel):
    """Where a card came from: its source chunk and the file behind it."""

    card_id: str
    card_type: CardType
    material_id: str
    material_title: str
    source_filename: str | None = None
    source_type: str | None = None
    chunk_id: str | None = None
    chunk_ordinal: int | None = None
    chunk_text: str | None = None
    source_excerpt: str | None = None
    total_chunks: int = 0


class ReviewStateOut(ORMModel):
    repetition: int
    interval: int
    ease_factor: float
    next_review_date: datetime
    last_reviewed_at: datetime | None = None
    total_reviews: int
    lapses: int


class CardOut(ORMModel):
    id: str
    material_id: str
    material_title: str | None = None
    card_type: CardType
    front_prompt: str
    back_answer: str
    options: list[str] | None = None
    correct_option_index: int | None = None
    explanation: str | None = None
    distractor_explanations: dict[str, str] | None = None
    rubric: list[str] | None = None
    model_answer: str | None = None
    source_chunk_id: str | None = None
    source_excerpt: str | None = None
    tags: list[str] | None = None
    created_at: datetime
    review_state: ReviewStateOut | None = None

    @classmethod
    def from_card(cls, card, *, reveal: bool = True, include_state: bool = True) -> "CardOut":
        """Build a card payload, optionally hiding the answer key.

        ``reveal=False`` is used by the review queue so an MCQ cannot be
        answered by inspecting the network response.
        """
        state = None
        if include_state and card.review_state is not None:
            state = ReviewStateOut.model_validate(card.review_state)

        return cls(
            id=card.id,
            material_id=card.material_id,
            material_title=getattr(card.material, "title", None),
            card_type=card.card_type,
            front_prompt=card.front_prompt,
            back_answer=card.back_answer if reveal else "",
            options=card.options,
            correct_option_index=card.correct_option_index if reveal else None,
            explanation=card.explanation if reveal else None,
            distractor_explanations=card.distractor_explanations if reveal else None,
            rubric=card.rubric if reveal else None,
            model_answer=card.model_answer if reveal else None,
            source_chunk_id=card.source_chunk_id,
            source_excerpt=card.source_excerpt,
            tags=card.tags,
            created_at=card.created_at,
            review_state=state,
        )


class MaterialOut(ORMModel):
    id: str
    title: str
    source_type: str
    source_filename: str | None = None
    char_count: int
    created_at: datetime
    chunk_count: int = 0
    card_count: int = 0
    due_count: int = 0


class MaterialDetail(MaterialOut):
    raw_content: str
    chunks: list[ChunkOut] = Field(default_factory=list)


class GenerationRequest(BaseModel):
    """How many of each item type to produce.

    ``per_chunk`` drives the fan-out: each selected chunk is asked for up to
    ``per_chunk`` items of every type.
    """

    concept_cards: int = Field(default=0, ge=0, le=60)
    diagnostic_mcqs: int = Field(default=0, ge=0, le=60)
    open_ended_questions: int = Field(default=0, ge=0, le=60)
    per_chunk: int = Field(default=2, ge=1, le=5, description="Items of each type requested per chunk.")
    chunk_ids: list[str] | None = None

    @model_validator(mode="after")
    def _require_something(self):
        if not (self.concept_cards or self.diagnostic_mcqs or self.open_ended_questions):
            raise ValueError("Request at least one item type to generate.")
        return self


class GenerationResult(BaseModel):
    material_id: str
    created: list[CardOut] = Field(default_factory=list)
    skipped_duplicates: int = 0
    chunks_processed: int = 0
    provider: str
    model: str
    offline_stub: bool = False
    notes: list[str] = Field(default_factory=list)


class ReviewSubmitRequest(BaseModel):
    card_id: str
    # flashcard -> self-reported quality (0-5)
    quality: int | None = Field(default=None, ge=0, le=5)
    # mcq -> which option was clicked
    selected_option_index: int | None = Field(default=None, ge=0, le=3)
    # open_ended (and optionally flashcard) -> typed recall attempt
    user_response: str | None = None
    # when False the Socratic grader runs as a preview and nothing is persisted
    commit: bool = True


class ReviewSubmitResponse(BaseModel):
    card_id: str
    card_type: CardType
    quality: int
    passed: bool
    is_correct: bool | None = None
    user_response: str | None = None
    evaluation: SocraticEvaluation | None = None
    answer_reveal: CardOut | None = None
    review_state: ReviewStateOut | None = None
    next_review_date: datetime
    interval: int
    ease_factor: float
    repetition: int
    offline_stub: bool = False


class DueCard(CardOut):
    overdue_days: int = 0


class QueueResponse(BaseModel):
    total_due: int
    cards: list[DueCard] = Field(default_factory=list)


class TrendPoint(BaseModel):
    date: str
    reviews: int
    correct: int
    accuracy: float


class ForecastPoint(BaseModel):
    date: str
    due: int


class StatsOut(BaseModel):
    total_materials: int
    total_cards: int
    cards_by_type: dict[str, int]
    due_now: int
    due_today: int
    new_cards: int
    learning_cards: int
    mature_cards: int
    total_reviews: int
    accuracy_7d: float
    retention_rate: float
    average_ease_factor: float
    average_interval: float
    streak_days: int
    trend: list[TrendPoint] = Field(default_factory=list)
    forecast: list[ForecastPoint] = Field(default_factory=list)


class ReviewLogOut(ORMModel):
    id: str
    card_id: str
    quality_rating: int
    user_response: str | None = None
    socratic_feedback: dict | None = None
    interval_after: int | None = None
    ease_factor_after: float | None = None
    reviewed_at: datetime


class HealthOut(BaseModel):
    status: str
    app: str
    version: str
    database: str
    llm_provider: str
    llm_model: str
    llm_configured: bool
    offline_stub: bool
    embedding_backend: str


class LLMTestRequest(BaseModel):
    prompt: str = "In one sentence, what is spaced repetition?"


class LLMTestResponse(BaseModel):
    ok: bool
    provider: str
    model: str
    offline_stub: bool
    latency_ms: int
    output: str = ""
    error: str | None = None


class DeckResetResponse(BaseModel):
    deleted_cards: int
    deleted_materials: int


__all__ = [
    "ConceptCard",
    "DiagnosticMCQ",
    "DistractorExplanation",
    "OpenEndedQuestion",
    "GeneratedItemSet",
    "SocraticEvaluation",
    "MaterialCreate",
    "MaterialOut",
    "MaterialDetail",
    "ChunkOut",
    "CardLineage",
    "CardOut",
    "DueCard",
    "QueueResponse",
    "GenerationRequest",
    "GenerationResult",
    "ReviewSubmitRequest",
    "ReviewSubmitResponse",
    "ReviewStateOut",
    "ReviewLogOut",
    "StatsOut",
    "TrendPoint",
    "ForecastPoint",
    "HealthOut",
    "LLMTestRequest",
    "LLMTestResponse",
    "DeckResetResponse",
]
