"""Anki ``.apkg`` deck export.

Converts the stored cards of one material into a self-contained Anki package
using ``genanki``. Every card type is rendered into the same three-field note
model — ``Front`` / ``Back`` / ``Source`` — so a single deck holds concept
cards, diagnostic MCQs and open-ended prompts side by side:

* **flashcard**   -> front = prompt, back = answer (+ key formula)
* **mcq**         -> front = question + options, back = key + explanation +
                     why each distractor is wrong
* **open_ended**  -> front = prompt, back = model answer + rubric

``genanki`` is imported lazily so the rest of the app keeps working when the
optional dependency is not installed.
"""

from __future__ import annotations

import hashlib
import html
import io
import re

from ..models import Card, Material

# One shared note model keeps every exported deck consistent in Anki.
_MODEL_ID = 1_748_002_311_004
_FIELD_NAMES = ["Front", "Back", "Source"]

_CARD_TEMPLATES = [
    {
        "name": "Recall",
        "qfmt": "{{Front}}",
        "afmt": "{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}\n\n"
        "{{#Source}}<div class=rc-source>{{Source}}</div>{{/Source}}",
    }
]

_CSS = """
.card {
  font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 18px;
  line-height: 1.6;
  text-align: left;
  color: #e9edfb;
  background: #0c1120;
  padding: 14px;
}
hr#answer { border: none; border-top: 1px solid #1e2843; margin: 14px 0; }
ol { margin: 10px 0 0; padding-left: 22px; }
li { margin-bottom: 4px; }
.rc-badge { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px;
  border: 1px solid #7c6cff; color: #a89bff; background: rgba(124,108,255,0.12); }
.rc-source { margin-top: 16px; padding-left: 10px; border-left: 2px solid #7c6cff;
  font-size: 13px; font-style: italic; color: #8f9cbe; }
.rc-label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: #8f9cbe; }
"""

_TAG_SAFE_RE = re.compile(r"[^\w\-]")
_DISTRACTOR_LABEL = "Why the others are wrong"


class AnkiExportError(RuntimeError):
    """Raised when a deck cannot be packaged (e.g. genanki is missing)."""


def _stable_id(seed: str) -> int:
    """Deterministic 63-bit positive integer derived from a string."""
    digest = hashlib.sha256(seed.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big") >> 1


def _text(value: str | None) -> str:
    """HTML-escape a field and preserve intentional line breaks."""
    return html.escape((value or "").strip()).replace("\n", "<br>")


def _tag(value: str) -> str:
    slug = _TAG_SAFE_RE.sub("_", (value or "").strip().lower()).strip("_")
    return slug[:60]


def _flashcard_bodies(card: Card) -> tuple[str, str]:
    return _text(card.front_prompt), _text(card.back_answer)


def _mcq_bodies(card: Card) -> tuple[str, str]:
    options = card.options or []
    front = _text(card.front_prompt)
    if options:
        items = "".join(f"<li>{_text(option)}</li>" for option in options)
        front = f"{front}<ol>{items}</ol>"

    correct = card.correct_option_index
    parts: list[str] = []
    if correct is not None and 0 <= correct < len(options):
        letter = chr(65 + correct)
        parts.append(f"<b>Correct answer: {letter}. {_text(options[correct])}</b>")
    if card.explanation:
        parts.append(_text(card.explanation))

    distractors = card.distractor_explanations or {}
    if distractors:
        rows = []
        for key, why in sorted(distractors.items(), key=lambda kv: str(kv[0])):
            try:
                letter = chr(65 + int(key))
            except (TypeError, ValueError):  # pragma: no cover - defensive
                letter = str(key)
            rows.append(f"<li><b>{html.escape(letter)}</b> — {_text(why)}</li>")
        parts.append(
            f'<div class=rc-label>{_DISTRACTOR_LABEL}</div><ul>{"".join(rows)}</ul>'
        )
    return front, "<br><br>".join(parts) or "—"


def _open_ended_bodies(card: Card) -> tuple[str, str]:
    parts: list[str] = []
    if card.model_answer:
        parts.append(_text(card.model_answer))
    rubric = card.rubric or []
    if rubric:
        rows = "".join(f"<li>{_text(point)}</li>" for point in rubric)
        parts.append(f'<div class=rc-label>Rubric — key points</div><ul>{rows}</ul>')
    return _text(card.front_prompt), "<br><br>".join(parts) or "—"


_BODY_BUILDERS = {
    "flashcard": _flashcard_bodies,
    "mcq": _mcq_bodies,
    "open_ended": _open_ended_bodies,
}


def _source_field(card: Card, material: Material) -> str:
    origin = material.source_filename or material.title or "Source notes"
    label = f"<b>{_text(origin)}</b>"
    excerpt = card.source_excerpt or ""
    if excerpt:
        return f"{label}<br>{_text(excerpt)}"
    return label


def build_anki_package(material: Material, cards: list[Card]) -> bytes:
    """Render ``cards`` into a downloadable ``.apkg`` byte string."""
    try:
        import genanki  # noqa: PLC0415
    except ImportError as exc:  # pragma: no cover - optional dependency
        raise AnkiExportError(
            "Anki export needs the 'genanki' package. Run `pip install genanki`."
        ) from exc

    model = genanki.Model(
        _MODEL_ID,
        "RecallCraft",
        fields=[{"name": name} for name in _FIELD_NAMES],
        templates=_CARD_TEMPLATES,
        css=_CSS,
    )
    deck = genanki.Deck(
        _stable_id(f"recallcraft::{material.id}"),
        f"RecallCraft::{material.title}"[:120],
        description="Exported from RecallCraft.",
    )

    base_tags = [_tag(material.title)] if material.title else []
    for card in cards:
        builder = _BODY_BUILDERS.get(card.card_type)
        if builder is None:  # pragma: no cover - card_type is constrained
            continue
        front, back = builder(card)
        tags = [*base_tags, card.card_type]
        tags += [_tag(tag) for tag in (card.tags or [])]
        deck.add_note(
            genanki.Note(
                model=model,
                fields=[front, back, _source_field(card, material)],
                tags=[tag for tag in tags if tag],
                guid=card.id,
            )
        )

    buffer = io.BytesIO()
    genanki.Package(deck).write_to_file(buffer)
    return buffer.getvalue()
