"""
Embedding-based merge suggestions — same idea as the last cells of `gmail.ipynb`:
batch `text-embedding-3-small` on each row's `app_key`, then cosine similarity between
open (`application_confirmation`) rows and `rejection` rows with different keys.
"""

from __future__ import annotations

import sqlite3
from typing import Any

import numpy as np
from openai import OpenAI

from applyledger.config import Settings

# Same order of magnitude as `sim_thresh` in `gmail.ipynb` (e.g. 0.9); only show matches at or above this.
MIN_COSINE_SIMILARITY = 0.9


def _row_to_app(r: sqlite3.Row) -> dict[str, Any]:
    return {k: r[k] for k in r.keys()}


def _cosine_similarity_rows(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Pairwise cosine similarity: each row of `a` vs each row of `b`. Shapes (n, d), (m, d) → (n, m)."""
    a_norm = np.linalg.norm(a, axis=1, keepdims=True) + 1e-12
    b_norm = np.linalg.norm(b, axis=1, keepdims=True) + 1e-12
    a_u = a / a_norm
    b_u = b / b_norm
    return a_u @ b_u.T


def get_embeddings_batch(
    texts: list[str],
    *,
    client: OpenAI,
    model: str,
    batch_size: int = 64,
) -> list[list[float]]:
    out: list[list[float]] = []
    for i in range(0, len(texts), batch_size):
        chunk = texts[i : i + batch_size]
        if not chunk:
            continue
        resp = client.embeddings.create(model=model, input=chunk)
        out.extend([list(d.embedding) for d in resp.data])
    if len(out) != len(texts):
        raise RuntimeError(f"Embedding count mismatch: expected {len(texts)}, got {len(out)}")
    return out


def compute_embedding_merge_suggestions(
    conn: sqlite3.Connection,
    settings: Settings,
    *,
    top_k: int = 3,
) -> dict[str, Any]:
    conn.row_factory = sqlite3.Row
    conf = conn.execute(
        """
        SELECT app_key, company, job_title, job_id, status, applied_date,
               last_update_date, confidence, notes, updated_at
        FROM applications
        WHERE status = 'application_confirmation'
        ORDER BY datetime(updated_at) DESC;
        """
    ).fetchall()
    rej = conn.execute(
        """
        SELECT app_key, company, job_title, job_id, status, applied_date,
               last_update_date, confidence, notes, updated_at
        FROM applications
        WHERE status = 'rejection'
        ORDER BY datetime(updated_at) DESC;
        """
    ).fetchall()

    model = settings.openai_embedding_model

    if not conf:
        return {
            "items": [],
            "embedding_model": model,
            "min_cosine_similarity": MIN_COSINE_SIMILARITY,
            "hint": "No open applications (application_confirmation) to analyze.",
        }
    if not rej:
        return {
            "items": [],
            "embedding_model": model,
            "min_cosine_similarity": MIN_COSINE_SIMILARITY,
            "hint": "No rejection rows to compare.",
        }

    client = OpenAI(api_key=settings.openai_api_key)
    texts_conf = [str(r["app_key"] or "") for r in conf]
    texts_rej = [str(r["app_key"] or "") for r in rej]
    all_texts = texts_conf + texts_rej
    embs = get_embeddings_batch(all_texts, client=client, model=model, batch_size=settings.embedding_batch_size)
    n_c = len(conf)
    emb_c = embs[:n_c]
    emb_r = embs[n_c:]
    m_c = np.asarray(emb_c, dtype=np.float64)
    m_r = np.asarray(emb_r, dtype=np.float64)
    sim = _cosine_similarity_rows(m_c, m_r)

    k = min(max(1, top_k), m_r.shape[0])
    items: list[dict[str, Any]] = []
    for i, c in enumerate(conf):
        scores = sim[i]
        order = np.argsort(scores)[::-1]
        candidates: list[dict[str, Any]] = []
        for j in order:
            score = float(scores[j])
            if score < MIN_COSINE_SIMILARITY:
                break
            rj = rej[j]
            if rj["app_key"] == c["app_key"]:
                continue
            candidates.append(
                {
                    "rejection": _row_to_app(rj),
                    "cosine_similarity": score,
                }
            )
            if len(candidates) >= k:
                break
        if not candidates:
            continue
        items.append({"confirmation": _row_to_app(c), "candidates": candidates})

    if not items:
        return {
            "items": [],
            "embedding_model": model,
            "min_cosine_similarity": MIN_COSINE_SIMILARITY,
            "hint": (
                "No open application had a rejection match with embedding cosine similarity ≥ "
                f"{MIN_COSINE_SIMILARITY:.0%}. "
                "Lower-similarity pairs are hidden on purpose."
            ),
        }

    return {
        "items": items,
        "embedding_model": model,
        "min_cosine_similarity": MIN_COSINE_SIMILARITY,
        "hint": None,
    }
