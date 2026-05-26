"""
Batch Gmail + OpenAI sync — same flow as `gmail_batch.ipynb`:
- list message ids
- skip `processed_messages`
- fetch full bodies with Gmail HTTP batch (`GMAIL_FETCH_BATCH_SIZE`)
- classify with OpenAI batch (`OPENAI_CLASSIFY_BATCH_SIZE`), per-message fallback
- `mark_message_processed` + `upsert_application_from_extraction` (applyledger `db` module)
"""

from __future__ import annotations

import sqlite3
from collections.abc import Callable
from typing import Any, Optional

from googleapiclient.errors import HttpError
from openai import OpenAI

from applyledger import db
from applyledger.batch_classify import classify_emails_batch_openai, normalize_date
from applyledger.config import Settings
from applyledger.extract import classify_email_with_openai, html_to_text
from applyledger.gmail_client import extract_bodies as gmail_extract_bodies
from applyledger.gmail_client import get_gmail_service, header


def fetch_recent_messages(service: Any, max_results: int, query: str | None) -> list[dict[str, Any]]:
    """Same paging behavior as `gmail_batch.ipynb` (up to `max_results` ids)."""
    try:
        all_msgs: list[dict[str, Any]] = []
        next_page_token: str | None = None
        while len(all_msgs) < max_results:
            remaining = max_results - len(all_msgs)
            fetch_count = min(500, remaining)
            req = service.users().messages().list(
                userId="me",
                maxResults=fetch_count,
                q=query,
                pageToken=next_page_token,
            )
            resp = req.execute()
            msgs = resp.get("messages", [])
            all_msgs.extend(msgs)
            next_page_token = resp.get("nextPageToken")
            if not next_page_token or len(all_msgs) >= max_results:
                break
        return all_msgs[:max_results]
    except HttpError as e:
        raise RuntimeError(f"Gmail API error: {e}") from e


def get_message_full(service: Any, message_id: str) -> dict[str, Any]:
    return service.users().messages().get(userId="me", id=message_id, format="full").execute()


def get_messages_full_batch(service: Any, message_ids: list[str], chunk_sz: int) -> dict[str, dict[str, Any]]:
    """Gmail batch HTTP — same as `gmail_batch.ipynb`."""
    if not message_ids:
        return {}
    out: dict[str, dict[str, Any]] = {}
    chunk_sz = max(1, min(chunk_sz, 100))
    for i in range(0, len(message_ids), chunk_sz):
        chunk = message_ids[i : i + chunk_sz]
        batch = service.new_batch_http_request()
        for mid in chunk:

            def _cb(rid: str, resp: Any, exc: BaseException | None, mid: str = mid) -> None:
                if exc is not None:
                    out[mid] = get_message_full(service, mid)
                else:
                    out[mid] = resp

            req = service.users().messages().get(userId="me", id=mid, format="full")
            batch.add(req, callback=_cb, request_id=mid)
        batch.execute()
    return out


