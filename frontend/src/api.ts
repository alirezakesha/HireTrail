export type Meta = {
  ready: boolean
  openai_model?: string
  openai_embedding_model?: string
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

/** One NDJSON line from `POST /api/sync` while the worker runs. */
export type SyncStreamLine =
  | {
      phase: 'listed' | 'fetch' | 'classify'
      step: number
      steps_total: number
      found: number
      skipped: number
      pending: number
      message_id?: string
      processed_messages?: number
      stored_app_records?: number
      last_message_id?: string
    }
  | { phase: 'complete'; stats: SyncStats }
  | { phase: 'error'; message: string }

export type EmbeddingMergeAppSummary = {
  app_key: string
  company: string | null
  job_title: string | null
  job_id: string | null
  status: string
  applied_date?: string | null
  last_update_date: string | null
  confidence: number | null
  notes: string | null
  updated_at: string | null
}

export type EmbeddingMergeSuggestionItem = {
  confirmation: EmbeddingMergeAppSummary
  candidates: { rejection: EmbeddingMergeAppSummary; cosine_similarity: number }[]
}

export type EmbeddingMergeSuggestionsResponse = {
  items: EmbeddingMergeSuggestionItem[]
  embedding_model: string
  /** Minimum cosine similarity between `app_key` embeddings required to show a candidate (e.g. 0.9). */
  min_cosine_similarity: number
  hint: string | null
}

export type DbTableMeta = {
  name: string
  row_count: number
  primary_key: string
  sort: string
}

export type DbTableRowItem = {
  pk: string | number
  email_sent_ms: number
  email_sent_label: string | null
  data: Record<string, unknown>
}

export type DbTableRowsResponse = {
  table: string
  primary_key: string
  columns: string[]
  immutable_columns: string[]
  rows: DbTableRowItem[]
  total: number
  limit: number
  offset: number
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

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const r = await fetchWithTimeout(
    path,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    DEFAULT_REQUEST_MS,
  )
  if (!r.ok) throw new Error(await parseError(r))
  return r.json() as Promise<T>
}

export async function apiDelete<T>(path: string, body: unknown): Promise<T> {
  const r = await fetchWithTimeout(
    path,
    {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    DEFAULT_REQUEST_MS,
  )
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

const SYNC_STREAM_MS = 600_000

/**
 * `POST /api/sync` streams NDJSON (one JSON object per line). Invokes `onProgress` for each line;
 * resolves with final `SyncStats` from the `complete` event.
 */
export async function apiStreamSync(
  body: { query: string; max_results: number; max_body_chars: number },
  onProgress: (line: SyncStreamLine) => void,
  requestMs: number = SYNC_STREAM_MS,
): Promise<SyncStats> {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), requestMs)
  let finalStats: SyncStats | null = null
  try {
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(await parseError(res))
    const reader = res.body?.getReader()
    if (!reader) throw new Error('No response body from sync endpoint.')
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split('\n')
      buffer = parts.pop() ?? ''
      for (const raw of parts) {
        const line = raw.trim()
        if (!line) continue
        let parsed: SyncStreamLine
        try {
          parsed = JSON.parse(line) as SyncStreamLine
        } catch {
          continue
        }
        onProgress(parsed)
        if (parsed.phase === 'complete') finalStats = parsed.stats
        if (parsed.phase === 'error') throw new Error(parsed.message || 'Sync failed')
      }
    }
    const tail = buffer.trim()
    if (tail) {
      const parsed = JSON.parse(tail) as SyncStreamLine
      onProgress(parsed)
      if (parsed.phase === 'complete') finalStats = parsed.stats
      if (parsed.phase === 'error') throw new Error(parsed.message || 'Sync failed')
    }
    if (!finalStats) throw new Error('Sync stream ended without completion stats.')
    return finalStats
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new Error(
        `Sync timed out after ${Math.round(requestMs / 1000)}s. Ensure the API is running on port 8000.`,
      )
    }
    throw e
  } finally {
    clearTimeout(id)
  }
}
