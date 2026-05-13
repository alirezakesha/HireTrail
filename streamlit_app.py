import hashlib
import json
from typing import Any, Optional

import pandas as pd
import plotly.express as px
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

TIMELINE_OUTCOME_LABELS: tuple[str, ...] = (
    "Rejected",
    "Interview (no rejection logged)",
    "Open / pending",
)


def _timeline_outcome_to_status(display_label: str) -> str:
    m = {
        "Rejected": "rejection",
        "Interview (no rejection logged)": "interview",
        "Open / pending": "follow_up",
    }
    if display_label not in m:
        raise ValueError(f"Unknown outcome label: {display_label!r}")
    return m[display_label]


def _timeline_row_widget_key(app_key: str) -> str:
    return "tl_o_" + hashlib.md5(app_key.encode("utf-8")).hexdigest()


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


def _normalize_timeline_event_type(event_type: str | None) -> Optional[str]:
    if not event_type:
        return None
    if event_type in ("application_confirmation", "rejection", "interview"):
        return event_type
    if event_type.startswith("manual:"):
        tail = event_type.split(":", 1)[1]
        if tail in ("application_confirmation", "rejection", "interview"):
            return tail
    return None


def _timeline_label_field(x: Any) -> str:
    try:
        if x is None or pd.isna(x):
            return "?"
    except TypeError:
        if x is None:
            return "?"
    s = str(x).strip()
    return s if s else "?"


@st.cache_data(ttl=30)
def fetch_application_timeline_chart(db_path: str) -> pd.DataFrame:
    """
    One row per application for a Gantt-style chart: bar from first apply signal to rejection or 'today'.
    Uses app_events (including manual:* decisions) plus applications.applied_date as fallback.
    """
    conn = connect(db_path)
    try:
        apps = pd.read_sql(
            """
            SELECT app_key, company, job_title, job_id, applied_date, status, last_update_date
            FROM applications;
            """,
            conn,
        )
        ev = pd.read_sql(
            """
            SELECT app_key, event_type, event_date
            FROM app_events
            WHERE event_date IS NOT NULL AND TRIM(event_date) != '';
            """,
            conn,
        )
    finally:
        conn.close()

    if apps.empty:
        return pd.DataFrame()

    if not ev.empty:
        ev = ev.copy()
        ev["etype"] = ev["event_type"].apply(_normalize_timeline_event_type)
        ev = ev.dropna(subset=["etype"])
        ev["dt"] = pd.to_datetime(ev["event_date"], utc=True, errors="coerce", format="mixed")
        ev = ev.dropna(subset=["dt"])
        first_by = ev.groupby(["app_key", "etype"], as_index=False)["dt"].min()
        if first_by.empty:
            m = apps.copy()
        else:
            pivot = first_by.pivot(index="app_key", columns="etype", values="dt").reset_index()
            m = apps.merge(pivot, on="app_key", how="left")
    else:
        m = apps.copy()

    for col in ("application_confirmation", "rejection", "interview"):
        if col not in m.columns:
            m[col] = pd.NaT

    for col in ("applied_date", "last_update_date"):
        if col in m.columns:
            m[col] = pd.to_datetime(m[col], utc=True, errors="coerce", format="mixed")

    m["start"] = m["application_confirmation"].combine_first(m["applied_date"]).combine_first(m["last_update_date"])
    m = m[m["start"].notna()].copy()

    now = pd.Timestamp.now(tz="UTC")
    m["end"] = m["rejection"].where(m["rejection"].notna(), now)

    bad = m["end"] < m["start"]
    m.loc[bad, "end"] = m.loc[bad, "start"] + pd.Timedelta(days=1)

    def label_row(r: pd.Series) -> str:
        c = _timeline_label_field(r.get("company"))
        t = _timeline_label_field(r.get("job_title"))
        return f"{c[:42]} — {t[:42]}"

    m["label"] = m.apply(label_row, axis=1)

    vc = m["label"].value_counts()
    dup = vc[vc > 1].index
    if len(dup):
        m.loc[m["label"].isin(dup), "label"] = m.loc[m["label"].isin(dup), "label"] + m.loc[
            m["label"].isin(dup), "app_key"
        ].astype(str).map(lambda k: f" [{k[-10:]}]")

    m = m.sort_values("start", ascending=False)

    def _outcome_from_row(r: pd.Series) -> str:
        st_raw = r.get("status")
        if st_raw is not None and not (isinstance(st_raw, float) and pd.isna(st_raw)):
            st = str(st_raw).strip()
            if st == "rejection":
                return "Rejected"
            if st == "interview":
                return "Interview (no rejection logged)"
            if st in ("follow_up", "offer", "other"):
                return "Open / pending"
        if pd.notna(r.get("rejection")):
            return "Rejected"
        if pd.notna(r.get("interview")):
            return "Interview (no rejection logged)"
        return "Open / pending"

    m["outcome"] = m.apply(_outcome_from_row, axis=1)

    return m[
        [
            "app_key",
            "label",
            "start",
            "end",
            "outcome",
            "company",
            "job_title",
            "job_id",
            "status",
            "interview",
            "rejection",
        ]
    ].rename(columns={"interview": "interview_at", "rejection": "rejection_at"})