def run_process_inbox_batch(
    *,
    settings: Settings,
    query: str,
    max_results: int,
    max_body_chars: int,
    progress_callback: Optional[Callable[[dict[str, Any]], None]] = None,
) -> dict[str, int]:
    """Port of `process_inbox_to_db_batch` from `gmail_batch.ipynb`."""
    db.init_db(settings.db_path)
    conn = db.connect(settings.db_path)
    client = OpenAI(api_key=settings.openai_api_key)

    service = get_gmail_service(
        client_secrets_file=settings.google_client_secrets_file,
        token_file=settings.gmail_token_file,
        scopes=settings.gmail_scopes,
    )

    msgs = fetch_recent_messages(service, max_results, query)
    if not msgs:
        conn.close()
        stats = {"found": 0, "skipped": 0, "processed_now": 0, "stored_app_records": 0}
        if progress_callback:
            progress_callback({"phase": "complete", "stats": stats})
        return stats

    all_ids = [str(m["id"]) for m in msgs if m.get("id")]
    found = len(all_ids)

    already = db.fetch_processed_message_ids(conn, all_ids)
    skipped = len(already)
    pending_ids = [mid for mid in all_ids if mid not in already]

    if not pending_ids:
        conn.close()
        stats = {"found": found, "skipped": skipped, "processed_now": 0, "stored_app_records": 0}
        if progress_callback:
            progress_callback({"phase": "complete", "stats": stats})
        return stats

    n_pending = len(pending_ids)
    steps_total = max(1, 2 * n_pending)

    def _emit(step: int, phase: str, **extra: Any) -> None:
        if progress_callback:
            payload: dict[str, Any] = {
                "phase": phase,
                "step": step,
                "steps_total": steps_total,
                "found": found,
                "skipped": skipped,
                "pending": n_pending,
            }
            payload.update(extra)
            progress_callback(payload)

    step = 0
    _emit(step, "listed")
    full_by_id = get_messages_full_batch(
        service,
        pending_ids,
        max(1, min(settings.gmail_fetch_batch_size, 100)),
    )

    body_slice = min(1500, max(500, max_body_chars))

    pending_rows: list[dict[str, Any]] = []
    for mid in pending_ids:
        full = full_by_id.get(mid) or get_message_full(service, mid)
        payload = full.get("payload") or {}
        headers = payload.get("headers") or []
        from_addr = header(headers, "From")
        to_addr = header(headers, "To")
        subject = header(headers, "Subject")
        date_raw = header(headers, "Date")
        snippet = (full.get("snippet") or "").replace("\n", " ")
        bodies = gmail_extract_bodies(payload)
        body_text = bodies.get("text/plain")
        if not body_text and bodies.get("text/html"):
            body_text = html_to_text(bodies["text/html"])
        pending_rows.append(
            {
                "message_id": mid,
                "full": full,
                "from_addr": from_addr,
                "to_addr": to_addr,
                "subject": subject,
                "date_raw": date_raw,
                "snippet": snippet,
                "body_text": body_text,
            }
        )
        step += 1
        _emit(step, "fetch", message_id=mid)

    bs = max(1, settings.openai_classify_batch_size)
    processed_now = 0
    stored_app_records = 0

    try:
        for start in range(0, len(pending_rows), bs):
            chunk = pending_rows[start : start + bs]
            api_batch = [
                {
                    "gmail_message_id": row["message_id"],
                    "from": row["from_addr"],
                    "subject": row["subject"],
                    "date": row["date_raw"],
                    "snippet": row["snippet"],
                    "body": (row["body_text"] or "")[:body_slice],
                }
                for row in chunk
            ]

            by_id = classify_emails_batch_openai(client=client, model=settings.openai_model, batch=api_batch)

            for row in chunk:
                mid = row["message_id"]
                extracted = by_id.get(mid)
                if extracted is None:
                    extracted = classify_email_with_openai(
                        client=client,
                        model=settings.openai_model,
                        subject=row["subject"],
                        from_addr=row["from_addr"],
                        date_raw=row["date_raw"],
                        snippet=row["snippet"],
                        body_text=row["body_text"],
                        max_body_chars=body_slice,
                    )

                db.mark_message_processed(
                    conn,
                    mid,
                    extracted,
                    model=settings.openai_model,
                )

                processed_now += 1

                full = row["full"]
                ex = dict(extracted)
                if ex.get("event_date") is None and row["date_raw"]:
                    ex["event_date"] = normalize_date(row["date_raw"])

                if ex.get("category") in db.ALLOWED_APP_CATEGORIES:
                    db.upsert_application_from_extraction(
                        conn,
                        gmail_message_id=mid,
                        gmail_thread_id=full.get("threadId"),
                        internal_date_ms=int(full["internalDate"]) if full.get("internalDate") else None,
                        from_addr=row["from_addr"],
                        to_addr=row["to_addr"],
                        subject=row["subject"],
                        date_raw=row["date_raw"],
                        snippet=row["snippet"],
                        body_text=row["body_text"],
                        extracted=ex,
                    )
                    stored_app_records += 1

                step += 1
                _emit(
                    step,
                    "classify",
                    processed_messages=processed_now,
                    stored_app_records=stored_app_records,
                    last_message_id=mid,
                )

            conn.commit()
    finally:
        conn.close()

    stats = {
        "found": found,
        "skipped": skipped,
        "processed_now": processed_now,
        "stored_app_records": stored_app_records,
    }
    if progress_callback:
        progress_callback({"phase": "complete", "stats": stats})
    return stats
