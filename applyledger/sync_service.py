"""Public entry for sync — delegates to `batch_sync` (`gmail_batch.ipynb` pipeline)."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable, Optional

from applyledger.config import Settings
from applyledger.batch_sync import run_process_inbox_batch


def run_sync(
    *,
    settings: Settings,
    query: str,
    max_results: int,
    max_body_chars: int,
    progress_callback: Optional[Callable[[dict[str, Any]], None]] = None,
) -> dict[str, int]:
    return run_process_inbox_batch(
        settings=settings,
        query=query,
        max_results=max_results,
        max_body_chars=max_body_chars,
        progress_callback=progress_callback,
    )


def ensure_credentials_files(settings: Settings) -> Optional[str]:
    """Return error message if OAuth client secrets are missing."""
    if not Path(settings.google_client_secrets_file).is_file():
        return f"Missing Google OAuth client file: {settings.google_client_secrets_file}"
    return None
