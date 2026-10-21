"""OCR fallback routing for scanned PDFs.

These tests never touch Poppler or the Tesseract engine — the OCR call itself is
monkeypatched — so they stay deterministic on every machine.
"""

from __future__ import annotations

import io

import pytest

from app.config import settings
from app.services import extraction

ENOUGH = "Spaced repetition schedules reviews at growing intervals. " * 3
SHORT = "Too short."


def _blank_pdf() -> bytes:
    """A valid PDF whose pages carry no selectable text (i.e. a 'scan')."""
    pypdf = pytest.importorskip("pypdf")
    writer = pypdf.PdfWriter()
    writer.add_blank_page(width=200, height=200)
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def test_selectable_text_skips_ocr(monkeypatch):
    def _boom(_data: bytes) -> str:  # pragma: no cover - must not be called
        raise AssertionError("OCR should not run when the PDF has real text")

    monkeypatch.setattr(extraction, "_read_pdf_text", lambda _data: ENOUGH)
    monkeypatch.setattr(extraction, "ocr_pdf", _boom)

    assert extraction.extract_pdf(b"anything") == ENOUGH


def test_scanned_pdf_falls_back_to_ocr(monkeypatch):
    monkeypatch.setattr(extraction, "ocr_pdf", lambda _data: ENOUGH)
    assert extraction.extract_pdf(_blank_pdf()) == ENOUGH


def test_ocr_is_skipped_when_disabled(monkeypatch):
    monkeypatch.setattr(settings, "ocr_enabled", False)
    monkeypatch.setattr(extraction, "_read_pdf_text", lambda _data: SHORT)

    with pytest.raises(extraction.ExtractionError):
        extraction.extract_pdf(b"anything")


def test_unusable_ocr_output_raises_extraction_error(monkeypatch):
    monkeypatch.setattr(extraction, "ocr_pdf", lambda _data: SHORT)

    with pytest.raises(extraction.ExtractionError, match="scanned image"):
        extraction.extract_pdf(_blank_pdf())
