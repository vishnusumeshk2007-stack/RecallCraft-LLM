"""Semantic-ish chunking of study material.

Strategy (deliberately simple + dependency free):

1. Normalise line endings and strip obvious noise.
2. Split into *blocks* on blank lines — markdown paragraphs, list runs, headings.
3. Split each block into sentences with an abbreviation-aware splitter.
4. Greedily pack sentences into chunks of <= ``max_chars`` characters, carrying
   ``overlap`` sentences into the next chunk so a fact spanning a boundary is
   never lost.
5. Markdown headings are remembered and prepended as context so an isolated
   paragraph still carries its section title.

Each chunk therefore lands on a sentence boundary rather than mid-word, which
is what keeps generated cards coherent.
"""

from __future__ import annotations

import re

from ..config import settings

_BLANK_LINE_RE = re.compile(r"\n\s*\n+")
_HEADING_RE = re.compile(r"^\s{0,3}(#{1,6})\s+(.*)$")
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])[\"')\]]*\s+")
_ABBREVIATIONS = frozenset(
    "e.g i.e etc vs fig eq no al cf approx dr mr mrs ms prof inc ltd vol "
    "ch sec p pp refs et al".split()
)
_BULLET_RE = re.compile(r"^\s*(?:[-*+•]|\d+[.)])\s+", re.MULTILINE)
_CODE_FENCE_RE = re.compile(r"^\s*```.*$", re.MULTILINE)


def split_sentences(text: str) -> list[str]:
    """Sentence splitter that tolerates common abbreviations and decimals."""
    text = " ".join(text.split())
    if not text:
        return []

    parts = _SENTENCE_SPLIT_RE.split(text)
    sentences: list[str] = []
    for part in parts:
        part = part.strip()
        if not sentences:
            sentences.append(part)
            continue

        prev = sentences[-1]
        tail = prev.rsplit(" ", 1)[-1].rstrip(".").lower()
        # Don't break after an abbreviation or a bare number ("Fig. 3", "3.14").
        if tail in _ABBREVIATIONS or prev.endswith(tuple(f"{i}." for i in range(10))):
            sentences[-1] = f"{prev} {part}"
        else:
            sentences.append(part)
    return [s for s in sentences if s]


def _hard_split(text: str, max_chars: int) -> list[str]:
    """Last-resort word-boundary split for a single oversized sentence."""
    words = text.split()
    out: list[str] = []
    buf: list[str] = []
    size = 0
    for word in words:
        if buf and size + len(word) + 1 > max_chars:
            out.append(" ".join(buf))
            buf, size = [], 0
        buf.append(word)
        size += len(word) + 1
    if buf:
        out.append(" ".join(buf))
    return out


def clean_text(text: str) -> str:
    """Drop code-fence markers and bullet glyphs, collapse blank runs."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _CODE_FENCE_RE.sub("", text)
    text = _BULLET_RE.sub("", text)
    return _BLANK_LINE_RE.sub("\n\n", text).strip()


def chunk_text(
    text: str,
    *,
    max_chars: int = 1200,
    overlap: int = 1,
    min_chars: int = 120,
) -> list[str]:
    """Split material into overlapping, sentence-aligned chunks."""
    text = clean_text(text)
    if not text:
        return []

    chunks: list[str] = []
    chunk_prefixes: list[str] = []
    heading = ""

    for block in _BLANK_LINE_RE.split(text):
        block = block.strip()
        if not block:
            continue

        heading_match = _HEADING_RE.match(block)
        if heading_match:
            heading = heading_match.group(2).strip()
            block = _HEADING_RE.sub("", block).strip()
            if not block:
                continue

        prefix = f"{heading}: " if heading else ""
        sentences = split_sentences(block)

        buf: list[str] = []
        size = len(prefix)

        def flush() -> None:
            nonlocal buf, size
            if not buf:
                return
            body = " ".join(buf).strip()
            if body:
                chunks.append((prefix + body).strip())
                chunk_prefixes.append(prefix)
            buf = []
            size = len(prefix)

        for sentence in sentences:
            pieces = (
                _hard_split(sentence, max_chars)
                if len(sentence) + len(prefix) > max_chars
                else [sentence]
            )
            for piece in pieces:
                if buf and size + len(piece) + 1 > max_chars:
                    flush()
                    # carry the tail of the emitted chunk over for continuity
                    if overlap > 0 and chunks:
                        tail = split_sentences(chunks[-1])[-overlap:]
                        if tail and sum(len(t) for t in tail) + len(prefix) < max_chars // 2:
                            buf = list(tail)
                            size = len(prefix) + sum(len(t) + 1 for t in tail)
                buf.append(piece)
                size += len(piece) + 1

        flush()

    # Merge a tiny trailing chunk, but only when doing so stays within budget
    # and does not glue two different sections (and their headings) together.
    if (
        len(chunks) >= 2
        and len(chunks[-1]) < min_chars
        and chunk_prefixes[-1] == chunk_prefixes[-2]
        and len(chunks[-2]) + len(chunks[-1]) + 1 <= max_chars
    ):
        chunks = chunks[:-2] + [f"{chunks[-2]} {chunks[-1]}"]

    return [c for c in chunks if c.strip()]


def chunk_material(text: str) -> list[str]:
    """Convenience wrapper using the configured tuning knobs."""
    return chunk_text(
        text,
        max_chars=settings.max_chunk_chars,
        overlap=settings.chunk_overlap_sentences,
    )


def summarise_chunks(chunks: list[str]) -> dict[str, int]:
    return {
        "chunk_count": len(chunks),
        "total_chars": sum(len(c) for c in chunks),
        "avg_chars": int(sum(len(c) for c in chunks) / len(chunks)) if chunks else 0,
    }
