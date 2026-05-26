import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { apiGet, apiPatch, type ApplicationRow } from '../../api'
import { REVIEW_STATUSES } from '../../constants/statuses'
import type { EnrichedApplication } from '../../hooks/useEnrichedApplications'
import { fmtDate } from './applicationDisplay'

export type ApplicationDetailResponse = {
  application: ApplicationRow & {
    source?: string | null
    last_email_message_id?: string | null
    created_at?: string | null
    rejection_at?: string | null
    interview_at?: string | null
  }
  events: {
    id: number
    event_type: string
    event_date: string | null
    gmail_message_id: string | null
    raw_json: string | null
    created_at: string
    status: string
  }[]
  last_email: {
    gmail_message_id: string
    subject: string | null
    from_addr: string | null
    to_addr: string | null
    date_raw: string | null
    snippet: string | null
    internal_date_ms: number | null
  } | null
}

type FormState = {
  company: string
  job_title: string
  job_id: string
  notes: string
  applied_date: string
  status: string
}

type Props = {
  row: EnrichedApplication
  onClose: () => void
}

function toForm(row: EnrichedApplication): FormState {
  return {
    company: row.company ?? '',
    job_title: row.job_title ?? '',
    job_id: row.job_id ?? '',
    notes: row.notes ?? '',
    applied_date: row.applied_date ?? '',
    status: row.status,
  }
}

