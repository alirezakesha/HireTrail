import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { apiPost, type SyncStats } from '../../api'
import { Card } from '../../components/ui/Card'
import { DEFAULT_GMAIL_QUERY } from '../../constants/statuses'

type Props = {
  onSynced: () => void
}

export function SyncPanel({ onSynced }: Props) {
  const qc = useQueryClient()
  const [query, setQuery] = useState(DEFAULT_GMAIL_QUERY)
  const [maxResults, setMaxResults] = useState(200)
  const [maxBody, setMaxBody] = useState(3500)

  const authM = useMutation({
    mutationFn: () => apiPost<{ gmail_token_file: string; message: string }>('/api/auth/gmail'),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['meta'] })
    },
  })

  const syncM = useMutation({
    mutationFn: () =>
      apiPost<SyncStats>(
        '/api/sync',
        {
          query,
          max_results: maxResults,
          max_body_chars: maxBody,
        },
        600_000,
      ),
    onSuccess: () => onSynced(),
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
          Only unseen Gmail IDs are classified; reruns skip processed message IDs.
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
