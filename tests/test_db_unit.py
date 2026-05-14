"""Unit tests for `applyledger.db` — all use `conn` fixture (temporary DB only)."""

from __future__ import annotations

import json
import sqlite3

from applyledger import db


def test_make_app_key_prefers_job_id() -> None:
    assert db.make_app_key("Acme", "Engineer", "R-123") == "job_id:r-123"


def test_make_app_key_company_title() -> None:
    k = db.make_app_key("Acme", "Engineer", None)
    assert "acme" in k and "engineer" in k


def test_mark_message_processed_empty_extracted_yields_null_category(conn: sqlite3.Connection) -> None:
    """
    If classification returns `{}` or misses keys, `processed_messages` still gets a row
    with gmail_message_id but category/confidence NULL — matches what you may see when
    batch JSON fails or the model omits fields.
    """
    db.mark_message_processed(conn, "msg-empty", {}, model="test-model")
    conn.commit()
    row = conn.execute("SELECT * FROM processed_messages WHERE gmail_message_id = ?", ("msg-empty",)).fetchone()
    assert row is not None
    assert row["gmail_message_id"] == "msg-empty"
    assert row["category"] is None
    assert row["confidence"] is None
    assert row["model"] == "test-model"
    raw = json.loads(row["raw_json"])
    assert raw == {}


def test_mark_message_processed_full_extracted(conn: sqlite3.Connection) -> None:
    ex = {
        "category": "rejection",
        "confidence": 0.91,
        "company": "X",
        "is_job_related": True,
    }
    db.mark_message_processed(conn, "msg-1", ex, model="m")
    conn.commit()
    row = conn.execute("SELECT category, confidence FROM processed_messages WHERE gmail_message_id = ?", ("msg-1",)).fetchone()
    assert row["category"] == "rejection"
    assert abs(row["confidence"] - 0.91) < 1e-6


def test_upsert_application_from_extraction_fills_emails_table(conn: sqlite3.Connection) -> None:
    extracted = {
        "category": "application_confirmation",
        "company": "Contoso",
        "job_title": "ML Engineer",
        "job_id": None,
        "applied_date": "2026-01-15T00:00:00+00:00",
        "event_date": "2026-01-15T12:00:00+00:00",
        "confidence": 0.88,
        "notes": "ok",
    }
    ok = db.upsert_application_from_extraction(
        conn,
        gmail_message_id="gmid-99",
        gmail_thread_id="th-1",
        internal_date_ms=1_700_000_000_000,
        from_addr="hr@contoso.com",
        to_addr="me@example.com",
        subject="Application received",
        date_raw="Wed, 15 Jan 2026 12:00:00 +0000",
        snippet="Thank you for applying",
        body_text="Full body here",
        extracted=extracted,
    )
    assert ok is True
    conn.commit()

    em = conn.execute("SELECT * FROM emails WHERE gmail_message_id = ?", ("gmid-99",)).fetchone()
    assert em is not None
    assert em["from_addr"] == "hr@contoso.com"
    assert em["subject"] == "Application received"
    assert em["snippet"] == "Thank you for applying"
    assert em["body_text"] == "Full body here"
    assert em["gmail_thread_id"] == "th-1"

    app = conn.execute("SELECT * FROM applications WHERE last_email_message_id = ?", ("gmid-99",)).fetchone()
    assert app is not None
    assert app["company"] == "Contoso"
    assert app["status"] == "application_confirmation"


def test_fetch_processed_message_ids_subset(conn: sqlite3.Connection) -> None:
    db.mark_message_processed(conn, "seen-1", {"category": "other"}, model="m")
    conn.commit()
    got = db.fetch_processed_message_ids(conn, ["seen-1", "new-2", "seen-1"])
    assert got == {"seen-1"}

    extracted = {"category": "newsletter", "confidence": 0.5}
    ok = db.upsert_application_from_extraction(
        conn,
        gmail_message_id="g-nl",
        gmail_thread_id=None,
        internal_date_ms=None,
        from_addr="a",
        to_addr="b",
        subject="s",
        date_raw=None,
        snippet="sn",
        body_text="b",
        extracted=extracted,
    )
    assert ok is False
    conn.commit()
    assert conn.execute("SELECT 1 FROM emails WHERE gmail_message_id = ?", ("g-nl",)).fetchone() is None
