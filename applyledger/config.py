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
    """Same as `gmail_batch.ipynb` / `OPENAI_CLASSIFY_BATCH_SIZE`."""
    openai_classify_batch_size: int
    """Same as `gmail_batch.ipynb` / `GMAIL_FETCH_BATCH_SIZE`."""
    gmail_fetch_batch_size: int
    """OpenAI embedding model for merge suggestions (`gmail.ipynb` uses text-embedding-3-small)."""
    openai_embedding_model: str
    """Batch size for `client.embeddings.create` input lists."""
    embedding_batch_size: int


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
        openai_model=os.getenv("OPENAI_MODEL", "gpt-5-nano"),
        db_path=os.getenv("JOBTRACKER_DB", "jobtracker.sqlite3"),
        openai_classify_batch_size=int(os.getenv("OPENAI_CLASSIFY_BATCH_SIZE", "12")),
        gmail_fetch_batch_size=int(os.getenv("GMAIL_FETCH_BATCH_SIZE", "50")),
        openai_embedding_model=os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small"),
        embedding_batch_size=int(os.getenv("OPENAI_EMBEDDING_BATCH_SIZE", "64")),
    )