def fetch_review_candidates(db_path: str, limit: int = 50) -> pd.DataFrame:
    """
    Event-based candidates (aligned with notebook events_df).
    Returns columns needed by tab[2] including a `status` alias for `event_type`.
    """
    conn = connect(db_path)
    try:
        cur = conn.execute(
            """
            SELECT id, app_key, event_type, event_date, gmail_message_id, raw_json, created_at
            FROM app_events
            WHERE event_type IN ('application_confirmation', 'rejection', 'interview')
            ORDER BY created_at DESC
            LIMIT ?;
            """
            ,
            (limit,),
        )
        rows = cur.fetchall()
        cols = [d[0] for d in (cur.description or [])]
    finally:
        conn.close()

    df = pd.DataFrame(rows, columns=cols)
    if df.empty:
        # Keep expected columns present so UI doesn't crash.
        return pd.DataFrame(
            columns=[
                "event_id",
                "app_key",
                "event_type",
                "status",
                "event_date",
                "gmail_message_id",
                "raw_json",
                "created_at",
                "company",
                "job_title",
                "job_id",
                "confidence",
                "notes",
            ]
        )

    df = df.rename(columns={"id": "event_id"})

    def safe_load(s: Any) -> dict[str, Any]:
        if not s:
            return {}
        try:
            return json.loads(s)
        except Exception:
            return {}

    extracted = df["raw_json"].apply(safe_load)
    df["company"] = extracted.apply(lambda x: x.get("company"))
    df["job_title"] = extracted.apply(lambda x: x.get("job_title"))
    df["job_id"] = extracted.apply(lambda x: x.get("job_id"))
    df["confidence"] = extracted.apply(lambda x: x.get("confidence"))
    df["notes"] = extracted.apply(lambda x: x.get("notes") or x.get("reason"))

    # UI expects `status` in a couple places; alias event_type -> status.
    df["status"] = df["event_type"]
    return df

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


