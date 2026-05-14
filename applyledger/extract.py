import json
import re
from typing import Any, Optional

from bs4 import BeautifulSoup
from openai import OpenAI


JOB_EMAIL_SYSTEM_PROMPT = """You are a precise information extraction system.

You will be given a single email about jobs/careers (or not related).
Your task: decide whether it relates to a job application the user made, and if so, classify the event and extract key fields.

Return ONLY valid JSON matching this schema:
{
  "is_job_related": boolean,
  "category": "application_confirmation" | "rejection" | "follow_up" | "interview" | "offer" | "job_alert" | "newsletter" | "other",
  "company": string | null,
  "job_title": string | null,
  "job_id": string | null,
  "applied_date": string | null,
  "event_date": string | null,
  "confidence": number,
  "reason": string,
  "evidence": {
    "company": string | null,
    "job_title": string | null,
    "job_id": string | null
  },
  "notes": string | null
}

Rules:
- If it is not about a job application process (e.g. grocery promos, receipts), set is_job_related=false.
- If it's about a job posting alert or LinkedIn "add connection" etc, keep is_job_related=true but category="job_alert" or "other".
- Prefer company/job_title/job_id only when clearly supported; otherwise null.
"""


def html_to_text(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    text = soup.get_text("\n")
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def build_client(openai_api_key: str) -> OpenAI:
    return OpenAI(api_key=openai_api_key)


def _output_token_kwargs(model: str, cap: int = 250) -> dict[str, int]:
    """gpt-5 / o-series reject max_tokens; they require max_completion_tokens."""
    m = (model or "").lower()
    if m.startswith(("gpt-5", "o1", "o3", "o4")):
        return {"max_completion_tokens": cap}
    return {"max_tokens": cap}


def _temperature_kwargs(model: str) -> dict[str, float]:
    """Some models only support the default temperature (1); passing 0 returns 400."""
    m = (model or "").lower()
    if m.startswith(("gpt-5", "o1", "o3", "o4")):
        return {}
    return {"temperature": 0.0}


def openai_chat_completion_kwargs(model: str, *, completion_cap: int = 250) -> dict[str, Any]:
    """Extra kwargs for chat.completions.create (matches `gmail_batch.ipynb` + newer OpenAI models)."""
    return {**_temperature_kwargs(model), **_output_token_kwargs(model, completion_cap)}


def classify_email_with_openai(
    *,
    client: OpenAI,
    model: str,
    subject: Optional[str],
    from_addr: Optional[str],
    date_raw: Optional[str],
    snippet: Optional[str],
    body_text: Optional[str],
    max_body_chars: int = 4000,
) -> dict[str, Any]:
    user_content = {
        "from": from_addr,
        "subject": subject,
        "date": date_raw,
        "snippet": snippet,
        "body": (body_text or "")[:max_body_chars],
    }

    resp = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": JOB_EMAIL_SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps(user_content, ensure_ascii=False)},
        ],
        response_format={"type": "json_object"},
    )
    
    content = resp.choices[0].message.content or "{}"
    return json.loads(content)

