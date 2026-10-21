"""Extract plain text from uploaded study material (PDF / Markdown / plain text)."""

from __future__ import annotations

import io
import re

from ..config import settings

SUPPORTED_EXTENSIONS = {".pdf", ".md", ".markdown", ".txt", ".text", ".rst"}

_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}

_PAGE_NUMBER_RE = re.compile(r"^\s*(?:page\s+)?\d+\s*(?:/\s*\d+)?\s*$", re.IGNORECASE)


class ExtractionError(ValueError):
    """Raised when a file cannot be turned into usable text."""


def extension_of(filename: str) -> str:
    name = (filename or "").lower().strip()
    idx = name.rfind(".")
    return name[idx:] if idx != -1 else ""


def normalize_pdf_text(text: str) -> str:
    """Join hyphen-broken words, drop standalone page numbers, fix line breaks."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)  # de-hyphenate across line breaks
    lines = [ln.rstrip() for ln in text.split("\n")]
    lines = [ln for ln in lines if not _PAGE_NUMBER_RE.match(ln)]
    text = "\n".join(lines)
    # A single newline inside a paragraph is usually a PDF line wrap.
    text = re.sub(r"(?<![.!?:;\n])\n(?!\s*[-*+\d#|]\s)(?=\S)", " ", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _read_pdf_text(data: bytes) -> str:
    """Selectable-text extraction with pypdf. May return a very short string."""
    try:
        from pypdf import PdfReader  # noqa: PLC0415
    except ImportError as exc:  # pragma: no cover
        raise ExtractionError("pypdf is not installed; run `pip install pypdf`.") from exc

    try:
        reader = PdfReader(io.BytesIO(data))
    except Exception as exc:  # pragma: no cover - malformed upload
        raise ExtractionError(f"Could not read PDF: {exc}") from exc

    if getattr(reader, "is_encrypted", False):
        try:
            reader.decrypt("")
        except Exception as exc:  # pragma: no cover
            raise ExtractionError("PDF is password protected.") from exc

    pages: list[str] = []
    for page in reader.pages:
        try:
            pages.append(page.extract_text() or "")
        except Exception:  # pragma: no cover - individual bad page
            continue

    return normalize_pdf_text("\n\n".join(pages))


def ocr_pdf(data: bytes) -> str:
    """Rasterise a scanned PDF and read it back with Tesseract.

    Used as a fallback when the PDF has (almost) no selectable text. Both
    ``pdf2image`` and ``pytesseract`` also need native binaries — Poppler and
    the Tesseract engine — so absence of either is reported with install
    guidance instead of a stack trace.
    """
    try:
        from pdf2image import convert_from_bytes  # noqa: PLC0415
        from pdf2image.exceptions import PDFInfoNotInstalledError  # noqa: PLC0415
    except ImportError as exc:
        raise ExtractionError(
            "This PDF is a scan with no selectable text, and OCR support is not "
            "installed. Run `pip install pdf2image pytesseract` and install the "
            "Poppler (poppler-utils) binaries, then re-upload."
        ) from exc

    try:
        import pytesseract  # noqa: PLC0415
    except ImportError as exc:  # pragma: no cover
        raise ExtractionError(
            "This PDF is a scan with no selectable text, and pytesseract is not "
            "installed. Run `pip install pytesseract` and install the Tesseract "
            "engine, then re-upload."
        ) from exc

    try:
        images = convert_from_bytes(data, dpi=settings.ocr_dpi)
    except PDFInfoNotInstalledError as exc:
        raise ExtractionError(
            "OCR needs the Poppler binaries (pdftoppm/pdfinfo). Install "
            "'poppler-utils' (Linux), 'poppler' (macOS) or the Poppler Windows "
            "build, then re-upload."
        ) from exc
    except Exception as exc:  # pragma: no cover - malformed scan
        raise ExtractionError(f"Could not rasterise the PDF for OCR: {exc}") from exc

    engine_missing = getattr(pytesseract, "TesseractNotFoundError", RuntimeError)

    pages: list[str] = []
    for image in images:
        try:
            pages.append(pytesseract.image_to_string(image, lang=settings.ocr_language))
        except engine_missing as exc:
            raise ExtractionError(
                "OCR needs the Tesseract engine but it was not found on PATH. "
                "Install 'tesseract-ocr' and try again."
            ) from exc
        except Exception:  # pragma: no cover - individual bad page
            continue

    return normalize_pdf_text("\n\n".join(pages))


def extract_pdf(data: bytes) -> str:
    """Extract PDF text, falling back to OCR when the PDF is a scan."""
    text = _read_pdf_text(data)
    if len(text) >= settings.ocr_min_chars:
        return text

    if settings.ocr_enabled:
        # Raises ExtractionError with install guidance when OCR is unavailable.
        ocr_text = ocr_pdf(data)
        if len(ocr_text) >= settings.ocr_min_chars:
            return ocr_text

    raise ExtractionError(
        "No selectable text found in this PDF (it is probably a scanned image) "
        "and OCR could not recover any either. Try a higher-resolution scan or "
        "paste the notes as text instead."
    )


def extract_markdown(data: bytes) -> str:
    return _decode(data)


def _decode(data: bytes) -> str:
    for encoding in ("utf-8", "utf-16", "cp1252", "latin-1"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")  # pragma: no cover


def extract_text(filename: str, data: bytes) -> tuple[str, str]:
    """Return ``(text, source_type)`` for an uploaded file.

    ``source_type`` is one of ``pdf`` / ``markdown`` / ``text`` and matches the
    ``source_type`` column on ``materials``.
    """
    if not data:
        raise ExtractionError("Uploaded file is empty.")

    if len(data) > settings.max_upload_bytes:
        raise ExtractionError(
            f"File is too large ({len(data) // 1024} KB). "
            f"Limit is {settings.max_upload_bytes // (1024 * 1024)} MB."
        )

    ext = extension_of(filename)
    if ext in _IMAGE_EXTENSIONS:
        raise ExtractionError(
            f"'{ext}' images are not supported. Upload a PDF or paste the text."
        )

    if ext == ".pdf":
        head = data[:5]
        if head[:4] != b"%PDF":
            raise ExtractionError("File does not look like a valid PDF (missing %PDF header).")
        return extract_pdf(data), "pdf"

    if ext in {".md", ".markdown"}:
        return extract_markdown(data), "markdown"

    if ext in {".txt", ".text", ".rst", ""}:
        return _decode(data), "text"

    raise ExtractionError(
        f"Unsupported file type '{ext}'. Supported: {', '.join(sorted(SUPPORTED_EXTENSIONS))}"
    )
