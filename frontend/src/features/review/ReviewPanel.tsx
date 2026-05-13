import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { apiGet, apiPost, type ReviewEventRow } from '../../api'
import { Card } from '../../components/ui/Card'
import { REVIEW_STATUSES } from '../../constants/statuses'

type Props = {
  data?: ReviewEventRow[]
  loading: boolean
  error: Error | null
}

export function ReviewPanel({ data, loading, error }: Props) {
  const qc = useQueryClient()
  const [appKey, setAppKey] = useState<string>('')
  const [status, setStatus] = useState<string>('application_confirmation')
  const [note, setNote] = useState('')

  const rows = data ?? []
  const selected = useMemo(() => rows.find((r) => r.app_key === appKey), [rows, appKey])

  const snippetQ = useQuery({
    queryKey: ['snippet', selected?.gmail_message_id],
    queryFn: () => apiGet<{ snippet: string }>(`/api/messages/${selected!.gmail_message_id}/snippet`),
    enabled: !!selected?.gmail_message_id,
  })

  const saveM = useMutation({
    mutationFn: () =>
      apiPost('/api/review', {
        app_key: appKey,
        decided_status: status,
        note: note || null,
        source_event_id: selected?.event_id ?? null,
        previous_status: selected?.status ?? null,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['review-events'] })
      void qc.invalidateQueries({ queryKey: ['applications'] })
      void qc.invalidateQueries({ queryKey: ['timeline'] })
    },
  })

  if (loading) return <p className="text-[var(--color-muted)]">Loading events…</p>
  if (error) return <p className="text-[var(--color-danger)]">{(error as Error).message}</p>
  if (rows.length === 0) {
    return (
      <Card>
        <p className="text-[var(--color-muted)]">No review events yet. Run a sync first.</p>
      </Card>
    )
  }

  const keys = [...new Set(rows.map((r) => r.app_key))]

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <h2 className="font-display text-lg font-semibold">Pick an application event</h2>
        <select
          value={appKey}
          onChange={(e) => {
            const k = e.target.value
            setAppKey(k)
            const r = rows.find((x) => x.app_key === k)
            if (r && (REVIEW_STATUSES as readonly string[]).includes(r.status)) {
              setStatus(r.status)
            } else {
              setStatus('other')
            }
          }}
          className="mt-4 w-full rounded-xl border border-[var(--color-border)] bg-black/25 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]/40"
        >
          <option value="">Select…</option>
          {keys.map((k) => {
            const r = rows.find((x) => x.app_key === k)
            return (
              <option key={k} value={k}>
                {k.slice(0, 72)}
                {k.length > 72 ? '…' : ''} — {r?.status}
              </option>
            )
          })}
        </select>
        {selected && (
          <dl className="mt-6 space-y-3 text-sm">
            <div className="flex justify-between gap-4 border-b border-[var(--color-border)]/60 py-2">
              <dt className="text-[var(--color-muted)]">Company</dt>
              <dd className="text-right font-medium">{selected.company ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-[var(--color-border)]/60 py-2">
              <dt className="text-[var(--color-muted)]">Role</dt>
              <dd className="text-right font-medium">{selected.job_title ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-[var(--color-border)]/60 py-2">
              <dt className="text-[var(--color-muted)]">Confidence</dt>
              <dd className="text-right font-mono">{selected.confidence ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-4 py-2">
              <dt className="text-[var(--color-muted)]">Model notes</dt>
              <dd className="max-w-[60%] text-right text-xs text-[var(--color-muted)]">{selected.notes ?? '—'}</dd>
            </div>
          </dl>
        )}
        {selected?.gmail_message_id && (
          <div className="mt-6">
            <p className="text-xs uppercase tracking-wide text-[var(--color-muted)]">Email snippet</p>
            {snippetQ.isLoading && <p className="mt-2 text-sm text-[var(--color-muted)]">Loading snippet…</p>}
            {snippetQ.data && (
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-xl bg-black/35 p-4 font-mono text-xs leading-relaxed text-[var(--color-muted)]">
                {snippetQ.data.snippet}
              </pre>
            )}
            {snippetQ.isError && (
              <p className="mt-2 text-xs text-[var(--color-danger)]">{(snippetQ.error as Error).message}</p>
            )}
          </div>
        )}
      </Card>
      <Card>
        <h2 className="font-display text-lg font-semibold">Human decision</h2>
        <label className="mt-6 block text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
          Status
        </label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          disabled={!selected}
          className="mt-2 w-full rounded-xl border border-[var(--color-border)] bg-black/25 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]/40 disabled:opacity-40"
        >
          {REVIEW_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <label className="mt-4 block text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
          Note (optional)
        </label>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={!selected}
          className="mt-2 w-full rounded-xl border border-[var(--color-border)] bg-black/25 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]/40 disabled:opacity-40"
        />
        <button
          type="button"
          disabled={!selected || saveM.isPending}
          onClick={() => saveM.mutate()}
          className="mt-8 w-full rounded-xl bg-[var(--color-accent)] px-4 py-3 text-sm font-semibold text-[#1a1408] disabled:opacity-40"
        >
          {saveM.isPending ? 'Saving…' : 'Save decision'}
        </button>
        {saveM.isSuccess && <p className="mt-4 text-sm text-[var(--color-ok)]">Saved to SQLite.</p>}
        {saveM.isError && <p className="mt-4 text-sm text-[var(--color-danger)]">{(saveM.error as Error).message}</p>}
      </Card>
    </div>
  )
}
