import base64
from pathlib import Path
from typing import Optional

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

from applyledger.gmail_oauth import oauth_client_kind


def get_gmail_service(*, client_secrets_file: str, token_file: str, scopes: list[str]):
    creds = None
    token_path = Path(token_file)

    if token_path.exists():
        creds = Credentials.from_authorized_user_file(token_file, scopes)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        elif oauth_client_kind(client_secrets_file) == "installed":
            flow = InstalledAppFlow.from_client_secrets_file(client_secrets_file, scopes)
            creds = flow.run_local_server(port=0)
        else:
            raise RuntimeError(
                "Gmail is not authorized yet. In the app, open the Sync tab and click "
                "'Connect Gmail', or visit /api/auth/gmail/start while the API server is running."
            )
        token_path.write_text(creds.to_json(), encoding="utf-8")

    return build("gmail", "v1", credentials=creds)


def header(headers: list[dict], name: str) -> Optional[str]:
    name_lower = name.lower()
    for h in headers or []:
        if (h.get("name") or "").lower() == name_lower:
            return h.get("value")
    return None


def b64url_decode(data: str) -> bytes:
    return base64.urlsafe_b64decode(data.encode("utf-8"))


def extract_bodies(payload: dict) -> dict[str, str]:
    out: dict[str, str] = {}

    def walk(part: dict):
        mime = part.get("mimeType")
        body = part.get("body") or {}
        data = body.get("data")
        if data and mime in ("text/plain", "text/html"):
            try:
                out[mime] = b64url_decode(data).decode("utf-8", errors="replace")
            except Exception:
                out[mime] = ""
        for p in part.get("parts") or []:
            walk(p)

    walk(payload or {})
    return out

