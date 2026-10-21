"""RecallCraft FastAPI application."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

from . import __version__
from .config import settings
from .database import init_db
from .llm import provider_status
from .routers import cards, materials, review, stats, system
from .services.embeddings import get_embedder

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
)
logger = logging.getLogger("recallcraft")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    info = provider_status()
    logger.info("Database ready: %s", settings.database_url)
    logger.info("Embeddings: %s", get_embedder().name)
    if info.offline:
        logger.warning(
            "LLM provider '%s' has no API key — running the OFFLINE deterministic engine. "
            "Set LLM_PROVIDER + the matching *_API_KEY in backend/.env to enable AI generation.",
            settings.llm_provider,
        )
    else:
        logger.info("LLM ready: %s/%s", info.provider, info.model)
    yield


app = FastAPI(
    title=settings.app_name,
    version=__version__,
    description=(
        "Turn study notes, slides and PDFs into flashcards and adaptive quizzes, "
        "then schedule them with the SuperMemo SM-2 algorithm."
    ),
    lifespan=lifespan,
)

# The frontend is served from a different origin (Vercel, preview deployments,
# custom domains), so the API stays open. Starlette echoes the concrete origin
# whenever credentials are present, which keeps cookie-based calls valid.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for module in (materials, cards, review, stats, system):
    app.include_router(module.router, prefix=settings.api_prefix)


@app.get("/", include_in_schema=False)
def root():
    return RedirectResponse(url="/docs")


@app.get("/api", include_in_schema=False)
def api_root():
    return {
        "app": settings.app_name,
        "version": __version__,
        "docs": "/docs",
        "endpoints": [
            "POST   /api/materials",
            "POST   /api/materials/upload",
            "GET    /api/materials",
            "GET    /api/materials/{id}",
            "POST   /api/materials/{id}/generate",
            "GET    /api/materials/{id}/export/anki",
            "DELETE /api/materials/{id}",
            "GET    /api/cards",
            "GET    /api/cards/{id}",
            "GET    /api/cards/{id}/lineage",
            "GET    /api/cards/{id}/history",
            "DELETE /api/cards/{id}",
            "GET    /api/review/queue",
            "POST   /api/review/submit",
            "GET    /api/review/logs",
            "GET    /api/stats",
            "GET    /api/health",
            "POST   /api/system/llm/test",
            "POST   /api/system/reset",
        ],
    }
