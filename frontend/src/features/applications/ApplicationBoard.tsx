import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { apiPost } from '../../api'
import { Card } from '../../components/ui/Card'
import { REVIEW_STATUSES } from '../../constants/statuses'
import type { EnrichedApplication } from '../../hooks/useEnrichedApplications'

function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  const d = s.slice(0, 10)
  return d.length === 10 ? d : s.slice(0, 16).replace('T', ' ')
}

type Props = {
  rows: EnrichedApplication[]
  loading: boolean
  error: Error | null
}

export function ApplicationBoard({ rows, loading, error }: Props) {
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [draft, setDraft] = useState<Record<string, string>>({})

  const statuses = useMemo(() => [...new Set(rows.map((r) => r.status))].sort(), [rows])

  const filtered = useMemo(() => {
    let v = rows
    const t = q.trim().toLowerCase()
    if (t) {
      v = v.filter(
        (r) =>
          (r.company ?? '').toLowerCase().includes(t) ||
          (r.job_title ?? '').toLowerCase().includes(t) ||
          (r.job_id ?? '').toLowerCase().includes(t) ||
          r.app_key.toLowerCase().includes(t),
      )
    }
    if (statusFilter !== 'all') v = v.filter((r) => r.status === statusFilter)
    return v
  }, [rows, q, statusFilter])

  const saveM = useMutation({
    mutationFn: (payload: { app_key: string; decided_status: string; previous_status: string }) =>
      apiPost('/api/review', {
        app_key: payload.app_key,
        decided_status: payload.decided_status,
        note: null,
        source_event_id: null,
        previous_status: payload.previous_status,
      }),
    onSuccess: (_data, variables) => {
      setDraft((prev) => {
        const next = { ...prev }
        delete next[variables.app_key]
        return next
      })
      void qc.invalidateQueries({ queryKey: ['applications'] })
      void qc.invalidateQueries({ queryKey: ['timeline'] })
      void qc.invalidateQueries({ queryKey: ['review-events'] })
    },
  })

  function statusForRow(r: EnrichedApplication) {
    return draft[r.app_key] ?? r.status
  }

  function setRowStatus(appKey: string, value: string) {
    setDraft((prev) => ({ ...prev, [appKey]: value }))
  }

  if (loading) return <p className="text-[var(--color-muted)]">Loading applications…</p>
  if (error) return <p className="text-[var(--color-danger)]">{(error as Error).message}</p>
  if (rows.length === 0) {
    return (
      <Card>
        <p className="text-[var(--color-muted)]">No applications yet. Run a sync from the Sync tab.</p>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="min-w-[200px] flex-1">
          <label className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
            Search
          </label>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Company, role, job ID…"
            className="mt-2 w-full rounded-xl border border-[var(--color-border)] bg-black/25 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]/40"
          />
        </div>
        <div className="min-w-[180px]">
          <label className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
            Status
          </label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="mt-2 w-full rounded-xl border border-[var(--color-border)] bg-black/25 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]/40"
          >
            <option value="all">All ({rows.length})</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {s} ({rows.filter((r) => r.status === s).length})
              </option>
            ))}
          </select>
        </div>
        <p className="text-sm text-[var(--color-muted)]">
          Showing <span className="font-medium text-[var(--color-ink)]">{filtered.length}</span> of {rows.length}
        </p>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((r) => {
          const applied = r.applied_date ?? r.last_update_date ?? r.last_email_date_raw
          const current = statusForRow(r)
          const dirty = current !== r.status
          return (
            <Card key={r.app_key} className="flex flex-col gap-4 p-5">
              <div>
                <h3 className="font-display text-lg font-semibold leading-snug text-[var(--color-ink)]">
                  {r.company ?? 'Unknown company'}
                </h3>
                <p className="mt-1 text-sm text-[var(--color-muted)]">{r.job_title ?? 'Role not specified'}</p>
              </div>

              <dl className="grid gap-2 text-xs">
                <div className="flex justify-between gap-2 border-b border-[var(--color-border)]/50 py-1.5">
                  <dt className="text-[var(--color-muted)]">Applied</dt>
                  <dd className="font-mono text-[var(--color-ink)]">{fmtDate(applied)}</dd>
                </div>
                <div className="flex justify-between gap-2 border-b border-[var(--color-border)]/50 py-1.5">
                  <dt className="text-[var(--color-muted)]">Rejected</dt>
                  <dd className="font-mono text-[var(--color-ink)]">{fmtDate(r.rejection_at)}</dd>
                </div>
                {r.interview_at && (
                  <div className="flex justify-between gap-2 border-b border-[var(--color-border)]/50 py-1.5">
                    <dt className="text-[var(--color-muted)]">Interview signal</dt>
                    <dd className="font-mono text-[var(--color-ink)]">{fmtDate(r.interview_at)}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-2 py-1.5">
                  <dt className="text-[var(--color-muted)]">Job ID</dt>
                  <dd className="max-w-[55%] truncate font-mono text-[var(--color-accent)]" title={r.job_id ?? ''}>
                    {r.job_id ?? '—'}
                  </dd>
                </div>
              </dl>

              <div className="mt-auto space-y-2">
                <label className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
                  Pipeline status
                </label>
                <select
                  value={current}
                  onChange={(e) => setRowStatus(r.app_key, e.target.value)}
                  className="w-full rounded-xl border border-[var(--color-border)] bg-black/25 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]/40"
                >
                  {[...new Set([...REVIEW_STATUSES, r.status, current])].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={
                    !dirty ||
                    (saveM.isPending &&
                      (saveM.variables as { app_key?: string } | undefined)?.app_key === r.app_key)
                  }
                  onClick={() =>
                    saveM.mutate({
                      app_key: r.app_key,
                      decided_status: current,
                      previous_status: r.status,
                    })
                  }
                  className="w-full rounded-xl bg-[var(--color-accent)] px-3 py-2 text-sm font-semibold text-[#1a1408] disabled:opacity-40"
                >
                  {saveM.isPending &&
                  (saveM.variables as { app_key?: string } | undefined)?.app_key === r.app_key
                    ? 'Saving…'
                    : dirty
                      ? 'Save status'
                      : 'Up to date'}
                </button>
              </div>
            </Card>
          )
        })}
      </div>

      {saveM.isError && (
        <Card className="border-[var(--color-danger)]/40 bg-[var(--color-danger)]/5">
          <p className="text-sm text-[var(--color-danger)]">{(saveM.error as Error).message}</p>
        </Card>
      )}
    </div>
  )
}
