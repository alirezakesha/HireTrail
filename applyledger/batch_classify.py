"""
Gmail-independent batch classification helpers (OpenAI + date parsing).

Kept separate from `batch_sync.py` so unit tests can import without `googleapiclient`.
"""

from __future__ import annotations

import json
from typing import Any, Optional

from dateutil import parser as date_parser
from openai import OpenAI

from applyledger.extract import openai_chat_completion_kwargs

JOB_EMAIL_BATCH_SYSTEM_PROMPT = """You are a precise information extraction system.

The user message is JSON: {"emails": [ ... ]}. Each element has:
- gmail_message_id: string (opaque; copy exactly into your output for that email)
- from, subject, date, snippet, body: same meaning as in the single-email task (body may be truncated)

For EVERY input email, produce one object in "results" with this shape:
{
  "gmail_message_id": string,
  "is_job_related": boolean,
  "category": "application_confirmation" | "rejection" | "follow_up" | "interview" | "offer" | "job_alert" | "newsletter" | "other",
  "company": string | null,
  "job_title": string | null,
  "job_id": string | null,
  "applied_date": string | null,
  "event_date": string | null,
  "confidence": number,
  "reason": string,
  "evidence": {"company": string | null, "job_title": string | null, "job_id": string | null},
  "notes": string | null
}

Return ONLY valid JSON: {"results": [ ... ]}.
Rules:
- results MUST have the SAME LENGTH as input emails, and MUST be in the SAME ORDER.
- gmail_message_id in each result MUST equal the corresponding input gmail_message_id.
- Apply the same classification rules as for single emails (non-job mail, job alerts, etc.).
- applied_date only for category application_confirmation; null for rejection, interview, and all other categories.
"""


def normalize_date(date_raw: Optional[str]) -> Optional[str]:
    if not date_raw:
        return None
    try:
        dt = date_parser.parse(date_raw)
        return dt.isoformat()
    except (ValueError, TypeError, OverflowError):
        return None


def classify_emails_batch_openai(
    *,
    client: OpenAI,
    model: str,
    batch: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """One API call for len(batch) messages — same contract as `gmail_batch.ipynb`."""
    if not batch:
        return {}

    # ~120 tokens per email in JSON; cap avoids slow over-generation on large batches
    completion_cap = min(4000, 350 + 120 * max(1, len(batch)))

    resp = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": JOB_EMAIL_BATCH_SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps({"emails": batch}, ensure_ascii=False)},
        ],
        response_format={"type": "json_object"},
        **openai_chat_completion_kwargs(model, completion_cap=completion_cap),
    )

    content = json.loads(resp.choices[0].message.content or "{}")
    results = content.get("results")
    if not isinstance(results, list):
        return {}

    out: dict[str, dict[str, Any]] = {}
    for item in results:
        if not isinstance(item, dict):
            continue
        mid = item.get("gmail_message_id")
        if not mid:
            continue
        extracted = {k: v for k, v in item.items() if k != "gmail_message_id"}
        out[str(mid)] = extracted
    return out
