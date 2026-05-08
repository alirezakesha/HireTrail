# ApplyLedger (JobGmail)

Track your job applications directly from Gmail: connect with OAuth, classify application emails with OpenAI, and store results in a local SQLite database for easy status tracking and reporting.

## What this does

- Connects to **Gmail API** using **OAuth 2.0**
- Fetches emails from your inbox (queryable)
- Uses **OpenAI** to classify emails into:
  - `application_confirmation`
  - `interview`
  - `rejection`
  - (other categories are recorded as “processed” to avoid reprocessing, but not stored as application records)
- Stores results in **SQLite** (`jobtracker.sqlite3`)
- Builds a **Pandas DataFrame** of:
  - company, job title, applied date, rejection date, status
- (Optional demo) Uses **FAISS** for similarity search over job texts

## Project layout

- `gmail.ipynb`: main tutorial notebook (end-to-end)
- `.env`: local secrets/config (gitignored)
- `credentials.json`: Google OAuth client secrets (gitignored)
- `token.json`: cached OAuth tokens (gitignored)
- `requirements.txt`: Python dependencies
- `jobtracker.sqlite3`: local database created by the notebook

## Setup

### 1) Create a virtual environment

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
```

### 2) Create Google OAuth credentials

In Google Cloud Console:

- Create/select a project
- Enable **Gmail API**
- Configure **OAuth consent screen**
- Create **OAuth Client ID**
  - Recommended: **Desktop app**
- Download the JSON and save it as `credentials.json` in this folder.

### 3) Configure `.env`

This repo includes a starter `.env`. Make sure it includes:

- `GOOGLE_CLIENT_SECRETS_FILE=credentials.json`
- `GMAIL_TOKEN_FILE=token.json`
- `GMAIL_SCOPES=https://www.googleapis.com/auth/gmail.readonly`
- Your OpenAI key as either:
  - `OPENAI_API_KEY=...` (preferred), or
  - `openai_api_key=...` (also supported by the notebook)

## Run

Open and run `gmail.ipynb` top-to-bottom.

## Streamlit dashboard

Run the dashboard (same pipeline, with rerun-safe sync + human confirmation UI):

```bash
source .venv/bin/activate
pip install -r requirements.txt
streamlit run streamlit_app.py
```

Dashboard features:

- **Setup/Auth**: runs Gmail OAuth and writes `token.json`
- **Sync**: processes only new Gmail message IDs (no repeated OpenAI calls)
- **Review & Update**: confirm/override statuses; decisions are stored in `human_reviews` and appended to `app_events`

Key cells:

- **Gmail OAuth cell**: opens a browser to authenticate, creates `token.json`
- **Process inbox cell**: classifies emails and writes to SQLite
  - Rerun-safe: it skips message IDs already recorded in `processed_messages`
- **DataFrame cell**: produces a Pandas DataFrame with applied/rejection dates and status

## Database notes

The notebook initializes these tables:

- `processed_messages`: every Gmail `message_id` that has been processed (prevents re-calling OpenAI on rerun)
- `emails`: stored only for allowed categories (confirmation/interview/rejection)
- `applications`: one row per application (upserted by `app_key`)
- `app_events`: an append-only timeline of events (email-derived + manual updates)

## Update status manually

The notebook includes a helper cell:

- `update_application_status(app_key, new_status, note=None)`

This updates `applications.status` and adds a `manual:<status>` entry into `app_events`.

## Cost / token control

To reduce OpenAI spend:

- Keep Gmail query narrow (e.g. Primary/Updates only)
- Truncate body text (send snippet/headers first)
- Use rerun-safe processing (already implemented via `processed_messages`)
- Use a smaller model for classification (set `OPENAI_MODEL` in `.env` if desired)

## Security

Do **not** commit:

- `.env`
- `credentials.json`
- `token.json`
- `jobtracker.sqlite3`

They are ignored by `.gitignore` in this project.

