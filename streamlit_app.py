import json
from pathlib import Path
from typing import Any

import pandas as pd
import streamlit as st

from applyledger.config import load_settings
from applyledger.db import (
    ALLOWED_APP_CATEGORIES,
    add_human_review,
    connect,
    init_db,
    is_message_processed,
    mark_message_processed,
    upsert_application_from_extraction,
)
from applyledger.extract import build_client, classify_email_with_openai, html_to_text
from applyledger.gmail_client import extract_bodies, get_gmail_service, header


st.set_page_config(page_title="ApplyLedger", layout="wide")


@st.cache_resource
def settings_and_clients():
    s = load_settings()
    init_db(s.db_path)
    gmail = get_gmail_service(
        client_secrets_file=s.google_client_secrets_file,
        token_file=s.gmail_token_file,
        scopes=s.gmail_scopes,
    )
    oai = build_client(s.openai_api_key)
    return s, gmail, oai


def fetch_applications_df(db_path: str) -> pd.DataFrame:
    conn = connect(db_path)
    conn.row_factory = None
    try:
        rows = conn.execute(
            """
            SELECT app_key, company, job_title, job_id, status, last_update_date, last_email_date_raw, confidence, notes, updated_at
            FROM applications
            ORDER BY updated_at DESC;
            """
        ).fetchall()
    finally:
        conn.close()

    cols = [
        "app_key",
        "company",
        "job_title",
        "job_id",
        "status",
        "last_update_date",
        "last_email_date_raw",
        "confidence",
        "notes",
        "updated_at",
    ]
    return pd.DataFrame(rows, columns=cols)


def fetch_review_candidates(db_path: str, limit: int = 50) -> pd.DataFrame:
    """
    Candidates = applications currently marked as rejection/interview/confirmation.
    (You confirm/override; decisions are written to human_reviews + app_events.)
    """
    conn = connect(db_path)
    try:
        rows = conn.execute(
            """
            SELECT a.app_key, a.company, a.job_title, a.job_id, a.status, a.last_update_date, a.last_email_message_id, a.notes, a.confidence
            FROM applications a
            ORDER BY a.updated_at DESC
            LIMIT ?;
            """,
            (limit,),
        ).fetchall()
    finally:
        conn.close()

    return pd.DataFrame(
        rows,
        columns=[
            "app_key",
            "company",
            "job_title",
            "job_id",
            "status",
            "last_update_date",
            "last_email_message_id",
            "notes",
            "confidence",
        ],
    )


def process_new_emails(*, query: str, max_results: int, max_body_chars: int) -> dict[str, int]:
    s, gmail, oai = settings_and_clients()

    resp = gmail.users().messages().list(userId="me", q=query, maxResults=max_results).execute()
    msgs = resp.get("messages", [])

    stats = {"found": len(msgs), "skipped": 0, "processed_now": 0, "stored_app_records": 0}

    conn = connect(s.db_path)
    try:
        for m in msgs:
            message_id = m["id"]

            if is_message_processed(conn, message_id):
                stats["skipped"] += 1
                continue

            full = gmail.users().messages().get(userId="me", id=message_id, format="full").execute()
            payload = full.get("payload") or {}
            headers = payload.get("headers") or []

            from_addr = header(headers, "From")
            to_addr = header(headers, "To")
            subject = header(headers, "Subject")
            date_raw = header(headers, "Date")
            snippet = (full.get("snippet") or "").replace("\n", " ")

            bodies = extract_bodies(payload)
            body_text = bodies.get("text/plain")
            if not body_text and bodies.get("text/html"):
                body_text = html_to_text(bodies["text/html"])

            extracted = classify_email_with_openai(
                client=oai,
                model=s.openai_model,
                subject=subject,
                from_addr=from_addr,
                date_raw=date_raw,
                snippet=snippet,
                body_text=body_text,
                max_body_chars=max_body_chars,
            )

            mark_message_processed(conn, message_id, extracted, model=s.openai_model)
            stats["processed_now"] += 1

            stored = upsert_application_from_extraction(
                conn,
                gmail_message_id=message_id,
                gmail_thread_id=full.get("threadId"),
                internal_date_ms=int(full.get("internalDate")) if full.get("internalDate") else None,
                from_addr=from_addr,
                to_addr=to_addr,
                subject=subject,
                date_raw=date_raw,
                snippet=snippet,
                body_text=body_text,
                extracted=extracted,
            )
            if stored:
                stats["stored_app_records"] += 1

        conn.commit()
    finally:
        conn.close()

    return stats


