"""Pure helpers in `applyledger.extract` — no network."""

from __future__ import annotations

from applyledger.extract import html_to_text


def test_html_to_text_strips_tags() -> None:
    html = "<html><body><p>Hello <b>world</b></p><script>evil()</script></body></html>"
    t = html_to_text(html)
    assert "Hello" in t
    assert "world" in t
    assert "evil" not in t
