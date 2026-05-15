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

export function SyncPanel({ onSynced }: Props) {
  const qc = useQueryClient()
  const [query, setQuery] = useState(DEFAULT_GMAIL_QUERY)
  const [maxResults, setMaxResults] = useState(200)
  const [maxBody, setMaxBody] = useState(3500)
  const [syncProgress, setSyncProgress] = useState(0)
  const [syncPhase, setSyncPhase] = useState<string | null>(null)

  const authM = useMutation({
    mutationFn: () => apiPost<{ gmail_token_file: string; message: string; auth_start_url?: string }>('/api/auth/gmail'),
    onSuccess: (data) => {
      if (data.auth_start_url) {
        window.location.href = data.auth_start_url
        return
      }
      void qc.invalidateQueries({ queryKey: ['meta'] })
    },
  })

  function connectGmail() {
    window.location.href = '/api/auth/gmail/start'
  }

  const syncM = useMutation({
    mutationFn: () =>
      apiStreamSync(
        {
          query,
          max_results: maxResults,
          max_body_chars: maxBody,
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
          Uses your Google Web OAuth client (<span className="font-mono">client_secret.json</span>). You sign in with
          Google; tokens are saved to{' '}
          <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-xs">token.json</code> on the API server.
          Redirect URI in Google Cloud must be{' '}
          <code className="font-mono text-xs">http://127.0.0.1:8000/api/auth/gmail/callback</code>.
        </p>
        <button
          type="button"
          disabled={authM.isPending}
          onClick={connectGmail}
          className="mt-6 w-full rounded-xl bg-[var(--color-accent)] px-4 py-3 text-sm font-semibold text-[#1a1408] shadow-lg shadow-[var(--color-accent)]/20 transition hover:brightness-110 disabled:opacity-50"
        >
          Connect Gmail
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
              type="number"
              min={10}
              max={500}
              step={10}
              value={maxResults}
              onChange={(e) => setMaxResults(Number(e.target.value))}
              className="mt-2 w-full rounded-xl border border-[var(--color-border)] bg-black/25 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]/40"
            />
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
              Max body chars (OpenAI)
            </label>
            <input
              type="number"
              min={500}
              max={8000}
              step={250}
              value={maxBody}
              onChange={(e) => setMaxBody(Number(e.target.value))}
              className="mt-2 w-full rounded-xl border border-[var(--color-border)] bg-black/25 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]/40"
            />
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