st.title("ApplyLedger")
st.caption("Gmail → OpenAI → SQLite. Rerun-safe. Human confirmation built in.")

with st.sidebar:
    st.subheader("Settings")
    query = st.text_input(
        "Gmail query",
        value="in:inbox (category:primary OR category:updates)",
        help="Gmail search query used during sync.",
    )
    max_results = st.slider("Max emails per sync", min_value=10, max_value=500, value=200, step=10)
    max_body_chars = st.slider("Max body chars sent to OpenAI", min_value=500, max_value=8000, value=3500, step=250)

    st.divider()
    st.write("Stored categories:", ", ".join(sorted(ALLOWED_APP_CATEGORIES)))


tabs = st.tabs(["1) Setup", "2) Sync", "3) Review & Update", "4) Applications"])


with tabs[0]:
    st.subheader("Setup")
    st.markdown(
        """
**Required local files**
- `.env` (OpenAI key + Gmail config)
- `credentials.json` (Google OAuth client secrets)

When you press **Authenticate**, a browser window will open for Gmail OAuth and create `token.json`.
"""
    )

    if st.button("Authenticate (Gmail OAuth)", type="primary"):
        # Force creation of services; will run local-server auth if needed
        s, _, _ = settings_and_clients()
        st.success(f"Authenticated. Token saved to `{s.gmail_token_file}`.")


with tabs[1]:
    st.subheader("Sync (process new emails only)")
    st.markdown(
        """
This step fetches emails and processes only **new** Gmail message IDs.
Already-processed IDs are stored in `processed_messages`, so rerunning does **not** re-call OpenAI.
"""
    )

    col1, col2 = st.columns([1, 1])
    with col1:
        if st.button("Run sync now", type="primary"):
            with st.spinner("Syncing…"):
                stats = process_new_emails(query=query, max_results=max_results, max_body_chars=max_body_chars)
            st.success(
                f"Done. found={stats['found']} skipped={stats['skipped']} processed_now={stats['processed_now']} stored={stats['stored_app_records']}"
            )

    with col2:
        st.info("Tip: keep the query narrow to reduce cost.")


with tabs[2]:
    st.subheader("Review & Update (human confirmation)")
    st.markdown(
        """
Use this to confirm/override statuses. Decisions are saved to `human_reviews` and appended to `app_events`,
so you don’t redo work on reruns.
"""
    )

    s, gmail, _ = settings_and_clients()
    df = fetch_review_candidates(s.db_path, limit=50)
    if df.empty:
        st.write("No applications yet. Run **Sync** first.")
    else:
        selected_key = st.selectbox(
            "Pick an application",
            df["app_key"].tolist(),
            format_func=lambda k: f"{k} — {df.loc[df['app_key']==k, 'status'].iloc[0]}",
        )

        row = df[df["app_key"] == selected_key].iloc[0].to_dict()
        st.write(
            {
                "company": row.get("company"),
                "job_title": row.get("job_title"),
                "job_id": row.get("job_id"),
                "current_status": row.get("status"),
                "confidence": row.get("confidence"),
                "last_update_date": row.get("last_update_date"),
            }
        )

        # Show the last email (snippet) for context if available
        last_msg_id = row.get("last_email_message_id")
        if last_msg_id:
            try:
                msg = gmail.users().messages().get(userId="me", id=last_msg_id, format="metadata").execute()
                st.caption("Latest related email snippet")
                st.code((msg.get("snippet") or "").strip())
            except Exception:
                pass

        st.divider()
        new_status = st.selectbox(
            "Set status",
            ["application_confirmation", "interview", "rejection", "follow_up", "offer", "other"],
            index=["application_confirmation", "interview", "rejection", "follow_up", "offer", "other"].index(
                row.get("status") if row.get("status") in ["application_confirmation", "interview", "rejection"] else "other"
            ),
        )
        note = st.text_input("Note (optional)")

        if st.button("Save decision", type="primary"):
            conn = connect(s.db_path)
            try:
                add_human_review(
                    conn,
                    app_key=selected_key,
                    decided_status=new_status,
                    note=note or None,
                    source_event_id=None,
                    previous_status=row.get("status"),
                )
                conn.commit()
            finally:
                conn.close()
            st.success("Saved. Status updated and event appended.")


with tabs[3]:
    st.subheader("Applications")
    s, _, _ = settings_and_clients()
    apps = fetch_applications_df(s.db_path)
    if apps.empty:
        st.write("No applications yet. Run **Sync** first.")
    else:
        st.dataframe(apps, use_container_width=True, hide_index=True)

