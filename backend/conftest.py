"""Pytest bootstrap: isolate the test database and force the offline engines.

Environment variables MUST be set before ``app.*`` is imported because
``app.config.settings`` is resolved at import time.
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

_TEST_DB = Path(tempfile.gettempdir()) / "recallcraft_test.db"
if _TEST_DB.exists():
    _TEST_DB.unlink()

os.environ["DATABASE_URL"] = f"sqlite:///{_TEST_DB.as_posix()}"
os.environ["LLM_PROVIDER"] = "stub"
os.environ["EMBEDDING_BACKEND"] = "local"
os.environ["EMBEDDING_DIM"] = "256"
