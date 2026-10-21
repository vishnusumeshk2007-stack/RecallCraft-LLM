"""Health, LLM diagnostics and maintenance endpoints."""

from __future__ import annotations

import time

from fastapi import APIRouter, Depends, Query
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from .. import __version__
from ..config import settings
from ..database import get_db
from ..llm import LLMError, get_client, provider_status
from ..models import Card, Material, ReviewLog, ReviewState
from ..schemas import DeckResetResponse, HealthOut, LLMTestRequest, LLMTestResponse
from ..services.embeddings import get_embedder

router = APIRouter(tags=["system"])


@router.get("/health", response_model=HealthOut)
def health():
    info = provider_status()
    return HealthOut(
        status="ok",
        app=settings.app_name,
        version=__version__,
        database=settings.database_url.split(":", 1)[0],
        llm_provider=info.provider,
        llm_model=info.model,
        llm_configured=info.configured,
        offline_stub=info.offline,
        embedding_backend=get_embedder().name,
    )


@router.get("/system/llm", response_model=HealthOut)
def llm_status():
    """Alias of ``/health`` focused on the LLM configuration."""
    return health()


@router.post("/system/llm/test", response_model=LLMTestResponse)
async def llm_test(payload: LLMTestRequest):
    """Round-trip a tiny prompt so you can verify credentials from the UI."""
    client = get_client()
    started = time.perf_counter()
    if client.is_offline:
        return LLMTestResponse(
            ok=False,
            provider=client.provider,
            model=client.model,
            offline_stub=True,
            latency_ms=0,
            error=(
                "No API key configured — running the offline deterministic engine. "
                "Set LLM_PROVIDER and the matching key in backend/.env."
            ),
        )
    try:
        response = await client.complete(
            "You are a concise assistant.", payload.prompt, max_tokens=200
        )
    except LLMError as exc:
        return LLMTestResponse(
            ok=False,
            provider=client.provider,
            model=client.model,
            offline_stub=False,
            latency_ms=int((time.perf_counter() - started) * 1000),
            error=str(exc),
        )
    return LLMTestResponse(
        ok=True,
        provider=response.provider,
        model=response.model,
        offline_stub=False,
        latency_ms=response.latency_ms,
        output=response.text.strip(),
    )


@router.post("/system/reset", response_model=DeckResetResponse)
def reset_deck(
    confirm: bool = Query(False, description="Must be true — wipes the entire deck."),
    db: Session = Depends(get_db),
):
    """Delete every material, card and review record."""
    if not confirm:
        return DeckResetResponse(deleted_cards=0, deleted_materials=0)

    deleted_cards = db.execute(select(func.count(Card.id))).scalar_one()
    deleted_materials = db.execute(select(func.count(Material.id))).scalar_one()

    db.execute(delete(ReviewLog))
    db.execute(delete(ReviewState))
    db.execute(delete(Card))
    db.execute(delete(Material))
    db.commit()

    return DeckResetResponse(deleted_cards=deleted_cards, deleted_materials=deleted_materials)
