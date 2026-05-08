import json
import sqlite3
from datetime import datetime
from typing import Any, Optional


ALLOWED_APP_CATEGORIES = {"application_confirmation", "interview", "rejection"}


def utcnow_iso() -> str:
    return datetime.utcnow().isoformat()


def connect(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn


def init_db(db_path: str) -> None:
    conn = connect(db_path)
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS emails (
              gmail_message_id TEXT PRIMARY KEY,
              gmail_thread_id TEXT,
              internal_date_ms INTEGER,
              from_addr TEXT,
              to_addr TEXT,
              subject TEXT,
              date_raw TEXT,
              snippet TEXT,
              body_text TEXT,
              created_at TEXT NOT NULL
            );
            """
        )

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS processed_messages (
              gmail_message_id TEXT PRIMARY KEY,
              category TEXT,
              confidence REAL,
              model TEXT,
              raw_json TEXT,
              processed_at TEXT NOT NULL
            );
            """
        )

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS applications (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              app_key TEXT NOT NULL UNIQUE,
              company TEXT,
              job_title TEXT,
              job_id TEXT,
              source TEXT,
              applied_date TEXT,
              status TEXT NOT NULL,
              last_update_date TEXT,
              last_email_message_id TEXT,
              last_email_date_raw TEXT,
              confidence REAL,
              notes TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            """
        )

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS app_events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              app_key TEXT NOT NULL,
              event_type TEXT NOT NULL,
              event_date TEXT,
              gmail_message_id TEXT,
              raw_json TEXT,
              created_at TEXT NOT NULL,
              FOREIGN KEY(app_key) REFERENCES applications(app_key)
            );
            """
        )

        # Human review decisions (prevents re-review on rerun)
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS human_reviews (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              app_key TEXT NOT NULL,
              source_event_id INTEGER,
              previous_status TEXT,
              decided_status TEXT NOT NULL,
              note TEXT,
              decided_at TEXT NOT NULL,
              UNIQUE(app_key, decided_status, decided_at)
            );
            """
        )

        conn.commit()
    finally:
        conn.close()


def is_message_processed(conn: sqlite3.Connection, gmail_message_id: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM processed_messages WHERE gmail_message_id = ? LIMIT 1;",
        (gmail_message_id,),
    ).fetchone()
    return row is not None


def mark_message_processed(
    conn: sqlite3.Connection,
    gmail_message_id: str,
    extracted: dict[str, Any],
    *,
    model: str,
) -> None:
    now = utcnow_iso()
    conn.execute(
        """
        INSERT INTO processed_messages (gmail_message_id, category, confidence, model, raw_json, processed_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(gmail_message_id) DO UPDATE SET
          category=excluded.category,
          confidence=excluded.confidence,
          model=excluded.model,
          raw_json=excluded.raw_json,
          processed_at=excluded.processed_at;
        """,
        (
            gmail_message_id,
            extracted.get("category"),
            extracted.get("confidence"),
            model,
            json.dumps(extracted, ensure_ascii=False),
            now,
        ),
    )


def make_app_key(company: Optional[str], job_title: Optional[str], job_id: Optional[str]) -> str:
    c = (company or "").strip().lower()
    t = (job_title or "").strip().lower()
    j = (job_id or "").strip().lower()
    if j:
        return f"job_id:{j}"
    if c or t:
        return f"company_title:{c}|{t}".strip("|")
    return "unknown"


def upsert_application_from_extraction(
    conn: sqlite3.Connection,
    *,
    gmail_message_id: str,
    gmail_thread_id: Optional[str],
    internal_date_ms: Optional[int],
    from_addr: Optional[str],
    to_addr: Optional[str],
    subject: Optional[str],
    date_raw: Optional[str],
    snippet: Optional[str],
    body_text: Optional[str],
    extracted: dict[str, Any],
) -> bool:
    """
    Writes SQL ONLY if extracted category is in ALLOWED_APP_CATEGORIES.
    Returns True if stored, else False.
    """
    status = extracted.get("category") or "other"
    if status not in ALLOWED_APP_CATEGORIES:
        return False

    now = utcnow_iso()
    app_key = make_app_key(extracted.get("company"), extracted.get("job_title"), extracted.get("job_id"))

    conn.execute(
        """
        INSERT INTO emails (
          gmail_message_id, gmail_thread_id, internal_date_ms,
          from_addr, to_addr, subject, date_raw, snippet, body_text, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(gmail_message_id) DO UPDATE SET
          gmail_thread_id=excluded.gmail_thread_id,
          internal_date_ms=excluded.internal_date_ms,
          from_addr=excluded.from_addr,
          to_addr=excluded.to_addr,
          subject=excluded.subject,
          date_raw=excluded.date_raw,
          snippet=excluded.snippet,
          body_text=excluded.body_text;
        """,
        (
            gmail_message_id,
            gmail_thread_id,
            internal_date_ms,
            from_addr,
            to_addr,
            subject,
            date_raw,
            snippet,
            body_text,
            now,
        ),
    )

    applied_date = extracted.get("applied_date")
    event_date = extracted.get("event_date")  # can be None; UI can still show raw date
    conf = extracted.get("confidence")

    conn.execute(
        """
        INSERT INTO applications (
          app_key, company, job_title, job_id, source, applied_date,
          status, last_update_date, last_email_message_id, last_email_date_raw,
          confidence, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(app_key) DO UPDATE SET
          company=COALESCE(excluded.company, applications.company),
          job_title=COALESCE(excluded.job_title, applications.job_title),
          job_id=COALESCE(excluded.job_id, applications.job_id),
          status=excluded.status,
          last_update_date=excluded.last_update_date,
          last_email_message_id=excluded.last_email_message_id,
          last_email_date_raw=excluded.last_email_date_raw,
          confidence=excluded.confidence,
          notes=excluded.notes,
          updated_at=excluded.updated_at;
        """,
        (
            app_key,
            extracted.get("company"),
            extracted.get("job_title"),
            extracted.get("job_id"),
            from_addr,
            applied_date,
            status,
            event_date,
            gmail_message_id,
            date_raw,
            conf,
            extracted.get("notes") or extracted.get("reason"),
            now,
            now,
        ),
    )

    conn.execute(
        """
        INSERT INTO app_events (app_key, event_type, event_date, gmail_message_id, raw_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?);
        """,
        (
            app_key,
            status,
            event_date,
            gmail_message_id,
            json.dumps(extracted, ensure_ascii=False),
            now,
        ),
    )

    return True


def add_human_review(
    conn: sqlite3.Connection,
    *,
    app_key: str,
    decided_status: str,
    note: str | None,
    source_event_id: int | None = None,
    previous_status: str | None = None,
) -> None:
    now = utcnow_iso()
    conn.execute(
        """
        INSERT INTO human_reviews (app_key, source_event_id, previous_status, decided_status, note, decided_at)
        VALUES (?, ?, ?, ?, ?, ?);
        """,
        (app_key, source_event_id, previous_status, decided_status, note, now),
    )

    # Update applications + add an event
    conn.execute(
        """
        UPDATE applications
        SET status = ?, notes = COALESCE(?, notes), updated_at = ?
        WHERE app_key = ?;
        """,
        (decided_status, note, now, app_key),
    )

    conn.execute(
        """
        INSERT INTO app_events (app_key, event_type, event_date, gmail_message_id, raw_json, created_at)
        VALUES (?, ?, ?, NULL, ?, ?);
        """,
        (
            app_key,
            f"manual:{decided_status}",
            now,
            json.dumps({"note": note, "status": decided_status}, ensure_ascii=False),
            now,
        ),
    )

