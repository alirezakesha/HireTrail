import os
from dataclasses import dataclass

from dotenv import load_dotenv


@dataclass(frozen=True)
class Settings:
    google_client_secrets_file: str
    gmail_token_file: str
    gmail_scopes: list[str]
    openai_api_key: str
    openai_model: str
    db_path: str


def load_settings() -> Settings:
    load_dotenv()

    openai_key = os.getenv("OPENAI_API_KEY") or os.getenv("openai_api_key") or ""
    if not openai_key:
        raise ValueError("Missing OPENAI_API_KEY (or openai_api_key) in .env")

    scopes = os.getenv("GMAIL_SCOPES", "https://www.googleapis.com/auth/gmail.readonly").split()

    return Settings(
        google_client_secrets_file=os.getenv("GOOGLE_CLIENT_SECRETS_FILE", "credentials.json"),
        gmail_token_file=os.getenv("GMAIL_TOKEN_FILE", "token.json"),
        gmail_scopes=scopes,
        openai_api_key=openai_key,
        openai_model=os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
        db_path=os.getenv("JOBTRACKER_DB", "jobtracker.sqlite3"),
    )

