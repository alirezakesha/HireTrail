import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { apiPost, apiStreamSync, type SyncStreamLine } from '../../api'
import { Card } from '../../components/ui/Card'
import { DEFAULT_GMAIL_QUERY } from '../../constants/statuses'

type Props = {
  onSynced: () => void | Promise<void>
}

function phaseLabel(phase: string | null): string {
  switch (phase) {
    case 'listed':
      return 'Scanning inbox…'
    case 'fetch':
      return 'Loading message bodies from Gmail…'
    case 'classify':
      return 'Classifying with OpenAI…'
    case 'complete':
      return 'Done'
    default:
      return 'Connecting…'
  }
}

function progressFromLine(line: SyncStreamLine): number {
  if (line.phase === 'complete') return 100
  if (line.phase === 'error') return 0
  const { step, steps_total } = line
  if (!steps_total) return 0
  return Math.min(100, Math.round((100 * step) / steps_total))
}

function parseIntInRange(raw: string, min: number, max: number, fallback: number): number {
  const trimmed = raw.trim()
  if (!trimmed) return fallback
  const n = Number.parseInt(trimmed, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

export function SyncPanel({ onSynced }: Props) {
  const qc = useQueryClient()
  const [query, setQuery] = useState(DEFAULT_GMAIL_QUERY)
  const [maxResultsInput, setMaxResultsInput] = useState('10')
  const [maxBodyInput, setMaxBodyInput] = useState('1000')
  const [syncProgress, setSyncProgress] = useState(0)
  const [syncPhase, setSyncPhase] = useState<string | null>(null)

  const authM = useMutation({
    mutationFn: () => apiPost<{ gmail_token_file: string; message: string }>('/api/auth/gmail'),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['meta'] })
    },
  })

  const syncM = useMutation({
    mutationFn: () =>
      apiStreamSync(
        {
          query,
          max_results: parseIntInRange(maxResultsInput, 10, 500, 10),
          max_body_chars: parseIntInRange(maxBodyInput, 500, 8000, 1000),
        },
        (line) => {
          setSyncPhase(line.phase === 'error' ? null : line.phase)
          setSyncProgress(progressFromLine(line))
        },
      ),
    onSuccess: async () => {
      await onSynced()
    },
    onSettled: () => {
      setSyncProgress(0)
      setSyncPhase(null)
    },
  })

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <h2 className="font-display text-lg font-semibold text-[var(--color-ink)]">Gmail OAuth</h2>
        <p className="mt-3 text-sm leading-relaxed text-[var(--color-muted)]">
          Uses the same desktop OAuth flow as the notebook: the Python server opens a browser on this machine and
          writes <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-xs">token.json</code>.
        </p>
        <button
          type="button"
          disabled={authM.isPending}
          onClick={() => authM.mutate()}
          className="mt-6 w-full rounded-xl bg-[var(--color-accent)] px-4 py-3 text-sm font-semibold text-[#1a1408] shadow-lg shadow-[var(--color-accent)]/20 transition hover:brightness-110 disabled:opacity-50"
        >
          {authM.isPending ? 'Opening browser…' : 'Authenticate Gmail'}
        </button>
        {authM.isSuccess && (
          <p className="mt-4 text-sm text-[var(--color-ok)]">
            Token saved to <span className="font-mono">{authM.data.gmail_token_file}</span>
          </p>
        )}
        {authM.isError && (
          <p className="mt-4 text-sm text-[var(--color-danger)]">{(authM.error as Error).message}</p>
        )}
      </Card>
      <Card>
        <h2 className="font-display text-lg font-semibold text-[var(--color-ink)]">Sync new messages</h2>
        <p className="mt-3 text-sm text-[var(--color-muted)]">
          New Gmail message IDs are classified; already-processed IDs are skipped. When sync finishes, the Applications
          and Timeline lists refresh in the background (read mail in inbox still matches <span className="font-mono">in:inbox</span>{' '}
          unless your query restricts it). Progress updates stream from the server while each message is fetched and
          classified.
        </p>
        <label className="mt-6 block text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
          Gmail query
        </label>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="mt-2 w-full rounded-xl border border-[var(--color-border)] bg-black/25 px-4 py-2.5 font-mono text-sm text-[var(--color-ink)] outline-none ring-[var(--color-accent)]/40 focus:ring-2"
        />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
              Max emails
            </label>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="10"
              value={maxResultsInput}
              onChange={(e) => setMaxResultsInput(e.target.value.replace(/\D/g, ''))}
              className="mt-2 w-full rounded-xl border border-[var(--color-border)] bg-black/25 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]/40"
            />
            <p className="mt-1 text-xs text-[var(--color-muted)]">10–500; empty uses 10</p>
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
              Max body chars (OpenAI)
            </label>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="1000"
              value={maxBodyInput}
              onChange={(e) => setMaxBodyInput(e.target.value.replace(/\D/g, ''))}
              className="mt-2 w-full rounded-xl border border-[var(--color-border)] bg-black/25 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]/40"
            />
            <p className="mt-1 text-xs text-[var(--color-muted)]">500–8000; empty uses 1000</p>
          </div>
        </div>
        {syncM.isPending && (
          <div className="mt-6 space-y-2">
            <div className="flex justify-between text-xs text-[var(--color-muted)]">
              <span>{phaseLabel(syncPhase)}</span>
              <span className="tabular-nums">{syncProgress}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-black/35">
              <div
                className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-300 ease-out"
                style={{ width: `${syncProgress}%` }}
              />
            </div>
          </div>
        )}
        <button
          type="button"
          disabled={syncM.isPending}
          onClick={() => syncM.mutate()}
          className="mt-6 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm font-semibold text-[var(--color-ink)] transition hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-surface-2)] disabled:opacity-50"
        >
          {syncM.isPending ? 'Syncing…' : 'Run sync'}
        </button>
        {syncM.isSuccess && (
          <pre className="mt-4 overflow-x-auto rounded-xl bg-black/30 p-4 font-mono text-xs text-[var(--color-muted)]">
            {JSON.stringify(syncM.data, null, 2)}
          </pre>
        )}
        {syncM.isError && (
          <p className="mt-4 text-sm text-[var(--color-danger)]">{(syncM.error as Error).message}</p>
        )}
      </Card>
    </div>
  )
}
