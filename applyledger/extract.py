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
        temperature=0,
        messages=[
            {"role": "system", "content": JOB_EMAIL_SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps(user_content, ensure_ascii=False)},
        ],
        response_format={"type": "json_object"},
        max_tokens=250,
    )

    content = resp.choices[0].message.content or "{}"
    return json.loads(content)

