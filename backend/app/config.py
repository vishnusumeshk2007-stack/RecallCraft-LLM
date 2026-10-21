"""Application settings, resolved from environment / .env file."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "RecallCraft"
    api_prefix: str = "/api"

    # ---------- database ----------
    database_url: str = "sqlite:///./recallcraft.db"

    # ---------- LLM ----------
    llm_provider: str = "groq"  # groq | openai | gemini | openrouter | stub
    llm_model: str | None = None
    llm_temperature: float = 0.2
    llm_max_retries: int = 2
    request_timeout: float = 120.0

    groq_api_key: str | None = None
    # Groq retires model ids regularly; a stale id fails with HTTP 404
    # `model_not_found`. Set GROQ_MODEL to point at a live model.
    groq_model: str | None = None
    openai_api_key: str | None = None
    google_api_key: str | None = None
    open_router_api_key: str | None = None

    # ---------- embeddings ----------
    embedding_backend: str = "local"  # local | openai | sentence-transformers
    embedding_model: str = "text-embedding-3-small"
    embedding_dim: int = 384

    # ---------- OCR (scanned PDFs) ----------
    # When a PDF yields fewer than `ocr_min_chars` characters of selectable
    # text it is treated as a scan and re-read with pdf2image + Tesseract.
    ocr_enabled: bool = True
    ocr_min_chars: int = 50
    ocr_language: str = "eng"
    ocr_dpi: int = 200

    # ---------- pipeline ----------
    dedupe_threshold: float = 0.92
    max_chunk_chars: int = 1200
    chunk_overlap_sentences: int = 1
    cards_per_chunk: int = 3
    max_upload_bytes: int = 15 * 1024 * 1024

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")

    def api_key_for(self, provider: str) -> str | None:
        return {
            "groq": self.groq_api_key,
            "openai": self.openai_api_key,
            "gemini": self.google_api_key,
            "openrouter": self.open_router_api_key,
        }.get(provider)


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
