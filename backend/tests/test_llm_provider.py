"""Provider resolution for the live Groq integration."""

from __future__ import annotations

from app.config import settings
from app.llm import provider_status
from app.llm.client import DEFAULT_MODELS, resolve_model


def test_groq_ships_a_live_default_model():
    # Guards against regressing to a retired id — Groq answers those with
    # HTTP 404 `model_not_found`.
    assert DEFAULT_MODELS["groq"] == "openai/gpt-oss-20b"


def test_groq_is_selected_when_the_key_is_present(monkeypatch):
    monkeypatch.setattr(settings, "llm_provider", "groq")
    monkeypatch.setattr(settings, "groq_api_key", "gsk_test_key")
    monkeypatch.setattr(settings, "llm_model", None)
    monkeypatch.setattr(settings, "groq_model", None)

    info = provider_status()

    assert info.provider == "groq"
    assert info.base_url == "https://api.groq.com/openai/v1"
    assert info.model == "openai/gpt-oss-20b"
    assert info.configured is True
    assert info.offline is False


def test_groq_model_env_var_overrides_the_default(monkeypatch):
    monkeypatch.setattr(settings, "llm_provider", "groq")
    monkeypatch.setattr(settings, "groq_api_key", "gsk_test_key")
    monkeypatch.setattr(settings, "llm_model", None)
    monkeypatch.setattr(settings, "groq_model", "mixtral-8x7b-32768")

    assert resolve_model("groq") == "mixtral-8x7b-32768"
    assert provider_status().model == "mixtral-8x7b-32768"


def test_missing_groq_key_falls_back_to_the_offline_engine(monkeypatch):
    monkeypatch.setattr(settings, "llm_provider", "groq")
    monkeypatch.setattr(settings, "groq_api_key", None)

    info = provider_status()

    assert info.offline is True
    assert info.configured is False


def test_explicit_model_overrides_the_groq_default(monkeypatch):
    monkeypatch.setattr(settings, "llm_provider", "groq")
    monkeypatch.setattr(settings, "groq_api_key", "gsk_test_key")
    monkeypatch.setattr(settings, "llm_model", "llama-3.3-70b-versatile")

    assert provider_status().model == "llama-3.3-70b-versatile"
