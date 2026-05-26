"""Read/update/delete SQLite tables for the Tables UI (ordered by email sent time)."""

from __future__ import annotations

import json
import sqlite3
from typing import Any

ALLOWED_TABLES = frozenset(
    {"emails", "processed_messages", "applications", "app_events", "human_reviews"}
)

# Primary key column(s) used in API `pk` (scalar: single column name).
TABLE_PK: dict[str, str] = {
    "emails": "gmail_message_id",
    "processed_messages": "gmail_message_id",
    "applications": "app_key",
    "app_events": "id",
    "human_reviews": "id",
}

# Columns that must not be changed via PATCH.
TABLE_IMMUTABLE: dict[str, frozenset[str]] = {
    "emails": frozenset({"gmail_message_id", "created_at"}),
    "processed_messages": frozenset({"gmail_message_id", "processed_at"}),
    "applications": frozenset({"id", "app_key", "created_at"}),
    "app_events": frozenset({"id", "created_at"}),
    "human_reviews": frozenset({"id", "decided_at"}),
}

TABLE_SELECT: dict[str, str] = {
    "emails": """
        SELECT *,
               COALESCE(internal_date_ms, 0) AS _email_sent_ms,
               date_raw AS _email_sent_label
        FROM emails
        ORDER BY COALESCE(internal_date_ms, 0) DESC, datetime(created_at) DESC
    """,
    "processed_messages": """
        SELECT pm.*,
               COALESCE(e.internal_date_ms, 0) AS _email_sent_ms,
               COALESCE(e.date_raw, pm.processed_at) AS _email_sent_label
        FROM processed_messages pm
        LEFT JOIN emails e ON e.gmail_message_id = pm.gmail_message_id
        ORDER BY COALESCE(e.internal_date_ms, 0) DESC, datetime(pm.processed_at) DESC
    """,
    "applications": """
        SELECT a.*,
               COALESCE(
                 (SELECT e.internal_date_ms FROM emails e
                  WHERE e.gmail_message_id = a.last_email_message_id LIMIT 1),
                 0
               ) AS _email_sent_ms,
               COALESCE(a.last_email_date_raw, a.applied_date, a.updated_at) AS _email_sent_label
        FROM applications a
        ORDER BY COALESCE(
                 (SELECT e.internal_date_ms FROM emails e
                  WHERE e.gmail_message_id = a.last_email_message_id LIMIT 1),
                 0
               ) DESC,
               datetime(COALESCE(a.last_email_date_raw, a.applied_date, a.updated_at)) DESC
    """,
    "app_events": """
        SELECT ev.*,
               COALESCE(e.internal_date_ms, 0) AS _email_sent_ms,
               COALESCE(e.date_raw, ev.event_date, ev.created_at) AS _email_sent_label
        FROM app_events ev
        LEFT JOIN emails e ON e.gmail_message_id = ev.gmail_message_id
        ORDER BY COALESCE(e.internal_date_ms, 0) DESC,
                 datetime(COALESCE(ev.event_date, ev.created_at)) DESC
    """,
    "human_reviews": """
        SELECT hr.*,
               COALESCE(e.internal_date_ms, 0) AS _email_sent_ms,
               COALESCE(e.date_raw, ev.event_date, hr.decided_at) AS _email_sent_label
        FROM human_reviews hr
        LEFT JOIN app_events ev ON ev.id = hr.source_event_id
        LEFT JOIN emails e ON e.gmail_message_id = ev.gmail_message_id
        ORDER BY COALESCE(e.internal_date_ms, 0) DESC, datetime(hr.decided_at) DESC
    """,
}


def _assert_table(name: str) -> str:
    if name not in ALLOWED_TABLES:
        raise ValueError(f"Unknown table: {name}")
    return name


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    for k in ("_email_sent_ms", "_email_sent_label"):
        d.pop(k, None)
    return d


