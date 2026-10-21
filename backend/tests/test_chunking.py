"""Unit tests for the chunking + embedding layers."""

from __future__ import annotations

import pytest

from app.services.chunking import chunk_text, clean_text, split_sentences
from app.services.embeddings import (
    LocalHashingEmbedder,
    build_embedder,
    content_words,
    cosine_similarity,
)

PARAGRAPH = (
    "Spaced repetition is a learning technique that schedules reviews at increasing "
    "intervals. The spacing effect describes how retention improves when study "
    "sessions are spread out over time. Massed practice feels productive but decays "
    "quickly in memory."
)


def test_split_sentences_basic():
    assert split_sentences(PARAGRAPH) == [
        "Spaced repetition is a learning technique that schedules reviews at increasing intervals.",
        "The spacing effect describes how retention improves when study sessions are spread out over time.",
        "Massed practice feels productive but decays quickly in memory.",
    ]


def test_split_sentences_keeps_abbreviations_together():
    sentences = split_sentences("See Fig. 3 for the curve. It rises sharply at first.")
    assert sentences == ["See Fig. 3 for the curve.", "It rises sharply at first."]


def test_clean_text_strips_fences_and_bullets():
    cleaned = clean_text("```python\nx = 1\n```\n\n- first item\n- second item")
    assert "```" not in cleaned
    assert cleaned.startswith("x = 1")
    assert "- first item" not in cleaned


def test_chunk_text_respects_max_chars():
    long_text = "\n\n".join([PARAGRAPH] * 12)
    chunks = chunk_text(long_text, max_chars=400, overlap=1)
    assert len(chunks) > 1
    assert all(len(c) <= 400 * 1.35 for c in chunks)


def test_chunk_text_splits_on_sentence_boundaries():
    chunks = chunk_text(PARAGRAPH, max_chars=120, overlap=0)
    assert chunks
    for chunk in chunks:
        assert chunk.rstrip().endswith((".", "!", "?"))


def test_chunk_text_carries_overlap_between_chunks():
    text = " ".join(f"Sentence number {i} carries a reasonable amount of filler text." for i in range(12))
    chunks = chunk_text(text, max_chars=200, overlap=1)
    assert len(chunks) >= 2
    # the last sentence of chunk 0 should reappear at the start of chunk 1
    tail = split_sentences(chunks[0])[-1].rstrip(".")
    assert tail in chunks[1]


def test_chunk_text_prefixes_markdown_heading():
    text = "# Memory Models\n\n" + PARAGRAPH + "\n\n## Forgetting\n\nThe forgetting curve decays exponentially over days."
    chunks = chunk_text(text, max_chars=2000, overlap=0)
    assert any(c.startswith("Memory Models:") for c in chunks)
    assert any(c.startswith("Forgetting:") for c in chunks)


def test_hard_split_for_oversized_sentence():
    text = "word " * 500
    chunks = chunk_text(text, max_chars=300, overlap=0)
    assert len(chunks) > 1
    assert all(len(c) <= 300 for c in chunks)


def test_empty_input_yields_no_chunks():
    assert chunk_text("", max_chars=100) == []
    assert chunk_text("    \n\n  ", max_chars=100) == []


# ---------------------------------------------------------------------------
# embeddings
# ---------------------------------------------------------------------------


def test_local_embedder_is_deterministic_and_normalised():
    embedder = LocalHashingEmbedder(128)
    first = embedder._vector("spaced repetition improves retention")
    second = LocalHashingEmbedder(128)._vector("spaced repetition improves retention")
    assert first == second
    assert len(first) == 128
    assert sum(v * v for v in first) == pytest.approx(1.0, abs=1e-6)


def test_cosine_similarity_ranks_related_text_higher():
    embedder = LocalHashingEmbedder(512)
    base = embedder._vector("The ease factor controls how quickly intervals grow.")
    similar = embedder._vector("The ease factor determines interval growth speed.")
    unrelated = embedder._vector("Photosynthesis converts sunlight into glucose.")
    assert cosine_similarity(base, similar) > cosine_similarity(base, unrelated)


def test_identical_text_scores_one():
    embedder = LocalHashingEmbedder(64)
    vector = embedder._vector("identical text")
    assert cosine_similarity(vector, vector) == pytest.approx(1.0)


def test_content_words_drops_stopwords():
    words = content_words("The algorithm is a technique for the cards")
    assert "the" not in words
    assert "algorithm" in words


def test_build_embedder_defaults_to_local(monkeypatch):
    from app.services import embeddings

    monkeypatch.setattr(embeddings.settings, "embedding_backend", "local")
    assert "local" in build_embedder().name


def test_build_embedder_falls_back_without_openai_key(monkeypatch):
    from app.services import embeddings

    monkeypatch.setattr(embeddings.settings, "embedding_backend", "openai")
    monkeypatch.setattr(embeddings.settings, "openai_api_key", None)
    assert "local" in build_embedder().name
    embeddings.reset_embedder()
