import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import { apiPost } from '../../api'
import { Card } from '../../components/ui/Card'
import { REVIEW_STATUSES } from '../../constants/statuses'
import type { EnrichedApplication } from '../../hooks/useEnrichedApplications'

function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  const d = s.slice(0, 10)
  return d.length === 10 ? d : s.slice(0, 16).replace('T', ' ')
}

function parseTimeMs(iso: string | null | undefined): number {
  if (!iso) return 0
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : 0
}

function effectiveAppliedAt(r: { applied_date?: string | null; last_update_date: string | null; last_email_date_raw: string | null }) {
  return r.applied_date ?? r.last_update_date ?? r.last_email_date_raw
}

const DRAG_APP_KEY_MIME = 'application/x-applyledger-app-key'

function canMergePair(a: EnrichedApplication, b: EnrichedApplication) {
  const s = new Set([a.status, b.status])
  return s.has('rejection') && s.has('application_confirmation')
}

function isMergeParticipant(r: EnrichedApplication) {
  return r.status === 'rejection' || r.status === 'application_confirmation'
}

export const APPLICATION_SORT_MODES = [
  { id: 'updated_desc', label: 'Latest updated first' },
  { id: 'updated_asc', label: 'Oldest updated first' },
  { id: 'applied_desc', label: 'Latest applied first' },
  { id: 'applied_asc', label: 'Oldest applied first' },
  { id: 'company_asc', label: 'Company A–Z' },
] as const

export type ApplicationSortMode = (typeof APPLICATION_SORT_MODES)[number]['id']

type Props = {
  rows: EnrichedApplication[]
  loading: boolean
  error: Error | null
}

export function ApplicationBoard({ rows, loading, error }: Props) {
  const qc = useQueryClient()
  const dragSourceKeyRef = useRef<string | null>(null)
  const [dropHighlightKey, setDropHighlightKey] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [sortMode, setSortMode] = useState<ApplicationSortMode>('updated_desc')
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

  const sorted = useMemo(() => {
    const v = [...filtered]
    switch (sortMode) {
      case 'updated_desc':
        v.sort((a, b) => parseTimeMs(b.updated_at) - parseTimeMs(a.updated_at))
        break
      case 'updated_asc':
        v.sort((a, b) => parseTimeMs(a.updated_at) - parseTimeMs(b.updated_at))
        break
      case 'applied_desc':
        v.sort(
          (a, b) =>
            parseTimeMs(effectiveAppliedAt(b)) - parseTimeMs(effectiveAppliedAt(a)),
        )
        break
      case 'applied_asc':
        v.sort(
          (a, b) =>
            parseTimeMs(effectiveAppliedAt(a)) - parseTimeMs(effectiveAppliedAt(b)),
        )
        break
      case 'company_asc':
        v.sort((a, b) =>
          (a.company ?? '').localeCompare(b.company ?? '', undefined, { sensitivity: 'base' }),
        )
        break
      default:
        break
    }
    return v
  }, [filtered, sortMode])

  const rowByKey = useMemo(() => new Map(rows.map((r) => [r.app_key, r])), [rows])

  const mergeM = useMutation({
    mutationFn: (payload: { app_key_a: string; app_key_b: string }) =>
      apiPost<{ kept_app_key: string; removed_app_key: string }>('/api/applications/merge', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['applications'] })
      void qc.invalidateQueries({ queryKey: ['timeline'] })
    },
  })

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
        <div className="min-w-[200px] sm:min-w-[220px]">
          <label className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
            Sort by
          </label>
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as ApplicationSortMode)}
            className="mt-2 w-full rounded-xl border border-[var(--color-border)] bg-black/25 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]/40"
          >
            {APPLICATION_SORT_MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <p className="text-sm text-[var(--color-muted)]">
          Showing <span className="font-medium text-[var(--color-ink)]">{sorted.length}</span> of {rows.length}
        </p>
        <p className="w-full text-xs leading-relaxed text-[var(--color-muted)] sm:col-span-2 xl:col-span-4">
          <span className="font-medium text-[var(--color-ink)]">Merge:</span> drag one card onto another only when one row is saved as{' '}
          <span className="font-mono text-[var(--color-accent)]">rejection</span> and the other as{' '}
          <span className="font-mono text-[var(--color-accent)]">application_confirmation</span> (exact status strings from the
          database). The confirmation row is kept and updated; the rejection row is removed. Pairs like two rejections,
          two confirmations, or interview/follow_up cannot merge. Unsaved status changes in the dropdown are not
          used—save first, or merge using the current stored statuses.
        </p>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {sorted.map((r) => {
          const applied = effectiveAppliedAt(r)
          const current = statusForRow(r)
          const dirty = current !== r.status
          const draggableMerge = isMergeParticipant(r)
          const fromKey = dragSourceKeyRef.current
          const targetKey = r.app_key
          const pairOk =
            !!fromKey &&
            fromKey !== targetKey &&
            (() => {
              const a = rowByKey.get(fromKey)
              const b = rowByKey.get(targetKey)
              return !!(a && b && canMergePair(a, b))
            })()

          return (
            <Card
              key={r.app_key}
              draggable={draggableMerge}
              onDragStart={(e) => {
                if (!draggableMerge) return
                dragSourceKeyRef.current = r.app_key
                e.dataTransfer.setData(DRAG_APP_KEY_MIME, r.app_key)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragEnd={() => {
                dragSourceKeyRef.current = null
                setDropHighlightKey(null)
              }}
              onDragOver={(e) => {
                if (!dragSourceKeyRef.current || dragSourceKeyRef.current === targetKey) return
                const a = rowByKey.get(dragSourceKeyRef.current)
                const b = rowByKey.get(targetKey)
                if (a && b && canMergePair(a, b)) {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  setDropHighlightKey((h) => (h === targetKey ? h : targetKey))
                }
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setDropHighlightKey((h) => (h === targetKey ? null : h))
                }
              }}
              onDrop={(e) => {
                e.preventDefault()
                const dragged =
                  e.dataTransfer.getData(DRAG_APP_KEY_MIME) || dragSourceKeyRef.current || ''
                dragSourceKeyRef.current = null
                setDropHighlightKey(null)
                if (!dragged || dragged === targetKey) return
                const a = rowByKey.get(dragged)
                const b = rowByKey.get(targetKey)
                if (!a || !b || !canMergePair(a, b)) return
                const conf = a.status === 'application_confirmation' ? a : b
                const rej = a.status === 'rejection' ? a : b
                const msg = `Merge rejection "${rej.company ?? rej.app_key}" into application "${conf.company ?? conf.app_key}"? The rejection row will be deleted.`
                if (!window.confirm(msg)) return
                mergeM.mutate({ app_key_a: dragged, app_key_b: targetKey })
              }}
              className={`flex flex-col gap-4 p-5 transition-shadow ${
                draggableMerge ? 'cursor-grab active:cursor-grabbing' : ''
              } ${dropHighlightKey === r.app_key && pairOk ? 'ring-2 ring-[var(--color-accent)] ring-offset-2 ring-offset-[var(--color-surface)]' : ''}`}
            >
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

      {mergeM.isError && (
        <Card className="border-[var(--color-danger)]/40 bg-[var(--color-danger)]/5">
          <p className="text-sm text-[var(--color-danger)]">{(mergeM.error as Error).message}</p>
        </Card>
      )}

      {saveM.isError && (
        <Card className="border-[var(--color-danger)]/40 bg-[var(--color-danger)]/5">
          <p className="text-sm text-[var(--color-danger)]">{(saveM.error as Error).message}</p>
        </Card>
      )}
    </div>
  )
}
