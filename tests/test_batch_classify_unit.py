"""Unit tests for `applyledger.batch_classify` — no Gmail, no real OpenAI (mocked)."""

from __future__ import annotations

import json
from unittest.mock import MagicMock

from applyledger.batch_classify import classify_emails_batch_openai, normalize_date


def test_normalize_date_iso() -> None:
    assert normalize_date("Wed, 15 Jan 2026 12:00:00 +0000") is not None


def test_normalize_date_empty() -> None:
    assert normalize_date("") is None
    assert normalize_date(None) is None


def test_classify_emails_batch_openai_maps_by_gmail_message_id() -> None:
    payload = {
        "results": [
            {
                "gmail_message_id": "abc",
                "category": "rejection",
                "confidence": 0.9,
                "company": "Co",
            },
            {
                "gmail_message_id": "def",
                "category": "application_confirmation",
                "confidence": 0.8,
            },
        ]
    }
    mock_resp = MagicMock()
    mock_resp.choices = [MagicMock()]
    mock_resp.choices[0].message.content = json.dumps(payload)

    client = MagicMock()
    client.chat.completions.create.return_value = mock_resp

    batch = [{"gmail_message_id": "abc", "from": "x", "subject": "s", "date": None, "snippet": "", "body": ""}]
    out = classify_emails_batch_openai(client=client, model="gpt-4o-mini", batch=batch)

    assert "abc" in out
    assert out["abc"]["category"] == "rejection"
    assert out["abc"]["confidence"] == 0.9
    client.chat.completions.create.assert_called_once()


def test_classify_emails_batch_openai_returns_empty_when_results_not_list() -> None:
    mock_resp = MagicMock()
    mock_resp.choices = [MagicMock()]
    mock_resp.choices[0].message.content = json.dumps({"results": "not-a-list"})

    client = MagicMock()
    client.chat.completions.create.return_value = mock_resp

    out = classify_emails_batch_openai(client=client, model="gpt-4o-mini", batch=[{"gmail_message_id": "x"}])
    assert out == {}


def test_classify_emails_batch_openai_skips_items_without_message_id() -> None:
    mock_resp = MagicMock()
    mock_resp.choices = [MagicMock()]
    mock_resp.choices[0].message.content = json.dumps({"results": [{"category": "rejection"}]})

    client = MagicMock()
    client.chat.completions.create.return_value = mock_resp

    out = classify_emails_batch_openai(client=client, model="gpt-4o-mini", batch=[{"gmail_message_id": "z"}])
    assert out == {}
