"""Multi-provider LLM client with Pydantic-enforced structured output.

Every supported provider speaks the OpenAI *chat completions* wire format, so a
single implementation covers all of them:

===========  ==========================================================
provider     base URL
===========  ==========================================================
openai       https://api.openai.com/v1
groq         https://api.groq.com/openai/v1
gemini       https://generativelanguage.googleapis.com/v1beta/openai
openrouter   https://openrouter.ai/api/v1
===========  ==========================================================

Structured output is guaranteed in three layers:

1. The system prompt carries the target Pydantic model's JSON Schema.
2. ``response_format={"type": "json_object"}`` is requested (with automatic
   downgrade if a provider rejects it) plus a JSON-extraction fallback that
   tolerates ```json fences and prose preambles.
3. The payload is re-validated with Pydantic v2; on failure the model gets a
   repair turn containing the exact validation errors.

If no API key is configured the client reports ``is_offline`` and callers fall
back to the deterministic offline engine — the app never hard-fails on a
missing key.
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from dataclasses import dataclass
from typing import Any, TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from ..config import settings

TModel = TypeVar("TModel", bound=BaseModel)

BASE_URLS: dict[str, str] = {
    "openai": "https://api.openai.com/v1",
    "groq": "https://api.groq.com/openai/v1",
    "gemini": "https://generativelanguage.googleapis.com/v1beta/openai",
    "openrouter": "https://openrouter.ai/api/v1",
}

# Groq retires model ids often — the whole `llama-3.x` line was removed from
# this account, so a stale id only fails later with HTTP 404 `model_not_found`.
# Override with GROQ_MODEL; this default was verified against the account's
# `GET /openai/v1/models` list.
GROQ_DEFAULT_MODEL = "openai/gpt-oss-20b"

DEFAULT_MODELS: dict[str, str] = {
    "openai": "gpt-4o-mini",
    "groq": GROQ_DEFAULT_MODEL,
    "gemini": "gemini-2.0-flash",
    "openrouter": "meta-llama/llama-3.3-70b-instruct",
}

# Providers known to accept response_format=json_object.
_JSON_MODE_PROVIDERS = {"openai", "groq", "openrouter", "gemini"}

_JSON_BLOCK_RE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL | re.IGNORECASE)
_RETRYABLE_STATUS = {408, 409, 425, 429, 500, 502, 503, 504, 522, 524}


class LLMError(RuntimeError):
    """Raised when the provider cannot be reached or keeps returning junk."""


@dataclass(slots=True)
class LLMResponse:
    text: str
    provider: str
    model: str
    latency_ms: int
    offline_stub: bool = False

    @property
    def usage_note(self) -> str:  # pragma: no cover - convenience
        return f"{self.provider}/{self.model} in {self.latency_ms}ms"


@dataclass(slots=True)
class ProviderInfo:
    provider: str
    model: str
    base_url: str
    configured: bool
    offline: bool


def _api_key(provider: str) -> str | None:
    return settings.api_key_for(provider)


def resolve_provider() -> str:
    """The configured provider, downgrading to ``stub`` when unusable."""
    provider = (settings.llm_provider or "groq").strip().lower()
    if provider in {"stub", "offline", "none", "mock"}:
        return "stub"
    if provider not in BASE_URLS:
        return "stub"
    if not _api_key(provider):
        return "stub"
    return provider


def resolve_model(provider: str) -> str:
    """Model id for a provider: ``LLM_MODEL`` > ``GROQ_MODEL`` > built-in default."""
    if settings.llm_model:
        return settings.llm_model
    if provider == "groq" and settings.groq_model:
        return settings.groq_model
    return DEFAULT_MODELS.get(provider, "gpt-4o-mini")


def provider_status() -> ProviderInfo:
    provider = resolve_provider()
    if provider == "stub":
        return ProviderInfo(
            provider="stub",
            model="offline-deterministic",
            base_url="",
            configured=False,
            offline=True,
        )
    return ProviderInfo(
        provider=provider,
        model=resolve_model(provider),
        base_url=BASE_URLS[provider],
        configured=True,
        offline=False,
    )


def extract_json(text: str) -> Any:
    """Pull the first JSON value out of a model response.

    Handles ```json fences, leading prose, and trailing commentary.
    """
    if text is None:
        raise ValueError("empty model response")

    candidates: list[str] = []
    for match in _JSON_BLOCK_RE.finditer(text):
        candidates.append(match.group(1).strip())
    candidates.append(text.strip())

    for candidate in candidates:
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass

    # Fall back to slicing the outermost {...} or [...]
    for opener, closer in (("{", "}"), ("[", "]")):
        start = text.find(opener)
        end = text.rfind(closer)
        if start != -1 and end > start:
            snippet = text[start : end + 1]
            try:
                return json.loads(snippet)
            except json.JSONDecodeError:
                continue

    raise ValueError("no parsable JSON object found in model response")


class LLMClient:
    """Async chat client bound to one provider/model pair."""

    def __init__(self, provider: str | None = None, model: str | None = None) -> None:
        self.provider = (provider or resolve_provider()).lower()
        self.model = model or resolve_model(self.provider)
        self.base_url = BASE_URLS.get(self.provider, "")
        self.api_key = _api_key(self.provider)

    # ------------------------------------------------------------------ props
    @property
    def is_offline(self) -> bool:
        return self.provider == "stub" or not self.api_key

    @property
    def label(self) -> str:
        return "offline-stub" if self.is_offline else f"{self.provider}/{self.model}"

    # --------------------------------------------------------------- transport
    def _headers(self) -> dict[str, str]:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        if self.provider == "openrouter":
            headers |= {
                "HTTP-Referer": "http://localhost",
                "X-Title": settings.app_name,
            }
        return headers

    async def _post(
        self,
        client: httpx.AsyncClient,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        """POST /chat/completions with retry + graceful payload degradation."""
        url = f"{self.base_url}/chat/completions"
        attempt_payload = dict(payload)
        last_error = "unknown error"

        for attempt in range(settings.llm_max_retries + 1):
            try:
                resp = await client.post(url, headers=self._headers(), json=attempt_payload)
            except httpx.HTTPError as exc:
                last_error = f"network error: {exc}"
                if attempt < settings.llm_max_retries:
                    await asyncio.sleep(1.5 * (attempt + 1))
                    continue
                raise LLMError(last_error) from exc

            if resp.status_code == 200:
                return resp.json()

            body = resp.text[:600]
            last_error = f"HTTP {resp.status_code}: {body}"

            if resp.status_code in _RETRYABLE_STATUS and attempt < settings.llm_max_retries:
                await asyncio.sleep(1.5 * (attempt + 1))
                continue

            # Some providers/models reject response_format or temperature.
            degraded = False
            if "response_format" in body and "response_format" in attempt_payload:
                attempt_payload.pop("response_format", None)
                degraded = True
            if "temperature" in body and "temperature" in attempt_payload:
                attempt_payload.pop("temperature", None)
                degraded = True
            if degraded:
                continue

            raise LLMError(last_error)

        raise LLMError(last_error)

    async def complete(
        self,
        system: str,
        user: str,
        *,
        json_mode: bool = False,
        temperature: float | None = None,
        max_tokens: int = 4096,
    ) -> LLMResponse:
        """One-shot completion."""
        if self.is_offline:
            raise LLMError("LLM provider is not configured (offline stub active).")

        payload: dict[str, Any] = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": settings.llm_temperature if temperature is None else temperature,
            "max_tokens": max_tokens,
        }
        if json_mode and self.provider in _JSON_MODE_PROVIDERS:
            payload["response_format"] = {"type": "json_object"}

        started = time.perf_counter()
        async with httpx.AsyncClient(timeout=settings.request_timeout) as client:
            data = await self._post(client, payload)
        latency_ms = int((time.perf_counter() - started) * 1000)

        try:
            text = data["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError) as exc:
            raise LLMError(f"Unexpected provider response shape: {str(data)[:400]}") from exc

        return LLMResponse(
            text=text,
            provider=self.provider,
            model=self.model,
            latency_ms=latency_ms,
        )

    async def complete_structured(
        self,
        system: str,
        user: str,
        schema: type[TModel],
        *,
        max_tokens: int = 4096,
        repair_attempts: int | None = None,
    ) -> tuple[TModel, LLMResponse]:
        """Completion forced through a Pydantic model, with a repair loop."""
        if self.is_offline:
            raise LLMError("LLM provider is not configured (offline stub active).")

        json_schema = json.dumps(schema.model_json_schema(), indent=2)
        system_with_contract = (
            f"{system}\n\n"
            "## Output contract\n"
            "Respond with exactly ONE JSON object and nothing else — no prose, no "
            "markdown fences. The object MUST validate against this JSON Schema:\n\n"
            f"{json_schema}"
        )

        messages: list[dict[str, str]] = [
            {"role": "system", "content": system_with_contract},
            {"role": "user", "content": user},
        ]
        attempts = settings.llm_max_retries if repair_attempts is None else repair_attempts
        last_error: Exception | None = None

        for _ in range(attempts + 1):
            response = await self._chat(messages, max_tokens=max_tokens)
            try:
                payload = extract_json(response.text)
                return schema.model_validate(payload), response
            except ValidationError as exc:
                last_error = exc
                problems = _condense_errors(exc)
            except ValueError as exc:
                last_error = exc
                problems = str(exc)

            messages.append({"role": "assistant", "content": response.text[:6000]})
            messages.append(
                {
                    "role": "user",
                    "content": (
                        "That response did not satisfy the JSON Schema. Problems:\n"
                        f"{problems}\n\n"
                        "Return the complete, corrected JSON object only."
                    ),
                }
            )

        raise LLMError(f"Model failed to produce valid JSON after {attempts + 1} attempts: {last_error}")

    async def _chat(self, messages: list[dict[str, str]], *, max_tokens: int) -> LLMResponse:
        if self.is_offline:
            raise LLMError("LLM provider is not configured (offline stub active).")

        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": settings.llm_temperature,
            "max_tokens": max_tokens,
        }
        if self.provider in _JSON_MODE_PROVIDERS:
            payload["response_format"] = {"type": "json_object"}

        started = time.perf_counter()
        async with httpx.AsyncClient(timeout=settings.request_timeout) as client:
            data = await self._post(client, payload)
        latency_ms = int((time.perf_counter() - started) * 1000)

        try:
            text = data["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError) as exc:
            raise LLMError(f"Unexpected provider response shape: {str(data)[:400]}") from exc

        return LLMResponse(
            text=text, provider=self.provider, model=self.model, latency_ms=latency_ms
        )


def _condense_errors(exc: ValidationError, limit: int = 12) -> str:
    lines = []
    for err in exc.errors()[:limit]:
        loc = ".".join(str(p) for p in err.get("loc", ()))
        lines.append(f"- {loc or '<root>'}: {err.get('msg', 'invalid')}")
    return "\n".join(lines) or str(exc)


_client: LLMClient | None = None


def get_client(provider: str | None = None, model: str | None = None) -> LLMClient:
    """Cached client. Passing an explicit provider bypasses the cache."""
    global _client
    if provider or model:
        return LLMClient(provider, model)
    if _client is None:
        _client = LLMClient()
    return _client


def reset_client() -> None:
    global _client
    _client = None