export function ApplicationDetailDialog({ row, onClose }: Props) {
  const qc = useQueryClient()
  const [form, setForm] = useState<FormState>(() => toForm(row))
  const [snippetEventId, setSnippetEventId] = useState<string | null>(null)

  const detailQ = useQuery({
    queryKey: ['application-detail', row.app_key],
    queryFn: () => apiGet<ApplicationDetailResponse>(`/api/applications/${encodeURIComponent(row.app_key)}`),
  })

  const snippetQ = useQuery({
    queryKey: ['message-snippet', snippetEventId],
    queryFn: () => apiGet<{ snippet: string }>(`/api/messages/${encodeURIComponent(snippetEventId!)}/snippet`),
    enabled: !!snippetEventId,
  })

  useEffect(() => {
    const app = detailQ.data?.application
    if (!app) return
    setForm({
      company: app.company ?? '',
      job_title: app.job_title ?? '',
      job_id: app.job_id ?? '',
      notes: app.notes ?? '',
      applied_date: app.applied_date ?? '',
      status: app.status,
    })
  }, [detailQ.data?.application])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const saveM = useMutation({
    mutationFn: async () => {
      const app = detailQ.data?.application ?? row
      const body: Record<string, string | null> = {}
      if (form.company !== (app.company ?? '')) body.company = form.company
      if (form.job_title !== (app.job_title ?? '')) body.job_title = form.job_title
      if (form.job_id !== (app.job_id ?? '')) body.job_id = form.job_id
      if (form.notes !== (app.notes ?? '')) body.notes = form.notes
      if (form.applied_date !== (app.applied_date ?? '')) body.applied_date = form.applied_date || null
      if (form.status !== app.status) {
        body.status = form.status
        body.status_note = 'edited in application detail'
      }
      if (Object.keys(body).length === 0) return { ok: 'true' }
      return apiPatch<{ ok: string }>(`/api/applications/${encodeURIComponent(row.app_key)}`, body)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['applications'] })
      void qc.invalidateQueries({ queryKey: ['timeline'], refetchType: 'all' })
      void qc.invalidateQueries({ queryKey: ['application-detail', row.app_key] })
      onClose()
    },
  })

  const app = detailQ.data?.application ?? row
  const events = detailQ.data?.events ?? []
  const lastEmail = detailQ.data?.last_email
  const dirty =
    form.company !== (app.company ?? '') ||
    form.job_title !== (app.job_title ?? '') ||
    form.job_id !== (app.job_id ?? '') ||
    form.notes !== (app.notes ?? '') ||
    form.applied_date !== (app.applied_date ?? '') ||
    form.status !== app.status

  const inputClass =
    'mt-1 w-full rounded-xl border border-[var(--color-border)] bg-black/25 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]/40'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="app-detail-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saveM.isPending) onClose()
      }}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] px-6 py-5">
          <div>
            <h2 id="app-detail-title" className="font-display text-xl font-semibold text-[var(--color-ink)]">
              {form.company || 'Unknown company'}
            </h2>
            <p className="mt-1 text-sm text-[var(--color-muted)]">{form.job_title || 'Role not specified'}</p>
            <p className="mt-2 font-mono text-xs text-[var(--color-accent-dim)]">{row.app_key}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saveM.isPending}
            className="shrink-0 rounded-lg px-2 py-1 text-sm text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {detailQ.isLoading && (
            <p className="text-sm text-[var(--color-muted)]">Loading details…</p>
          )}
          {detailQ.isError && (
            <p className="text-sm text-[var(--color-danger)]">{(detailQ.error as Error).message}</p>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">Edit</h3>
              <label className="block text-xs text-[var(--color-muted)]">
                Company
                <input
                  className={inputClass}
                  value={form.company}
                  onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
                />
              </label>
              <label className="block text-xs text-[var(--color-muted)]">
                Job title
                <input
                  className={inputClass}
                  value={form.job_title}
                  onChange={(e) => setForm((f) => ({ ...f, job_title: e.target.value }))}
                />
              </label>
              <label className="block text-xs text-[var(--color-muted)]">
                Job ID
                <input
                  className={inputClass}
                  value={form.job_id}
                  onChange={(e) => setForm((f) => ({ ...f, job_id: e.target.value }))}
                />
              </label>
              <label className="block text-xs text-[var(--color-muted)]">
                Applied date
                <input
                  className={inputClass}
                  value={form.applied_date}
                  placeholder="ISO date or email date string"
                  onChange={(e) => setForm((f) => ({ ...f, applied_date: e.target.value }))}
                />
              </label>
              <label className="block text-xs text-[var(--color-muted)]">
                Pipeline status
                <select
                  className={inputClass}
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                >
                  {[...new Set([...REVIEW_STATUSES, app.status, form.status])].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-[var(--color-muted)]">
                Notes
                <textarea
                  rows={4}
                  className={inputClass}
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </label>
            </section>

            <section className="space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                Summary
              </h3>
              <dl className="grid gap-2 text-xs">
                {[
                  ['Applied', fmtDate(app.applied_date)],
                  ['Rejected', fmtDate(app.rejection_at ?? row.rejection_at)],
                  ['Interview', fmtDate(app.interview_at ?? row.interview_at)],
                  ['Last update', fmtDate(app.last_update_date)],
                  ['Last email', fmtDate(app.last_email_date_raw)],
                  ['Confidence', app.confidence != null ? String(app.confidence) : '—'],
                  ['Updated', fmtDate(app.updated_at)],
                  ['Created', fmtDate('created_at' in app ? app.created_at : null)],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="flex justify-between gap-2 border-b border-[var(--color-border)]/50 py-1.5"
                  >
                    <dt className="text-[var(--color-muted)]">{label}</dt>
                    <dd className="font-mono text-[var(--color-ink)]">{value}</dd>
                  </div>
                ))}
              </dl>

              {lastEmail && (
                <div className="rounded-xl border border-[var(--color-border)] bg-black/20 p-3 text-xs">
                  <p className="font-medium text-[var(--color-ink)]">Latest stored email</p>
                  <p className="mt-1 text-[var(--color-muted)]">{lastEmail.subject ?? '(no subject)'}</p>
                  <p className="mt-1 text-[var(--color-muted)]">{lastEmail.from_addr}</p>
                  <p className="mt-1 font-mono text-[var(--color-accent-dim)]">{lastEmail.date_raw}</p>
                  {lastEmail.snippet && (
                    <p className="mt-2 leading-relaxed text-[var(--color-muted)]">{lastEmail.snippet}</p>
                  )}
                </div>
              )}

              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                  Event history ({events.length})
                </h3>
                <ul className="mt-2 max-h-48 space-y-2 overflow-y-auto text-xs">
                  {events.length === 0 ? (
                    <li className="text-[var(--color-muted)]">No events recorded.</li>
                  ) : (
                    events.map((ev) => (
                      <li
                        key={ev.id}
                        className="rounded-lg border border-[var(--color-border)]/60 bg-black/20 px-3 py-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium text-[var(--color-ink)]">{ev.status}</span>
                          <span className="font-mono text-[var(--color-muted)]">{fmtDate(ev.event_date)}</span>
                        </div>
                        {ev.gmail_message_id && (
                          <button
                            type="button"
                            className="mt-1 text-[var(--color-accent)] hover:underline"
                            onClick={() =>
                              setSnippetEventId((id) =>
                                id === ev.gmail_message_id ? null : ev.gmail_message_id,
                              )
                            }
                          >
                            {snippetEventId === ev.gmail_message_id ? 'Hide snippet' : 'View snippet'}
                          </button>
                        )}
                      </li>
                    ))
                  )}
                </ul>
                {snippetQ.isFetching && (
                  <p className="mt-2 text-xs text-[var(--color-muted)]">Loading snippet…</p>
                )}
                {snippetQ.data?.snippet && (
                  <pre className="mt-2 max-h-32 overflow-auto rounded-lg bg-black/30 p-3 font-mono text-[11px] text-[var(--color-muted)]">
                    {snippetQ.data.snippet}
                  </pre>
                )}
                {snippetQ.isError && (
                  <p className="mt-2 text-xs text-[var(--color-danger)]">
                    {(snippetQ.error as Error).message}
                  </p>
                )}
              </div>
            </section>
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-3 border-t border-[var(--color-border)] px-6 py-4">
          {saveM.isError && (
            <p className="mr-auto text-sm text-[var(--color-danger)]">{(saveM.error as Error).message}</p>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={saveM.isPending}
            className="rounded-xl border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-muted)] hover:text-[var(--color-ink)]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!dirty || saveM.isPending}
            onClick={() => saveM.mutate()}
            className="rounded-xl bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-[#1a1408] disabled:opacity-40"
          >
            {saveM.isPending ? 'Saving…' : dirty ? 'Save changes' : 'No changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
