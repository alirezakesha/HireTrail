import { useMutation } from '@tanstack/react-query'
import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { apiPost, type TimelineRow } from '../../api'
import { Card } from '../../components/ui/Card'
import { TIMELINE_OUTCOMES } from '../../constants/statuses'

const TimelineChart = lazy(async () => {
  const m = await import('../../components/TimelineChart')
  return { default: m.TimelineChart }
})

const EMPTY_TIMELINE_ROWS: TimelineRow[] = []

type Props = {
  rows?: TimelineRow[]
  loading: boolean
  error: Error | null
  onSaved: () => void
}

export function TimelinePanel({ rows, loading, error, onSaved }: Props) {
  const [outcomeFilter, setOutcomeFilter] = useState<string[]>([])
  const [labelQ, setLabelQ] = useState('')
  const [edits, setEdits] = useState<Record<string, string>>({})

  const baseRows = useMemo(() => rows ?? EMPTY_TIMELINE_ROWS, [rows])
  const outcomesInData = useMemo(() => [...new Set(baseRows.map((r) => r.outcome))].sort(), [baseRows])

  useEffect(() => {
    if (baseRows.length === 0) {
      setOutcomeFilter((p) => (p.length === 0 ? p : []))
      return
    }
    const allOutcomes = [...new Set(baseRows.map((r) => r.outcome))].sort()
    setOutcomeFilter((prev) => {
      const initial = prev.length === 0 ? allOutcomes : prev
      const next = initial.filter((o) => allOutcomes.includes(o))
      const resolved = next.length > 0 ? next : allOutcomes
      if (prev.length === resolved.length && prev.every((v, i) => resolved[i] === v)) {
        return prev
      }
      return resolved
    })
  }, [baseRows])

  const filtered = useMemo(() => {
    let v = baseRows.filter((r) => outcomeFilter.length === 0 || outcomeFilter.includes(r.outcome))
    const q = labelQ.trim().toLowerCase()
    if (q) v = v.filter((r) => (r.label ?? '').toLowerCase().includes(q))
    return v
  }, [baseRows, outcomeFilter, labelQ])

  const maxEdit = 50
  const editSlice = filtered.slice(0, maxEdit)

  const saveM = useMutation({
    mutationFn: (updates: { app_key: string; outcome: string }[]) =>
      apiPost<{ changed: number }>('/api/timeline/outcomes', { updates }),
    onSuccess: () => {
      onSaved()
      setEdits({})
    },
  })

  if (loading) return <p className="text-[var(--color-muted)]">Loading timeline…</p>
  if (error) return <p className="text-[var(--color-danger)]">{(error as Error).message}</p>

  function outcomeFor(appKey: string, original: string) {
    return edits[appKey] ?? original
  }

  function saveOutcomes() {
    const updates: { app_key: string; outcome: string }[] = []
    for (const r of editSlice) {
      const next = outcomeFor(r.app_key, r.outcome)
      if (next !== r.outcome) updates.push({ app_key: r.app_key, outcome: next })
    }
    if (updates.length === 0) return
    saveM.mutate(updates)
  }

  return (
    <div className="space-y-6">
      <Card className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="min-w-[200px] flex-1">
          <label className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
            Outcomes
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            {outcomesInData.map((o) => {
              const on = outcomeFilter.includes(o)
              return (
                <button
                  key={o}
                  type="button"
                  onClick={() =>
                    setOutcomeFilter((prev) => (on ? prev.filter((x) => x !== o) : [...prev, o]))
                  }
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                    on
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-[var(--color-ink)]'
                      : 'border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-muted)]'
                  }`}
                >
                  {o}
                </button>
              )
            })}
          </div>
        </div>
        <div className="min-w-[200px] flex-1">
          <label className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
            Filter label
          </label>
          <input
            value={labelQ}
            onChange={(e) => setLabelQ(e.target.value)}
            placeholder="company or role…"
            className="mt-2 w-full rounded-xl border border-[var(--color-border)] bg-black/25 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]/40"
          />
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card>
          <p className="text-[var(--color-muted)]">No rows match the current filters.</p>
        </Card>
      ) : (
        <Suspense
          fallback={
            <p className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-12 text-center text-[var(--color-muted)]">
              Loading chart…
            </p>
          }
        >
          <TimelineChart rows={filtered} />
        </Suspense>
      )}

      <Card>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold">Bulk outcome edits</h2>
            <p className="mt-1 text-xs text-[var(--color-muted)]">
              Showing first {maxEdit} filtered rows. Narrow filters to reach the rest.
            </p>
          </div>
          <button
            type="button"
            disabled={saveM.isPending || filtered.length === 0}
            onClick={saveOutcomes}
            className="rounded-xl bg-[var(--color-accent)] px-5 py-2.5 text-sm font-semibold text-[#1a1408] disabled:opacity-40"
          >
            {saveM.isPending ? 'Saving…' : 'Save outcome changes'}
          </button>
        </div>
        {saveM.isSuccess && (
          <p className="mt-4 text-sm text-[var(--color-ok)]">Updated {saveM.data.changed} application(s).</p>
        )}
        {saveM.isError && <p className="mt-4 text-sm text-[var(--color-danger)]">{(saveM.error as Error).message}</p>}
        <ul className="mt-6 max-h-[480px] space-y-3 overflow-y-auto pr-1">
          {editSlice.map((r) => (
            <li
              key={r.app_key}
              className="flex flex-col gap-2 rounded-xl border border-[var(--color-border)]/80 bg-black/20 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <p className="text-sm font-medium text-[var(--color-ink)]">{r.label}</p>
              <select
                value={outcomeFor(r.app_key, r.outcome)}
                onChange={(e) => setEdits((prev) => ({ ...prev, [r.app_key]: e.target.value }))}
                className="max-w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm sm:w-72"
              >
                {TIMELINE_OUTCOMES.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
