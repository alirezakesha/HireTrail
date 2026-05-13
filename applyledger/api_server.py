"""
HTTP API for the ApplyLedger Vite frontend (`/api/*`).

Run from repo root (with `.venv` activated):

  uvicorn applyledger.api_server:app --reload --host 127.0.0.1 --port 8000

Then `npm run dev` in `frontend/` (Vite proxies `/api` to this server).
"""

from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from applyledger import db
from applyledger.config import load_settings
from applyledger.gmail_client import get_gmail_service
from applyledger.sync_service import ensure_credentials_files, run_sync

app = FastAPI(title="ApplyLedger API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(127\.0\.0\.1|localhost)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _db_path() -> str:
    return os.getenv("JOBTRACKER_DB", "jobtracker.sqlite3")


def _conn() -> sqlite3.Connection:
    path = _db_path()
    db.init_db(path)
    c = db.connect(path)
    c.row_factory = sqlite3.Row
    return c


def _settings_or_error() -> tuple[Any | None, str | None]:
    try:
        return load_settings(), None
    except Exception as e:  # noqa: BLE001
        return None, str(e)


def _meta_payload() -> dict[str, Any]:
    path = _db_path()
    s, err = _settings_or_error()
    db_ok = Path(path).is_file()
    openai_ok = bool(s and getattr(s, "openai_api_key", ""))
    ready = db_ok and openai_ok and err is None
    return {
        "ready": ready,
        "openai_model": getattr(s, "openai_model", None) if s else None,
        "db_file": str(Path(path).resolve()) if db_ok else path,
        "gmail_token_file": getattr(s, "gmail_token_file", None) if s else os.getenv("GMAIL_TOKEN_FILE", "token.json"),
        "error": err if err else (None if ready else "Database or OpenAI not configured; check .env and JOBTRACKER_DB."),
    }


@app.get("/api/meta")
def api_meta() -> dict[str, Any]:
    return _meta_payload()


@app.get("/api/applications")
def api_applications() -> list[dict[str, Any]]:
    conn = _conn()
    try:
        rows = conn.execute(
            """
            SELECT app_key, company, job_title, job_id, status, applied_date,
                   last_update_date, last_email_date_raw, confidence, notes, updated_at
            FROM applications
            ORDER BY datetime(updated_at) DESC;
            """
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def _parse_event_status(raw_json: str | None, event_type: str) -> str:
    if raw_json:
        try:
            data = json.loads(raw_json)
            cat = data.get("category")
            if isinstance(cat, str) and cat:
                return cat
        except (json.JSONDecodeError, TypeError):
            pass
    if event_type.startswith("manual:"):
        return event_type.split(":", 1)[1] or "other"
    return event_type or "other"


@app.get("/api/events/review")
def api_events_review(limit: int = 200) -> list[dict[str, Any]]:
    conn = _conn()
    try:
        rows = conn.execute(
            """
            SELECT e.id AS event_id, e.app_key, e.event_type, e.event_date, e.gmail_message_id,
                   e.raw_json, e.created_at,
                   a.company, a.job_title, a.job_id, a.confidence, a.notes AS app_notes, a.status AS app_status
            FROM app_events e
            JOIN applications a ON a.app_key = e.app_key
            ORDER BY datetime(e.created_at) DESC
            LIMIT ?;
            """,
            (max(1, min(limit, 500)),),
        ).fetchall()
        out: list[dict[str, Any]] = []
        for r in rows:
            status = _parse_event_status(r["raw_json"], r["event_type"])
            out.append(
                {
                    "event_id": r["event_id"],
                    "app_key": r["app_key"],
                    "event_type": r["event_type"],
                    "status": status,
                    "event_date": r["event_date"],
                    "gmail_message_id": r["gmail_message_id"],
                    "raw_json": r["raw_json"],
                    "created_at": r["created_at"],
                    "company": r["company"],
                    "job_title": r["job_title"],
                    "job_id": r["job_id"],
                    "confidence": r["confidence"],
                    "notes": r["app_notes"],
                }
            )
        return out
    finally:
        conn.close()


@app.get("/api/messages/{message_id}/snippet")
def api_message_snippet(message_id: str) -> dict[str, str]:
    conn = _conn()
    try:
        row = conn.execute(
            "SELECT snippet FROM emails WHERE gmail_message_id = ? LIMIT 1;",
            (message_id,),
        ).fetchone()
        if not row or not row["snippet"]:
            raise HTTPException(status_code=404, detail="No stored snippet for this message id.")
        return {"snippet": row["snippet"]}
    finally:
        conn.close()


class ReviewBody(BaseModel):
    app_key: str
    decided_status: str
    note: str | None = None
    source_event_id: int | None = None
    previous_status: str | None = None


@app.post("/api/review")
def api_review(body: ReviewBody) -> dict[str, str]:
    conn = _conn()
    try:
        db.add_human_review(
            conn,
            app_key=body.app_key,
            decided_status=body.decided_status,
            note=body.note,
            source_event_id=body.source_event_id,
            previous_status=body.previous_status,
        )
        conn.commit()
        return {"ok": "true"}
    finally:
        conn.close()


def _max_event_date(conn: sqlite3.Connection, app_key: str, event_substr: str) -> str | None:
    row = conn.execute(
        """
        SELECT MAX(event_date) AS d FROM app_events
        WHERE app_key = ? AND (
          event_type = ? OR event_type LIKE ?
        );
        """,
        (app_key, event_substr, f"%{event_substr}%"),
    ).fetchone()
    val = row["d"] if row else None
    return str(val) if val else None


def _first_confirmation_date(conn: sqlite3.Connection, app_key: str) -> str | None:
    row = conn.execute(
        """
        SELECT MIN(event_date) AS d FROM app_events
        WHERE app_key = ? AND (
          event_type = 'application_confirmation'
          OR event_type LIKE '%application_confirmation%'
        );
        """,
        (app_key,),
    ).fetchone()
    val = row["d"] if row else None
    return str(val) if val else None


@app.get("/api/timeline")
def api_timeline() -> list[dict[str, Any]]:
    conn = _conn()
    try:
        apps = conn.execute(
            """
            SELECT app_key, company, job_title, job_id, status, applied_date,
                   last_update_date, created_at, updated_at
            FROM applications
            ORDER BY datetime(updated_at) DESC;
            """
        ).fetchall()

        rows: list[dict[str, Any]] = []
        for a in apps:
            app_key = a["app_key"]
            company = a["company"]
            job_title = a["job_title"]
            job_id = a["job_id"]
            status = a["status"]
            label = " — ".join([p for p in [company or "", job_title or ""] if p]) or app_key

            rejection_at = _max_event_date(conn, app_key, "rejection")
            interview_at = _max_event_date(conn, app_key, "interview")

            applied_guess = a["applied_date"] or _first_confirmation_date(conn, app_key) or a["created_at"]
            start = applied_guess or a["updated_at"]
            end = rejection_at or interview_at or a["last_update_date"] or a["updated_at"] or start

            if rejection_at:
                outcome = "Rejected"
            elif interview_at:
                outcome = "Interview (no rejection logged)"
            else:
                outcome = "Open / pending"

            rows.append(
                {
                    "app_key": app_key,
                    "label": label,
                    "start": str(start),
                    "end": str(end),
                    "outcome": outcome,
                    "company": company,
                    "job_title": job_title,
                    "job_id": job_id,
                    "status": status,
                    "interview_at": interview_at,
                    "rejection_at": rejection_at,
                }
            )
        return rows
    finally:
        conn.close()


class TimelineOutcomeItem(BaseModel):
    app_key: str
    outcome: str


class TimelineOutcomesBody(BaseModel):
    updates: list[TimelineOutcomeItem] = Field(default_factory=list)


OUTCOME_TO_STATUS = {
    "Rejected": "rejection",
    "Interview (no rejection logged)": "interview",
    "Open / pending": "application_confirmation",
}


@app.post("/api/timeline/outcomes")
def api_timeline_outcomes(body: TimelineOutcomesBody) -> dict[str, int]:
    conn = _conn()
    changed = 0
    try:
        for u in body.updates:
            new_status = OUTCOME_TO_STATUS.get(u.outcome)
            if not new_status:
                continue
            row = conn.execute(
                "SELECT status FROM applications WHERE app_key = ? LIMIT 1;",
                (u.app_key,),
            ).fetchone()
            prev = row["status"] if row else None
            if prev == new_status:
                continue
            db.add_human_review(
                conn,
                app_key=u.app_key,
                decided_status=new_status,
                note=f"timeline outcome: {u.outcome}",
                source_event_id=None,
                previous_status=prev,
            )
            changed += 1
        conn.commit()
        return {"changed": changed}
    finally:
        conn.close()


class SyncBody(BaseModel):
    query: str = "in:inbox (category:primary OR category:updates)"
    max_results: int = 200
    max_body_chars: int = 3500


@app.post("/api/auth/gmail")
def api_auth_gmail() -> dict[str, str]:
    s, err = _settings_or_error()
    if err or not s:
        raise HTTPException(status_code=503, detail=err or "Settings not loaded")
    cred_err = ensure_credentials_files(s)
    if cred_err:
        raise HTTPException(status_code=400, detail=cred_err)
    get_gmail_service(
        client_secrets_file=s.google_client_secrets_file,
        token_file=s.gmail_token_file,
        scopes=s.gmail_scopes,
    )
    return {"gmail_token_file": s.gmail_token_file, "message": "Gmail OAuth complete; token saved."}


@app.post("/api/sync")
def api_sync(body: SyncBody) -> dict[str, int]:
    s, err = _settings_or_error()
    if err or not s:
        raise HTTPException(status_code=503, detail=err or "Settings not loaded")
    cred_err = ensure_credentials_files(s)
    if cred_err:
        raise HTTPException(status_code=400, detail=cred_err)
    stats = run_sync(
        settings=s,
        query=body.query,
        max_results=max(10, min(body.max_results, 500)),
        max_body_chars=max(500, min(body.max_body_chars, 8000)),
    )
    return stats


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("applyledger.api_server:app", host="127.0.0.1", port=8000, reload=True)
