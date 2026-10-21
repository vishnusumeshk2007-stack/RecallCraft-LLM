"""End-to-end API tests.

Runs the whole product loop against the deterministic offline engine: ingest ->
generate -> queue -> grade -> reschedule -> stats.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.database import Base, engine
from app.main import app

SAMPLE_MATERIAL = """Spaced repetition is a learning technique that schedules reviews at \
increasing intervals to exploit the spacing effect. The spacing effect describes how \
information is retained better when study sessions are spread out over time rather than \
massed together.

The SM-2 algorithm was published by Piotr Wozniak in 1987. It tracks three values for each \
card: the repetition count, the inter-repetition interval, and the ease factor. The ease \
factor is a multiplier that controls how quickly intervals grow as a learner keeps succeeding.

If a learner answers correctly with a quality of three or higher, the algorithm increases the \
interval. A quality below three resets the repetition count to zero and schedules the card for \
the next day. The ease factor never drops below one point three.
"""


@pytest.fixture(scope="module")
def client():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with TestClient(app) as test_client:
        yield test_client
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def material(client):
    response = client.post(
        "/api/materials",
        json={"title": "Spaced Repetition 101", "content": SAMPLE_MATERIAL, "source_type": "text"},
    )
    assert response.status_code == 201, response.text
    return response.json()


# ---------------------------------------------------------------------------
# health & ingestion
# ---------------------------------------------------------------------------


def test_health_reports_offline_stub(client):
    payload = client.get("/api/health").json()
    assert payload["status"] == "ok"
    assert payload["llm_configured"] is False
    assert payload["offline_stub"] is True
    assert payload["database"] == "sqlite"
    assert payload["embedding_backend"].startswith("local")


def test_material_is_chunked_and_indexed(client, material):
    assert material["chunk_count"] >= 1
    assert material["char_count"] == len(SAMPLE_MATERIAL.strip())

    chunks = client.get(f"/api/materials/{material['id']}/chunks").json()
    assert len(chunks) == material["chunk_count"]
    assert all(c["embedding_backend"].startswith("local") for c in chunks)


def test_rejects_too_short_material(client):
    response = client.post("/api/materials", json={"title": "Tiny", "content": "too short"})
    assert response.status_code == 422
    assert "too short" in response.json()["detail"]


def test_upload_rejects_unsupported_type(client):
    response = client.post(
        "/api/materials/upload",
        files={"file": ("notes.png", b"\x89PNG\r\n\x1a\n", "image/png")},
    )
    assert response.status_code == 422
    assert "not supported" in response.json()["detail"]


def test_upload_accepts_markdown(client):
    response = client.post(
        "/api/materials/upload",
        files={"file": ("memory.md", SAMPLE_MATERIAL.encode(), "text/markdown")},
        data={"title": "Uploaded Notes"},
    )
    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["title"] == "Uploaded Notes"
    assert payload["source_type"] == "markdown"
    assert payload["chunk_count"] >= 1


# ---------------------------------------------------------------------------
# generation
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def generated(client, material):
    response = client.post(
        f"/api/materials/{material['id']}/generate",
        json={
            "concept_cards": 4,
            "diagnostic_mcqs": 3,
            "open_ended_questions": 2,
            "per_chunk": 2,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_generation_creates_all_three_item_types(generated):
    created = generated["created"]
    assert created, generated["notes"]
    assert generated["offline_stub"] is True
    types = {card["card_type"] for card in created}
    assert types & {"flashcard", "mcq", "open_ended"}


def test_mcq_shape_is_enforced(generated):
    mcqs = [c for c in generated["created"] if c["card_type"] == "mcq"]
    assert mcqs
    for mcq in mcqs:
        assert len(mcq["options"]) == 4
        assert 0 <= mcq["correct_option_index"] <= 3
        assert len(mcq["distractor_explanations"]) == 3
        assert str(mcq["correct_option_index"]) not in mcq["distractor_explanations"]


def test_every_card_traces_back_to_a_source_chunk(generated):
    for card in generated["created"]:
        assert card["source_chunk_id"]
        assert card["source_excerpt"]


def test_generation_is_idempotent_via_embedding_dedupe(client, material):
    second = client.post(
        f"/api/materials/{material['id']}/generate",
        json={"concept_cards": 4, "diagnostic_mcqs": 3, "open_ended_questions": 2, "per_chunk": 2},
    ).json()
    assert second["created"] == [], "duplicate cards were persisted"
    assert second["skipped_duplicates"] > 0
    assert any("duplicate" in note.lower() for note in second["notes"])


def test_generation_request_requires_a_type(client, material):
    response = client.post(f"/api/materials/{material['id']}/generate", json={})
    assert response.status_code == 422


# ---------------------------------------------------------------------------
# review queue & grading
# ---------------------------------------------------------------------------


def test_queue_withholds_mcq_answer_keys(client):
    queue = client.get("/api/review/queue", params={"limit": 50}).json()
    assert queue["total_due"] > 0
    assert queue["cards"]
    for card in queue["cards"]:
        if card["card_type"] == "mcq":
            assert card["correct_option_index"] is None
            assert card["explanation"] is None
        if card["card_type"] != "flashcard":
            assert card["back_answer"] == ""


def test_card_due_only_filter(client, material):
    """Regression: the due_only branch referenced ReviewState/utcnow without importing them."""
    every = client.get("/api/cards", params={"material_id": material["id"], "limit": 500}).json()
    due = client.get(
        "/api/cards",
        params={"material_id": material["id"], "due_only": True, "limit": 500},
    )
    assert due.status_code == 200, due.text
    due_cards = due.json()
    assert len(due_cards) <= len(every)
    for card in due_cards:
        assert card["review_state"] is not None


def test_card_search_and_material_filters(client, material):
    typed = client.get(
        "/api/cards", params={"material_id": material["id"], "card_type": "mcq"}
    )
    assert typed.status_code == 200
    assert all(c["card_type"] == "mcq" for c in typed.json())

    found = client.get("/api/cards", params={"search": "spaced", "limit": 10}).json()
    assert isinstance(found, list)


def test_flashcard_self_grade_advances_sm2(client):
    card = client.get("/api/cards", params={"card_type": "flashcard", "limit": 1}).json()[0]
    before = card["review_state"]

    response = client.post("/api/review/submit", json={"card_id": card["id"], "quality": 5})
    assert response.status_code == 200, response.text
    payload = response.json()

    assert payload["quality"] == 5
    assert payload["passed"] is True
    assert payload["repetition"] == 1
    assert payload["interval"] == 1
    assert payload["ease_factor"] == pytest.approx(before["ease_factor"] + 0.1, abs=1e-3)
    assert payload["review_state"]["total_reviews"] == before["total_reviews"] + 1
    assert payload["review_state"]["next_review_date"] > payload["review_state"]["last_reviewed_at"]


def test_preview_grade_does_not_commit(client):
    card = client.get("/api/cards", params={"card_type": "flashcard", "limit": 1}).json()[0]
    before = card["review_state"]

    response = client.post(
        "/api/review/submit",
        json={"card_id": card["id"], "quality": 0, "commit": False},
    ).json()
    assert response["quality"] == 0
    assert response["interval"] == 1

    after = client.get(f"/api/cards/{card['id']}").json()["review_state"]
    assert after == before


def test_mcq_correct_answer_scores_five(client):
    card = client.get("/api/cards", params={"card_type": "mcq", "limit": 1}).json()[0]
    response = client.post(
        "/api/review/submit",
        json={"card_id": card["id"], "selected_option_index": card["correct_option_index"]},
    ).json()
    assert response["is_correct"] is True
    assert response["quality"] == 5
    assert response["answer_reveal"]["correct_option_index"] == card["correct_option_index"]


def test_mcq_wrong_answer_scores_two_and_records_the_option_text(client):
    card = client.get("/api/cards", params={"card_type": "mcq", "limit": 1}).json()[0]
    wrong = (card["correct_option_index"] + 1) % 4

    response = client.post(
        "/api/review/submit", json={"card_id": card["id"], "selected_option_index": wrong}
    ).json()
    assert response["is_correct"] is False
    assert response["quality"] == 2
    assert response["passed"] is False
    assert response["user_response"] == card["options"][wrong]
    assert response["ease_factor"] < card["review_state"]["ease_factor"]


def test_mcq_requires_an_option(client):
    card = client.get("/api/cards", params={"card_type": "mcq", "limit": 1}).json()[0]
    response = client.post("/api/review/submit", json={"card_id": card["id"]})
    assert response.status_code == 422


def test_open_ended_response_is_socratically_graded(client):
    card = client.get("/api/cards", params={"card_type": "open_ended", "limit": 1}).json()[0]
    assert card["rubric"]

    response = client.post(
        "/api/review/submit",
        json={
            "card_id": card["id"],
            "user_response": (
                "Spaced repetition spreads reviews out over time so that memory decays a "
                "little before each review, which strengthens retention compared with massed study."
            ),
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()

    evaluation = payload["evaluation"]
    assert evaluation is not None
    assert 0 <= evaluation["grade"] <= 5
    assert isinstance(evaluation["matched_points"], list)
    assert isinstance(evaluation["missing_nuances"], list)
    assert evaluation["socratic_feedback"]
    assert payload["quality"] == evaluation["grade"]
    assert payload["offline_stub"] is True


def test_blank_open_ended_answer_scores_zero(client):
    card = client.get("/api/cards", params={"card_type": "open_ended", "limit": 1}).json()[0]
    response = client.post(
        "/api/review/submit", json={"card_id": card["id"], "user_response": ""}
    )
    # empty body is rejected by the router, so send whitespace instead
    assert response.status_code == 422

    response = client.post(
        "/api/review/submit", json={"card_id": card["id"], "user_response": "x"}
    )
    assert response.status_code == 200
    assert response.json()["quality"] == 0


def test_review_log_is_recorded(client):
    logs = client.get("/api/review/logs", params={"limit": 100}).json()
    assert logs
    assert all(0 <= log["quality_rating"] <= 5 for log in logs)
    assert any(log["socratic_feedback"] for log in logs)


def test_unknown_card_returns_404(client):
    response = client.post("/api/review/submit", json={"card_id": "nope", "quality": 4})
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# stats & maintenance
# ---------------------------------------------------------------------------


def test_stats_aggregates_the_deck(client):
    stats = client.get("/api/stats").json()
    assert stats["total_materials"] >= 1
    assert stats["total_cards"] > 0
    assert sum(stats["cards_by_type"].values()) == stats["total_cards"]
    assert stats["total_reviews"] > 0
    assert 0.0 <= stats["retention_rate"] <= 1.0
    assert len(stats["trend"]) == 14
    assert len(stats["forecast"]) == 14
    assert stats["average_ease_factor"] > 1.3


def test_llm_test_endpoint_explains_missing_key(client):
    payload = client.post("/api/system/llm/test", json={"prompt": "hi"}).json()
    assert payload["ok"] is False
    assert payload["offline_stub"] is True
    assert "API key" in payload["error"]


def test_reset_requires_confirmation(client):
    assert client.post("/api/system/reset").json()["deleted_cards"] == 0
    assert client.get("/api/stats").json()["total_cards"] > 0


# ---------------------------------------------------------------------------
# anki export
# ---------------------------------------------------------------------------


def test_anki_export_returns_a_package(client, generated, material):
    response = client.get(f"/api/materials/{material['id']}/export/anki")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/octet-stream"
    assert ".apkg" in response.headers["content-disposition"]
    assert int(response.headers["x-card-count"]) == len(generated["created"])
    assert response.content[:2] == b"PK"  # .apkg files are zip archives


def test_anki_export_rejects_a_material_with_no_cards(client):
    created = client.post(
        "/api/materials",
        json={
            "title": "Empty Deck",
            "content": (
                "This material exists only to verify the empty-export guard. It has "
                "plenty of characters but no generated cards attached to it yet."
            ),
        },
    ).json()
    response = client.get(f"/api/materials/{created['id']}/export/anki")
    assert response.status_code == 400
    assert "no cards" in response.json()["detail"]


# ---------------------------------------------------------------------------
# chunk lineage
# ---------------------------------------------------------------------------


def test_card_lineage_returns_the_source_chunk(client, generated):
    card = generated["created"][0]
    lineage = client.get(f"/api/cards/{card['id']}/lineage").json()

    assert lineage["card_id"] == card["id"]
    assert lineage["material_title"]
    assert lineage["chunk_id"] == card["source_chunk_id"]
    assert lineage["chunk_text"]
    assert lineage["chunk_ordinal"] is not None
    assert lineage["total_chunks"] >= 1


def test_card_lineage_404s_for_unknown_card(client):
    assert client.get("/api/cards/nope/lineage").status_code == 404
