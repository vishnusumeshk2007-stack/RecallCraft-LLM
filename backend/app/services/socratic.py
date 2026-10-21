"""Socratic evaluation engine.

Grades a typed, free-form answer against the source notes and the card's rubric,
then returns a fully structured verdict. The output doubles as the SM-2
``quality`` signal, so grading and scheduling stay in lock-step.
"""

from __future__ import annotations

import logging

from ..llm import LLMError, get_client
from ..llm.offline import offline_grade
from ..models import Card
from ..schemas import SocraticEvaluation

logger = logging.getLogger(__name__)

MAX_RESPONSE_CHARS = 8000

SYSTEM_PROMPT = """You are RecallCraft's Socratic examiner. You grade a learner's \
free-form recall attempt against the source material, then coach them with a question \
rather than a lecture.

Grading rubric — return `grade` as an integer 0-5:
  5  Flawless: every essential nuance present, precise terminology.
  4  Correct with minor omissions or slight imprecision.
  3  Adequate: the gist is right but noticeably shallow or incomplete.
  2  Partial: one fragment correct, major gaps remain.
  1  Mostly wrong: touches the topic but the substance is incorrect.
  0  No relevant knowledge, off-topic, or blank.

Rules for the remaining fields:
- `matched_points`: concrete things the learner DID say that are correct. Quote or
  closely paraphrase their own wording. Empty list if nothing is right.
- `missing_nuances`: the specific rubric points / source details absent from the
  answer. Be precise — "did not mention that EF floors at 1.3", not "needs more detail".
- `socratic_feedback`: 2-3 sentences maximum. Name the single most important gap and
  end with a guiding question that helps them find it themselves. NEVER state the
  full correct answer, and never list the missing points verbatim.
- Judge only what the learner wrote. Do not give credit for what they implied."""


def _user_prompt(card: Card, response: str) -> str:
    rubric = "\n".join(f"- {point}" for point in (card.rubric or [])) or "- (no explicit rubric)"
    return (
        f"Question asked:\n{card.front_prompt}\n\n"
        f"Grading rubric / key points:\n{rubric}\n\n"
        f"Reference answer:\n{card.model_answer or card.back_answer}\n\n"
        f"Source excerpt from the learner's notes:\n\"\"\"\n{(card.source_excerpt or '')[:3000]}\n\"\"\"\n\n"
        f"Learner's answer:\n\"\"\"\n{response}\n\"\"\"\n\n"
        "Grade the learner's answer."
    )


def _blank_evaluation(points: list[str]) -> SocraticEvaluation:
    return SocraticEvaluation(
        grade=0,
        matched_points=[],
        missing_nuances=points or ["No answer was submitted."],
        socratic_feedback=(
            "You left this blank rather than guessing. Try free-recall first — writing down "
            "even a partial structure gives the scheduler a much better signal than a skip. "
            "What is the first thing you remember about this topic?"
        ),
    )


async def evaluate_response(card: Card, user_response: str | None) -> tuple[SocraticEvaluation, bool]:
    """Grade a free-form answer.

    Returns ``(evaluation, offline_stub)``. Never raises: if the provider fails
    we fall back to the deterministic keyword grader so a review is never lost.
    """
    response = (user_response or "").strip()[:MAX_RESPONSE_CHARS]

    if len(response) < 2:
        return _blank_evaluation(list(card.rubric or [])), False

    client = get_client()
    if client.is_offline:
        return (
            offline_grade(
                user_response=response,
                rubric=card.rubric,
                model_answer=card.model_answer or card.back_answer,
                source_excerpt=card.source_excerpt,
            ),
            True,
        )

    try:
        evaluation, _ = await client.complete_structured(
            SYSTEM_PROMPT,
            _user_prompt(card, response),
            SocraticEvaluation,
            max_tokens=1200,
        )
        return evaluation, False
    except LLMError as exc:
        logger.warning("Socratic grading fell back to offline grader: %s", exc)
        return (
            offline_grade(
                user_response=response,
                rubric=card.rubric,
                model_answer=card.model_answer or card.back_answer,
                source_excerpt=card.source_excerpt,
            ),
            True,
        )


def grade_mcq(card: Card, selected_option_index: int | None) -> tuple[bool, int]:
    """Auto-grade a diagnostic MCQ. Returns ``(is_correct, sm2_quality)``."""
    is_correct = (
        selected_option_index is not None
        and card.correct_option_index is not None
        and selected_option_index == card.correct_option_index
    )
    # Correct -> 5 (perfect recall), wrong -> 2 (a genuine failure that resets
    # the SM-2 interval but records that the topic is at least familiar).
    return is_correct, (5 if is_correct else 2)


def clamp_quality(quality: int | None) -> int:
    """Coerce a self-reported flashcard grade into the SM-2 0-5 range."""
    if quality is None:
        return 4
    return max(0, min(5, int(quality)))
