"""Gmail OAuth helpers — supports Google Cloud **Web** and **Desktop** client JSON."""

from __future__ import annotations

import json
import secrets
from pathlib import Path
from typing import Any

from google_auth_oauthlib.flow import Flow

from applyledger.config import Settings


def read_oauth_json(path: str) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def oauth_client_kind(secrets_path: str) -> str:
    data = read_oauth_json(secrets_path)
    if "web" in data:
        return "web"
    if "installed" in data:
        return "installed"
    raise ValueError(f"{secrets_path} must contain a 'web' or 'installed' OAuth client block.")


def resolve_redirect_uri(secrets_path: str, override: str | None) -> str:
    if override:
        return override.strip()
    data = read_oauth_json(secrets_path)
    if "web" in data:
        uris = data["web"].get("redirect_uris") or []
        if uris:
            return str(uris[0])
    return "http://127.0.0.1:8000/api/auth/gmail/callback"


def make_oauth_flow(settings: Settings, redirect_uri: str) -> Flow:
    return Flow.from_client_secrets_file(
        settings.google_client_secrets_file,
        scopes=settings.gmail_scopes,
        redirect_uri=redirect_uri,
    )


def save_credentials_json(creds: Any, token_file: str) -> None:
    Path(token_file).write_text(creds.to_json(), encoding="utf-8")


def pending_oauth_path(token_file: str) -> Path:
    """PKCE verifier + state between /start and /callback (same machine, local dev)."""
    return Path(token_file).with_name(".gmail_oauth_pending.json")


def save_oauth_pending(
    token_file: str,
    *,
    state: str,
    code_verifier: str,
    redirect_uri: str,
) -> None:
    pending_oauth_path(token_file).write_text(
        json.dumps(
            {"state": state, "code_verifier": code_verifier, "redirect_uri": redirect_uri},
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def load_oauth_pending(token_file: str) -> dict[str, str]:
    path = pending_oauth_path(token_file)
    if not path.is_file():
        raise FileNotFoundError("No pending OAuth session; start again from Connect Gmail.")
    data = json.loads(path.read_text(encoding="utf-8"))
    return {
        "state": str(data["state"]),
        "code_verifier": str(data["code_verifier"]),
        "redirect_uri": str(data["redirect_uri"]),
    }


def clear_oauth_pending(token_file: str) -> None:
    path = pending_oauth_path(token_file)
    if path.is_file():
        path.unlink()


def flow_code_verifier(flow: Flow) -> str:
    """PKCE verifier generated when `authorization_url` is called."""
    verifier = getattr(flow, "code_verifier", None)
    if verifier:
        return str(verifier)
    session = getattr(flow, "oauth2session", None)
    if session is not None:
        client = getattr(session, "_client", None)
        if client is not None and getattr(client, "code_verifier", None):
            return str(client.code_verifier)
    raise RuntimeError("OAuth flow did not produce a PKCE code_verifier.")


def new_oauth_state() -> str:
    return secrets.token_urlsafe(32)