def list_tables(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for name in sorted(ALLOWED_TABLES):
        count = conn.execute(f"SELECT COUNT(*) AS c FROM {name};").fetchone()["c"]
        out.append(
            {
                "name": name,
                "row_count": int(count),
                "primary_key": TABLE_PK[name],
                "sort": "email_sent_desc",
            }
        )
    return out


def fetch_table_rows(
    conn: sqlite3.Connection,
    table: str,
    *,
    limit: int = 100,
    offset: int = 0,
) -> dict[str, Any]:
    name = _assert_table(table)
    limit = max(1, min(limit, 500))
    offset = max(0, offset)
    sql = TABLE_SELECT[name]
    rows = conn.execute(f"{sql} LIMIT ? OFFSET ?;", (limit, offset)).fetchall()
    total = conn.execute(f"SELECT COUNT(*) AS c FROM {name};").fetchone()["c"]
    items: list[dict[str, Any]] = []
    for r in rows:
        email_sent_ms = int(r["_email_sent_ms"] or 0)
        email_sent_label = r["_email_sent_label"]
        payload = _row_to_dict(r)
        items.append(
            {
                "pk": payload[TABLE_PK[name]],
                "email_sent_ms": email_sent_ms,
                "email_sent_label": str(email_sent_label) if email_sent_label is not None else None,
                "data": payload,
            }
        )
    cols = [c[1] for c in conn.execute(f"PRAGMA table_info({name});").fetchall()]
    return {
        "table": name,
        "primary_key": TABLE_PK[name],
        "columns": cols,
        "immutable_columns": sorted(TABLE_IMMUTABLE[name]),
        "rows": items,
        "total": int(total),
        "limit": limit,
        "offset": offset,
    }


def _coerce_value(col: str, value: Any, row_sample: dict[str, Any]) -> Any:
    if value is None:
        return None
    sample = row_sample.get(col)
    if isinstance(sample, int) and not isinstance(sample, bool):
        if isinstance(value, bool):
            return int(value)
        if isinstance(value, (int, float)):
            return int(value)
        if isinstance(value, str) and value.strip().isdigit():
            return int(value.strip())
    if isinstance(sample, float):
        return float(value)
    if isinstance(sample, (dict, list)) or col in ("raw_json",):
        if isinstance(value, str):
            json.loads(value)
            return value
        return json.dumps(value, ensure_ascii=False)
    return value if isinstance(value, str) else str(value)


def update_table_row(
    conn: sqlite3.Connection,
    table: str,
    *,
    pk: Any,
    fields: dict[str, Any],
) -> dict[str, Any]:
    name = _assert_table(table)
    pk_col = TABLE_PK[name]
    immutable = TABLE_IMMUTABLE[name]
    if not fields:
        raise ValueError("No fields to update.")

    row = conn.execute(f"SELECT * FROM {name} WHERE {pk_col} = ? LIMIT 1;", (pk,)).fetchone()
    if row is None:
        raise ValueError(f"Row not found in {name}.")

    sample = dict(row)
    updates: dict[str, Any] = {}
    for col, val in fields.items():
        if col in immutable or col == pk_col:
            raise ValueError(f"Column cannot be updated: {col}")
        if col not in sample:
            raise ValueError(f"Unknown column: {col}")
        updates[col] = _coerce_value(col, val, sample)

    if not updates:
        raise ValueError("No valid fields to update.")

    set_clause = ", ".join(f"{c} = ?" for c in updates)
    params = list(updates.values()) + [pk]
    conn.execute(f"UPDATE {name} SET {set_clause} WHERE {pk_col} = ?;", params)

    if name == "applications":
        from applyledger.db import utcnow_iso

        conn.execute(
            "UPDATE applications SET updated_at = ? WHERE app_key = ?;",
            (utcnow_iso(), pk),
        )

    return {"table": name, "pk": pk, "updated": list(updates.keys())}


def delete_table_row(conn: sqlite3.Connection, table: str, *, pk: Any) -> dict[str, Any]:
    name = _assert_table(table)
    pk_col = TABLE_PK[name]
    row = conn.execute(f"SELECT 1 FROM {name} WHERE {pk_col} = ? LIMIT 1;", (pk,)).fetchone()
    if row is None:
        raise ValueError(f"Row not found in {name}.")

    if name == "applications":
        conn.execute("DELETE FROM app_events WHERE app_key = ?;", (pk,))
        try:
            conn.execute("DELETE FROM human_reviews WHERE app_key = ?;", (pk,))
        except sqlite3.OperationalError:
            pass

    conn.execute(f"DELETE FROM {name} WHERE {pk_col} = ?;", (pk,))
    return {"table": name, "pk": pk, "deleted": True}
