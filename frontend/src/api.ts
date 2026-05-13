export type Meta = {
  ready: boolean
  openai_model?: string
  db_file?: string
  gmail_token_file?: string
  error?: string
}

export type ApplicationRow = {
  app_key: string
  company: string | null
  job_title: string | null
  job_id: string | null
  status: string
  /** Earliest apply signal from the pipeline, when the API exposes it */
  applied_date?: string | null
  last_update_date: string | null
  last_email_date_raw: string | null
  confidence: number | null
  notes: string | null
  updated_at: string | null
}

export type ReviewEventRow = {
  event_id: number
  app_key: string
  event_type: string
  status: string
  event_date: string | null
  gmail_message_id: string | null
  raw_json: string | null
  created_at: string | null
  company: string | null
  job_title: string | null
  job_id: string | null
  confidence: number | null
  notes: string | null
}

export type TimelineRow = {
  app_key: string
  label: string
  start: string
  end: string
  outcome: string
  company: string | null
  job_title: string | null
  job_id: string | null
  status: string
  interview_at: string | null
  rejection_at: string | null
}

export type SyncStats = {
  found: number
  skipped: number
  processed_now: number
  stored_app_records: number
}

/** Avoid hanging forever when the API is down or the Vite proxy target is not running. */
const DEFAULT_REQUEST_MS = 18_000

async function parseError(res: Response): Promise<string> {
  const text = await res.text()
  try {
    const j = JSON.parse(text) as { detail?: unknown }
    if (j && typeof j.detail === 'string') return j.detail
    if (Array.isArray(j?.detail))
      return j.detail.map((d: { msg?: string }) => d.msg ?? JSON.stringify(d)).join('; ')
    return text ? JSON.stringify(j) : `HTTP ${res.status}`
  } catch {
    return text ? text.slice(0, 800) : `HTTP ${res.status}`
  }
}

async function fetchWithTimeout(input: string, init: RequestInit | undefined, ms: number): Promise<Response> {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new Error(
        `Request timed out after ${Math.round(ms / 1000)}s (${input}). Start the backend on port 8000 and use "npm run dev" so /api is proxied.`,
      )
    }
    throw e
  } finally {
    clearTimeout(id)
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const r = await fetchWithTimeout(path, undefined, DEFAULT_REQUEST_MS)
  if (!r.ok) throw new Error(await parseError(r))
  return r.json() as Promise<T>
}

export async function apiPost<T>(
  path: string,
  body?: unknown,
  /** Long jobs (e.g. sync) need a larger value than default GETs. */
  requestMs: number = DEFAULT_REQUEST_MS,
): Promise<T> {
  const r = await fetchWithTimeout(
    path,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    requestMs,
  )
  if (!r.ok) throw new Error(await parseError(r))
  return r.json() as Promise<T>
}
