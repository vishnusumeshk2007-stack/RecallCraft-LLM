"""Pluggable text-embedding backends.

Three backends are supported and selected via ``EMBEDDING_BACKEND``:

``local``                  zero-dependency deterministic hashing embedder (default)
``openai``                 OpenAI ``text-embedding-3-small`` (or any OpenAI-compatible model)
``sentence-transformers``  local transformer model (lazy-imported, heavy)

Every backend exposes the same async interface so callers never branch:

    embedder = get_embedder()
    vectors = await embedder.embed(["some text", "more text"])
"""

from __future__ import annotations

import asyncio
import hashlib
import math
import re
from typing import Protocol, runtime_checkable

import httpx

from ..config import settings

_TOKEN_RE = re.compile(r"[a-z0-9]+")
_WHITESPACE_RE = re.compile(r"\s+")

STOPWORDS = frozenset(
    """a an and are as at be by for from has have if in into is it its of on or that the
    their there these this to was were will with we you your they he she not but can could
    should would may might must do does did done than then them us our""".split()
)


def tokenize(text: str) -> list[str]:
    return _TOKEN_RE.findall(text.lower())


def content_words(text: str) -> list[str]:
    return [t for t in tokenize(text) if t not in STOPWORDS and len(t) > 2]


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """Cosine similarity of two equal-length vectors."""
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = na = nb = 0.0
    for x, y in zip(a, b):
        dot += x * y
        na += x * x
        nb += y * y
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (math.sqrt(na) * math.sqrt(nb))


def _stable_hash(token: str) -> int:
    """Deterministic across processes (unlike Python's salted ``hash``)."""
    return int.from_bytes(hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest(), "big")


@runtime_checkable
class Embedder(Protocol):
    name: str
    dim: int

    async def embed(self, texts: list[str]) -> list[list[float]]: ...


class LocalHashingEmbedder:
    """Deterministic hashed bag-of-features embedder.

    Combines word unigrams/bigrams and character 4-grams, hashed into a fixed
    number of buckets with a signed projection, then L2-normalised. It needs no
    model download, runs in microseconds and is stable across restarts, which
    makes duplicate detection reproducible in tests. It is *not* semantically
    as strong as a trained model — swap in ``openai`` or
    ``sentence-transformers`` for production-quality similarity.
    """

    def __init__(self, dim: int = 384) -> None:
        self.dim = dim
        self.name = f"local-hashing-{dim}"

    def _vector(self, text: str) -> list[float]:
        vec = [0.0] * self.dim
        text = _WHITESPACE_RE.sub(" ", text.lower().strip())
        tokens = content_words(text)

        def add(feature: str, weight: float) -> None:
            h = _stable_hash(feature)
            idx = h % self.dim
            sign = 1.0 if (h >> 63) & 1 else -1.0
            vec[idx] += sign * weight

        for token in tokens:
            add(f"w:{token}", 1.0)
        for a, b in zip(tokens, tokens[1:]):
            add(f"b:{a}_{b}", 0.6)
        for token in tokens:
            if len(token) >= 5:
                for i in range(len(token) - 3):
                    add(f"c:{token[i:i + 4]}", 0.25)

        norm = math.sqrt(sum(v * v for v in vec))
        if norm == 0.0:
            return vec
        return [v / norm for v in vec]

    async def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._vector(t) for t in texts]


class OpenAIEmbedder:
    """OpenAI-compatible embeddings endpoint."""

    def __init__(
        self,
        api_key: str,
        model: str,
        *,
        base_url: str = "https://api.openai.com/v1",
    ) -> None:
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.name = f"openai:{model}"
        self.dim = 1536

    async def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        async with httpx.AsyncClient(timeout=settings.request_timeout) as client:
            resp = await client.post(
                f"{self.base_url}/embeddings",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={"model": self.model, "input": texts},
            )
            resp.raise_for_status()
            data = resp.json()["data"]
        ordered = sorted(data, key=lambda d: d.get("index", 0))
        return [d["embedding"] for d in ordered]


class SentenceTransformerEmbedder:
    """Local transformer embeddings; the model loads lazily on first use."""

    def __init__(self, model: str = "all-MiniLM-L6-v2") -> None:
        self.model_name = model
        self.name = f"st:{model}"
        self.dim = 384
        self._model = None

    def _load(self):
        if self._model is None:
            from sentence_transformers import SentenceTransformer  # noqa: PLC0415

            self._model = SentenceTransformer(self.model_name)
            self.dim = int(self._model.get_sentence_embedding_dimension())
        return self._model

    async def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []

        def _run() -> list[list[float]]:
            model = self._load()
            return [list(map(float, v)) for v in model.encode(texts, normalize_embeddings=True)]

        return await asyncio.to_thread(_run)


def build_embedder() -> Embedder:
    backend = (settings.embedding_backend or "local").strip().lower()

    if backend == "openai":
        key = settings.openai_api_key
        if not key:
            # Graceful degradation beats a hard failure during ingestion.
            return LocalHashingEmbedder(settings.embedding_dim)
        return OpenAIEmbedder(key, settings.embedding_model)

    if backend in {"sentence-transformers", "sentence_transformers", "st"}:
        try:
            import sentence_transformers  # noqa: F401, PLC0415
        except ImportError:
            return LocalHashingEmbedder(settings.embedding_dim)
        return SentenceTransformerEmbedder("all-MiniLM-L6-v2")

    return LocalHashingEmbedder(settings.embedding_dim)


_embedder: Embedder | None = None


def get_embedder() -> Embedder:
    """Cached module-level embedder instance."""
    global _embedder
    if _embedder is None:
        _embedder = build_embedder()
    return _embedder


def reset_embedder() -> None:
    global _embedder
    _embedder = None
