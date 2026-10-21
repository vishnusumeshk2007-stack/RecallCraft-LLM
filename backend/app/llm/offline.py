"""Deterministic offline engine.

Keeps RecallCraft fully functional with **zero API keys**: it turns a chunk of
notes into flashcards / MCQs / open-ended questions with heuristics, and grades
typed answers by rubric-keyword coverage. Quality is obviously below an LLM's,
but it exercises the exact same schemas, SM-2 pipeline and UI, which makes it
ideal for local development, demos and tests.
"""

from __future__ import annotations

import re

from ..schemas import (
    ConceptCard,
    DiagnosticMCQ,
    DistractorExplanation,
    GeneratedItemSet,
    OpenEndedQuestion,
    SocraticEvaluation,
)
from ..services.chunking import split_sentences
from ..services.embeddings import content_words as _content_words

_FORMULA_HINT_RE = re.compile(r"[=∝≈≤≥]|\bsum\b|\b∫\b|\bderivative\b|\brate of\b")
_DEFINITION_RE = re.compile(
    r"^(?P<term>[A-Z][\w\s\-'()]{2,60}?)\s+(?:is|are|refers to|means|describes|"
    r"denotes|represents|consists of|is defined as)\s+(?P<body>.+)$"
)
_KEYWORD_LABEL_RE = re.compile(r"^\s*([A-Za-z][A-Za-z0-9 \-/]{2,40}):\s+(.+)$")


def _clean(sentence: str) -> str:
    return " ".join(sentence.split()).strip(" -–—•*#")


def _top_terms(text: str, limit: int = 8) -> list[str]:
    seen: list[str] = []
    for word in _content_words(text):
        if word not in seen:
            seen.append(word)
        if len(seen) >= limit:
            break
    return seen


def _blank_out(sentence: str, term: str) -> str:
    pattern = re.compile(rf"\b{re.escape(term)}\b", re.IGNORECASE)
    return pattern.sub("________", sentence, count=1)


# ---------------------------------------------------------------------------
# Generation
# ---------------------------------------------------------------------------


def offline_generate(
    chunk: str,
    *,
    concept_cards: int = 0,
    diagnostic_mcqs: int = 0,
    open_ended_questions: int = 0,
) -> GeneratedItemSet:
    sentences = [s for s in (_clean(s) for s in split_sentences(chunk)) if len(s) > 40]
    if not sentences:
        return GeneratedItemSet()

    vocab: list[str] = []
    for sentence in sentences:
        for term in _top_terms(sentence, 4):
            if term not in vocab:
                vocab.append(term)

    result = GeneratedItemSet()

    # --- concept cards -----------------------------------------------------
    for sentence in sentences:
        if len(result.concept_cards) >= concept_cards:
            break

        definition = _DEFINITION_RE.match(sentence)
        if definition:
            term = definition.group("term").strip()
            result.concept_cards.append(
                ConceptCard(
                    front_prompt=f"What is {term}?",
                    back_answer=definition.group("body").strip().rstrip(".") + ".",
                    key_formula=sentence if _FORMULA_HINT_RE.search(sentence) else None,
                    source_excerpt=sentence,
                    tags=_top_terms(term, 3),
                )
            )
            continue

        label = _KEYWORD_LABEL_RE.match(sentence)
        if label:
            result.concept_cards.append(
                ConceptCard(
                    front_prompt=f"Define: {label.group(1).strip()}",
                    back_answer=label.group(2).strip(),
                    source_excerpt=sentence,
                    tags=_top_terms(label.group(1), 3),
                )
            )
            continue

        terms = _top_terms(sentence, 3)
        if not terms:
            continue
        answer = terms[0]
        result.concept_cards.append(
            ConceptCard(
                front_prompt=f"Fill in the blank: {_blank_out(sentence, answer)}",
                back_answer=f"{answer} — as stated in: {sentence}",
                source_excerpt=sentence,
                tags=terms,
            )
        )

    # --- diagnostic MCQs ---------------------------------------------------
    distractors = [t for t in vocab if len(t) > 3][:40]
    for idx, sentence in enumerate(sentences):
        if len(result.diagnostic_mcqs) >= diagnostic_mcqs:
            break
        terms = _top_terms(sentence, 3)
        if not terms:
            continue
        answer = terms[0]
        pool = [t for t in distractors if t.lower() != answer.lower()]
        if len(pool) < 3:
            continue
        picks = [pool[(idx * 3 + k) % len(pool)] for k in range(3)]
        picks = list(dict.fromkeys(picks))
        while len(picks) < 3:
            picks.append(f"{answer}_alt{len(picks)}")

        options = [answer, *picks[:3]]
        rotation = idx % 4
        options = options[rotation:] + options[:rotation]
        correct_index = options.index(answer)

        result.diagnostic_mcqs.append(
            DiagnosticMCQ(
                question=f"Which term correctly completes this statement? “{_blank_out(sentence, answer)}”",
                options=options,
                correct_option_index=correct_index,
                explanation=f"“{answer}” is the term used in the source notes.",
                distractor_explanations=[
                    DistractorExplanation(
                        option_index=i,
                        why_wrong=f"“{opt}” is a different concept from the same material and does not fit this statement.",
                    )
                    for i, opt in enumerate(options)
                    if i != correct_index
                ],
                source_excerpt=sentence,
            )
        )

    # --- open-ended questions ---------------------------------------------
    for idx, sentence in enumerate(sentences):
        if len(result.open_ended_questions) >= open_ended_questions:
            break
        terms = _top_terms(sentence, 4)
        if len(terms) < 2:
            continue
        focus = terms[0]
        rubric = [
            f"Mentions {t}" if t != focus else f"Defines or uses “{focus}” correctly"
            for t in terms[:4]
        ]
        result.open_ended_questions.append(
            OpenEndedQuestion(
                prompt=(
                    f"Explain in your own words how “{focus}” works and why it matters here. "
                    "Be specific about the underlying mechanism."
                ),
                rubric=rubric,
                model_answer=sentence,
                source_excerpt=sentence,
            )
        )

    return result


