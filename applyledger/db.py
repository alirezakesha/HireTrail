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


def fetch_processed_message_ids(conn: sqlite3.Connection, message_ids: list[str]) -> set[str]:
    """Which of `message_ids` already appear in `processed_messages` (chunked IN query)."""
    if not message_ids:
        return set()
    lim = 900
    found: set[str] = set()
    for off in range(0, len(message_ids), lim):
        chunk = message_ids[off : off + lim]
        ph = ",".join("?" * len(chunk))
        rows = conn.execute(
            f"SELECT gmail_message_id FROM processed_messages WHERE gmail_message_id IN ({ph})",
            chunk,
        ).fetchall()
        found.update(str(r[0]) for r in rows)
    return found


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


def merge_application_pair(conn: sqlite3.Connection, *, app_key_a: str, app_key_b: str) -> dict[str, str]:
    """
    Merge a `rejection` row into an `application_confirmation` row (same job, duplicate keys).
    Reassigns `app_events` and `human_reviews` from the rejection row, updates the survivor to `rejection`
    with merged fields, then deletes the rejection application row.
    """
    if app_key_a == app_key_b:
        raise ValueError("Cannot merge an application with itself.")

    conn.row_factory = sqlite3.Row
    ra = conn.execute("SELECT * FROM applications WHERE app_key = ? LIMIT 1", (app_key_a,)).fetchone()
    rb = conn.execute("SELECT * FROM applications WHERE app_key = ? LIMIT 1", (app_key_b,)).fetchone()
    if ra is None or rb is None:
        raise ValueError("One or both applications were not found.")

    sa, sb = ra["status"], rb["status"]
    if {sa, sb} != {"rejection", "application_confirmation"}:
        raise ValueError("Merge requires exactly one rejection and one application_confirmation row.")

    if sa == "application_confirmation":
        conf, rej = ra, rb
        conf_key, rej_key = app_key_a, app_key_b
    else:
        conf, rej = rb, ra
        conf_key, rej_key = app_key_b, app_key_a

    now = utcnow_iso()

    def _s(v: Any) -> str:
        return (str(v).strip() if v is not None else "") or ""

    company = _s(conf["company"]) or _s(rej["company"]) or None
    job_title = _s(conf["job_title"]) or _s(rej["job_title"]) or None
    job_id = _s(conf["job_id"]) or _s(rej["job_id"]) or None

    ads = [conf["applied_date"], rej["applied_date"]]
    ads_n = [a for a in ads if a]
    applied_merged = min(ads_n) if ads_n else conf["applied_date"] or rej["applied_date"]

    luds = [conf["last_update_date"], rej["last_update_date"]]
    luds_n = [x for x in luds if x]
    last_update_merged = max(luds_n) if luds_n else conf["last_update_date"] or rej["last_update_date"]

    uats = [conf["updated_at"], rej["updated_at"]]
    prefer_rej_email = str(rej["updated_at"] or "") >= str(conf["updated_at"] or "")
    if prefer_rej_email:
        last_mid, last_raw = rej["last_email_message_id"], rej["last_email_date_raw"]
    else:
        last_mid, last_raw = conf["last_email_message_id"], conf["last_email_date_raw"]

    notes_parts = [x for x in (_s(conf["notes"]), _s(rej["notes"])) if x]
    merged_notes = " | ".join(notes_parts) if notes_parts else None

    cc, cr = conf["confidence"], rej["confidence"]
    if cc is None and cr is None:
        merged_conf: Any = None
    else:
        merged_conf = max(float(cc or 0), float(cr or 0))

    conn.execute("UPDATE app_events SET app_key = ? WHERE app_key = ?", (conf_key, rej_key))
    try:
        conn.execute("UPDATE human_reviews SET app_key = ? WHERE app_key = ?", (conf_key, rej_key))
    except sqlite3.OperationalError:
        pass

    conn.execute(
        """
        UPDATE applications SET
          company = ?,
          job_title = ?,
          job_id = ?,
          applied_date = ?,
          status = 'rejection',
          last_update_date = ?,
          last_email_message_id = ?,
          last_email_date_raw = ?,
          confidence = ?,
          notes = ?,
          updated_at = ?
        WHERE app_key = ?;
        """,
        (
            company,
            job_title,
            job_id,
            applied_merged,
            last_update_merged,
            last_mid,
            last_raw,
            merged_conf,
            merged_notes,
            now,
            conf_key,
        ),
    )

    conn.execute(
        """
        INSERT INTO app_events (app_key, event_type, event_date, gmail_message_id, raw_json, created_at)
        VALUES (?, ?, ?, NULL, ?, ?);
        """,
        (
            conf_key,
            "manual:merge",
            now,
            json.dumps(
                {
                    "merged_from_app_key": rej_key,
                    "note": "Merged rejection application into this confirmation record.",
                },
                ensure_ascii=False,
            ),
            now,
        ),
    )

    conn.execute("DELETE FROM applications WHERE app_key = ?", (rej_key,))

    return {"kept_app_key": conf_key, "removed_app_key": rej_key}