tabs = st.tabs(["1) Setup", "2) Sync", "3) Review & Update", "4) Applications", "5) Timeline"])


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
    df = fetch_review_candidates(s.db_path, limit=200)
    if df.empty:
        st.write("No applications yet. Run **Sync** first.")
    else:
        selected_key = st.selectbox(
            "Pick an event (by app_key)",
            df["app_key"].fillna("unknown").tolist(),
            format_func=lambda k: f"{k} — {df.loc[df['app_key']==k, 'status'].iloc[0] if 'status' in df.columns else ''}",
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
                "event_date": row.get("event_date"),
                "event_id": row.get("event_id"),
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
                    source_event_id=row.get("event_id"),
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


with tabs[4]:
    st.subheader("Application timeline (Gantt-style)")
    st.caption(
        "Each row is one application. Bars run from the first apply signal (confirmation or `applied_date`) "
        "to the first rejection date, or to **today** if there is no rejection yet. Includes `manual:*` review events."
    )
    s, _, _ = settings_and_clients()
    tl = fetch_application_timeline_chart(s.db_path)
    if not tl.empty:
        tl = tl.copy(deep=True)
    if tl.empty:
        st.info("No timeline data yet. Run **Sync** (and ensure applications have dates) first.")
    else:
        outcomes = sorted(tl["outcome"].dropna().unique().tolist())
        pick = st.multiselect("Filter by outcome", options=outcomes, default=outcomes)
        q = st.text_input("Filter label (contains)", value="", placeholder="company or role…")
        view = tl[tl["outcome"].isin(pick)] if pick else tl
        if q.strip():
            ql = q.strip().lower()
            view = view[view["label"].str.lower().str.contains(ql, na=False)]
        view = view.copy(deep=True)

        if view.empty:
            st.warning("No rows match the filters.")
        else:
            hover_cols = {
                "company": True,
                "job_title": True,
                "job_id": True,
                "interview_at": True,
                "rejection_at": True,
            }
            fig = px.timeline(
                view,
                x_start="start",
                x_end="end",
                y="label",
                color="outcome",
                hover_name="label",
                hover_data=hover_cols,
            )
            fig.update_yaxes(autorange="reversed", title="")
            fig.update_xaxes(title="Date (UTC)")
            fig.update_layout(
                title="Applied → rejection (or ongoing to today)",
                legend_title="Outcome",
                height=max(420, min(28 * len(view), 2400)),
                margin=dict(l=40, r=40, t=56, b=40),
                bargap=0.15,
            )
            st.plotly_chart(fig, use_container_width=True)

            st.divider()
            st.subheader("Underlying rows")
            st.caption(
                "Use the **Outcome** dropdown on each row, then **Save outcome changes**. "
                "(`Open / pending` is stored as `follow_up`.)"
            )

            view_reset = view.reset_index(drop=True).copy(deep=True)

            display_only = view_reset[
                ["label", "start", "outcome", "company", "job_title", "job_id", "interview_at", "rejection_at"]
            ].copy()

            def _cell_str(x: Any) -> str:
                if x is None or (isinstance(x, float) and pd.isna(x)):
                    return ""
                return str(x).strip()

            for c in ("company", "job_title", "job_id"):
                display_only[c] = display_only[c].map(_cell_str)

            for c in ("start", "interview_at", "rejection_at"):
                display_only[c] = (
                    pd.to_datetime(view_reset[c], utc=True, errors="coerce")
                    .dt.strftime("%Y-%m-%d %H:%M")
                    .fillna("—")
                )

            st.dataframe(display_only, use_container_width=True, hide_index=True)

            st.markdown("**Change outcome**")
            max_edit = 120
            if len(view_reset) > max_edit:
                st.warning(
                    f"Outcome dropdowns are shown for the first **{max_edit}** rows only. "
                    "Narrow filters to edit the rest."
                )
            edit_rows = min(len(view_reset), max_edit)

            for i in range(edit_rows):
                ak = str(view_reset["app_key"].iloc[i])
                row_key = _timeline_row_widget_key(ak)
                cur = view_reset["outcome"].iloc[i]
                try:
                    idx_o = list(TIMELINE_OUTCOME_LABELS).index(cur)
                except ValueError:
                    idx_o = 0
                lab = str(view_reset["label"].iloc[i])
                short = lab if len(lab) <= 100 else lab[:97] + "…"
                c1, c2 = st.columns([4, 2], gap="small")
                with c1:
                    st.caption(f"{i + 1}. {short}")
                with c2:
                    st.selectbox(
                        "Outcome",
                        list(TIMELINE_OUTCOME_LABELS),
                        index=idx_o,
                        key=row_key,
                        label_visibility="collapsed",
                    )

            if st.button("Save outcome changes", type="primary"):
                changed = 0
                conn = connect(s.db_path)
                try:
                    for i in range(edit_rows):
                        ak = str(view_reset["app_key"].iloc[i])
                        row_key = _timeline_row_widget_key(ak)
                        old_o = view_reset["outcome"].iloc[i]
                        new_o = st.session_state.get(row_key, old_o)
                        if str(new_o) == str(old_o):
                            continue
                        decided = _timeline_outcome_to_status(str(new_o))
                        prev = view_reset["status"].iloc[i]
                        prev_s = None if prev is None or (isinstance(prev, float) and pd.isna(prev)) else str(prev)
                        add_human_review(
                            conn,
                            app_key=ak,
                            decided_status=decided,
                            note="Timeline tab outcome update",
                            source_event_id=None,
                            previous_status=prev_s,
                        )
                        changed += 1
                    conn.commit()
                finally:
                    conn.close()
                fetch_application_timeline_chart.clear()
                for k in list(st.session_state.keys()):
                    if isinstance(k, str) and k.startswith("tl_o_"):
                        del st.session_state[k]
                if changed:
                    st.success(f"Saved {changed} outcome update(s). Refreshing…")
                else:
                    st.info("No outcome edits to save.")
                st.rerun()