# ---------------------------------------------------------------------------
# Socratic grading
# ---------------------------------------------------------------------------


def _coverage(point: str, user_terms: set[str]) -> float:
    target = set(_content_words(point))
    if not target:
        return 0.0
    return len(target & user_terms) / len(target)


def offline_grade(
    *,
    user_response: str,
    rubric: list[str] | None,
    model_answer: str | None,
    source_excerpt: str | None = None,
) -> SocraticEvaluation:
    """Keyword-coverage grader that mimics the LLM's output contract."""
    response = (user_response or "").strip()
    points = [p for p in (rubric or []) if p.strip()]
    if not points and model_answer:
        points = [f"Captures: {phrase.strip()}" for phrase in re.split(r"[.;\n]", model_answer) if len(phrase.strip()) > 25]

    if not response:
        return SocraticEvaluation(
            grade=0,
            matched_points=[],
            missing_nuances=points or ["No answer was submitted."],
            socratic_feedback=(
                "You didn't attempt an answer. Before revealing the card, try to write down "
                "everything you can recall — even a partial attempt gives the scheduler useful signal."
            ),
        )

    user_terms = set(_content_words(response))
    matched: list[str] = []
    missing: list[str] = []
    for point in points:
        (matched if _coverage(point, user_terms) >= 0.5 else missing).append(point)

    total = len(points) or 1
    ratio = len(matched) / total

    if ratio >= 0.95:
        grade = 5
    elif ratio >= 0.75:
        grade = 4
    elif ratio >= 0.5:
        grade = 3
    elif ratio >= 0.3:
        grade = 2
    elif ratio > 0:
        grade = 1
    else:
        grade = 0

    if not matched and len(response.split()) > 4:
        grade = max(grade, 1)

    if missing:
        focus = missing[0]
        focus_terms = _top_terms(focus, 2)
        focus_hint = focus_terms[0] if focus_terms else "the core mechanism"
        feedback = (
            f"You covered {len(matched)} of {total} key points, but the response never addresses "
            f"“{focus_hint}”. Ask yourself: what role does it play, and what would break if it were "
            "absent? Tighten your answer around that before moving on."
        )
    else:
        feedback = (
            f"Solid recall — all {total} key points were present, so the scheduler will push this "
            "card further out. Try compressing your answer into a single causal sentence to lock it in."
        )

    return SocraticEvaluation(
        grade=grade,
        matched_points=matched,
        missing_nuances=missing,
        socratic_feedback=feedback,
    )
