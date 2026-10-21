"""Flashcard / MCQ / open-ended generation orchestration.

Flow per material:

    chunks ──▶ LLM (strict GeneratedItemSet) ──▶ candidate items
                                                    │
                                    embedding dedupe (cosine >= threshold)
                                                    │
                                              Card + ReviewState rows

Because the LLM is asked to return a single validated ``GeneratedItemSet`` per
chunk, a bad generation is rejected at the schema boundary and triggers the
client's repair loop instead of poisoning the deck.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..llm import LLMError, get_client
from ..llm.offline import offline_generate
from ..models import Card, Material, MaterialChunk, ReviewState
from ..schemas import CardOut, GeneratedItemSet, GenerationRequest, GenerationResult
from .embeddings import cosine_similarity, get_embedder
from .sm2 import DEFAULT_EASE_FACTOR

SYSTEM_PROMPT = """You are RecallCraft, an expert instructional designer who turns study \
material into high-quality spaced-repetition review items.

Non-negotiable rules:
1. Ground EVERY item strictly in the supplied source excerpt. Never invent facts.
2. Produce the three item types you are asked for, in the requested quantities.
3. Concept cards: front = one self-contained question or term (<= 200 chars); \
back = a tight 1-4 sentence explanation. Put any formula/rule in `key_formula`.
4. Diagnostic MCQs: exactly 4 plausible, distinct options. Distractors must encode \
real misconceptions, not absurd throwaways. `correct_option_index` is zero-based. \
Add one `distractor_explanations` entry for every incorrect option.
5. Open-ended questions: demand genuine reasoning (explain / compare / derive / predict). \
The rubric is 2-5 concrete, independently checkable key points. Never use yes/no questions.
6. `source_excerpt` must be a verbatim span copied from the source text.
7. Vary the items — do not ask the same thing twice.
8. `tags` are 1-4 short lowercase topic labels."""


def _normalize(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


def _build_user_prompt(title: str, chunk: str, counts: dict[str, int]) -> str:
    lines = [f"Material: {title}", "", "Source excerpt:", '"""', chunk, '"""', "", "Produce:"]
    if counts.get("concept_cards"):
        lines.append(f"- {counts['concept_cards']} concept card(s) in `concept_cards`")
    if counts.get("diagnostic_mcqs"):
        lines.append(f"- {counts['diagnostic_mcqs']} diagnostic MCQ(s) in `diagnostic_mcqs`")
    if counts.get("open_ended_questions"):
        lines.append(
            f"- {counts['open_ended_questions']} open-ended question(s) in `open_ended_questions`"
        )
    lines += [
        "",
        "Any array you were not asked for must be returned as an empty array.",
        "Return a single JSON object matching the schema.",
    ]
    return "\n".join(lines)


def _existing_index(db: Session) -> tuple[set[str], list[list[float]]]:
    """Normalised prompts + vectors of every card already in the deck."""
    rows = db.execute(select(Card.front_prompt, Card.embedding)).all()
    norms = {_normalize(prompt) for prompt, _ in rows if prompt}
    vectors = [emb for _, emb in rows if emb]
    return norms, vectors


def _is_duplicate(
    prompt: str,
    vector: list[float],
    norms: set[str],
    vectors: list[list[float]],
    threshold: float,
) -> bool:
    if _normalize(prompt) in norms:
        return True
    return any(cosine_similarity(vector, existing) >= threshold for existing in vectors)


async def _generate_for_chunk(
    title: str,
    chunk: str,
    counts: dict[str, int],
    *,
    offline: bool,
) -> tuple[GeneratedItemSet, str | None]:
    """Return ``(item_set, warning)``; never raises on provider failure."""
    if offline:
        return offline_generate(
            chunk,
            concept_cards=counts.get("concept_cards", 0),
            diagnostic_mcqs=counts.get("diagnostic_mcqs", 0),
            open_ended_questions=counts.get("open_ended_questions", 0),
        ), None

    client = get_client()
    try:
        item_set, _ = await client.complete_structured(
            SYSTEM_PROMPT,
            _build_user_prompt(title, chunk, counts),
            GeneratedItemSet,
            max_tokens=3072,
        )
        return item_set, None
    except LLMError as exc:
        return GeneratedItemSet(), f"{client.label}: {exc}"


async def _persist(
    db: Session,
    material: Material,
    chunk: MaterialChunk,
    item_set: GeneratedItemSet,
    *,
    vectors: list[list[float]],
    norms: set[str],
    remaining: dict[str, int],
    threshold: float,
    embedder,
) -> tuple[list[Card], int]:
    """Convert validated items into rows, skipping embedding-detected duplicates."""
    now = datetime.now(timezone.utc)
    created: list[Card] = []
    skipped = 0

    candidates: list[tuple[str, dict]] = []

    for item in item_set.concept_cards:
        if remaining["concept_cards"] <= 0:
            break
        back = item.back_answer.strip()
        if item.key_formula:
            back = f"{back}\n\nKey formula: {item.key_formula}".strip()
        candidates.append(
            (
                item.front_prompt.strip(),
                {
                    "material_id": material.id,
                    "card_type": "flashcard",
                    "front_prompt": item.front_prompt.strip(),
                    "back_answer": back,
                    "explanation": item.key_formula,
                    "source_chunk_id": chunk.id,
                    "source_excerpt": item.source_excerpt or chunk.content,
                    "tags": item.tags or None,
                },
            )
        )
        remaining["concept_cards"] -= 1

    for item in item_set.diagnostic_mcqs:
        if remaining["diagnostic_mcqs"] <= 0:
            break
        candidates.append(
            (
                item.question.strip(),
                {
                    "material_id": material.id,
                    "card_type": "mcq",
                    "front_prompt": item.question.strip(),
                    "back_answer": item.options[item.correct_option_index],
                    "options": item.options,
                    "correct_option_index": item.correct_option_index,
                    "explanation": item.explanation,
                    "distractor_explanations": {
                        str(d.option_index): d.why_wrong for d in item.distractor_explanations
                    },
                    "source_chunk_id": chunk.id,
                    "source_excerpt": item.source_excerpt or chunk.content,
                },
            )
        )
        remaining["diagnostic_mcqs"] -= 1

    for item in item_set.open_ended_questions:
        if remaining["open_ended_questions"] <= 0:
            break
        candidates.append(
            (
                item.prompt.strip(),
                {
                    "material_id": material.id,
                    "card_type": "open_ended",
                    "front_prompt": item.prompt.strip(),
                    "back_answer": item.model_answer,
                    "rubric": item.rubric,
                    "model_answer": item.model_answer,
                    "source_chunk_id": chunk.id,
                    "source_excerpt": item.source_excerpt or chunk.content,
                },
            )
        )
        remaining["open_ended_questions"] -= 1

    if not candidates:
        return created, skipped

    # One batched embedding call per chunk keeps the pipeline fast.
    embeddings = await embedder.embed([front for front, _ in candidates])

    for (front, payload), vector in zip(candidates, embeddings):
        if _is_duplicate(front, vector, norms, vectors, threshold):
            skipped += 1
            continue

        card = Card(**payload, embedding=vector)
        db.add(card)
        db.flush()
        db.add(
            ReviewState(
                card_id=card.id,
                repetition=0,
                interval=1,
                ease_factor=DEFAULT_EASE_FACTOR,
                next_review_date=now,
            )
        )
        norms.add(_normalize(front))
        vectors.append(vector)
        created.append(card)

    return created, skipped


async def generate_cards(
    db: Session,
    material: Material,
    request: GenerationRequest,
) -> GenerationResult:
    """Generate and persist review items for a material."""
    chunks: list[MaterialChunk] = list(
        db.execute(
            select(MaterialChunk)
            .where(MaterialChunk.material_id == material.id)
            .order_by(MaterialChunk.ordinal)
        )
        .scalars()
        .all()
    )
    if request.chunk_ids:
        wanted = set(request.chunk_ids)
        chunks = [c for c in chunks if c.id in wanted]
    if not chunks:
        return GenerationResult(
            material_id=material.id,
            provider="stub",
            model="none",
            offline_stub=True,
            notes=["This material has no chunks to generate from."],
        )

    remaining = {
        "concept_cards": request.concept_cards,
        "diagnostic_mcqs": request.diagnostic_mcqs,
        "open_ended_questions": request.open_ended_questions,
    }

    norms, vectors = _existing_index(db)
    embedder = get_embedder()

    client = get_client()
    offline = client.is_offline
    notes: list[str] = []
    created_cards: list[Card] = []
    skipped_total = 0
    processed = 0

    for chunk in chunks:
        if not any(v > 0 for v in remaining.values()):
            break

        per_chunk = {
            key: min(request.per_chunk, remaining[key]) if remaining[key] > 0 else 0
            for key in remaining
        }
        if not any(per_chunk.values()):
            break

        item_set, warning = await _generate_for_chunk(
            material.title, chunk.content, per_chunk, offline=offline
        )
        if warning and warning not in notes:
            notes.append(warning)
        processed += 1

        created, skipped = await _persist(
            db,
            material,
            chunk,
            item_set,
            vectors=vectors,
            norms=norms,
            remaining=remaining,
            threshold=settings.dedupe_threshold,
            embedder=embedder,
        )
        created_cards.extend(created)
        skipped_total += skipped

    if skipped_total:
        notes.append(
            f"Skipped {skipped_total} near-duplicate item(s) via embedding similarity "
            f"(threshold {settings.dedupe_threshold})."
        )

    db.commit()
    for card in created_cards:
        db.refresh(card)

    return GenerationResult(
        material_id=material.id,
        created=[CardOut.from_card(card) for card in created_cards],
        skipped_duplicates=skipped_total,
        chunks_processed=processed,
        provider=client.provider,
        model=client.model,
        offline_stub=offline,
        notes=notes,
    )
