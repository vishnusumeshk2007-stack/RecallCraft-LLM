"""Dashboard statistics endpoint."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas import StatsOut
from ..services.stats import build_stats

router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("", response_model=StatsOut)
def get_stats(db: Session = Depends(get_db)):
    """Retention, due counts, 14-day trend and 14-day forecast."""
    return build_stats(db)
