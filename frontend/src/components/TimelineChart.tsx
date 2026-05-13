import { useMemo } from 'react'
import type { TimelineRow } from '../api'

const OUTCOME_COLOR: Record<string, string> = {
  Rejected: 'rgba(248, 113, 113, 0.9)',
  'Interview (no rejection logged)': 'rgba(96, 165, 250, 0.9)',
  'Open / pending': 'rgba(148, 163, 184, 0.85)',
}

function parseTimeMs(v: string | null | undefined): number | null {
  if (v == null || v === '') return null
  const t = Date.parse(String(v))
  return Number.isFinite(t) ? t : null
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toISOString().slice(0, 16).replace('T', ' ')
}

type Item = {
  row: TimelineRow
  startMs: number
  endMs: number
}

export function TimelineChart({ rows }: { rows: TimelineRow[] }) {
  const { minMs, maxMs, items } = useMemo(() => {
    const itemsAcc: Item[] = []
    let minT = Infinity
    let maxT = -Infinity
    for (const r of rows) {
      const s = parseTimeMs(r.start)
      const e = parseTimeMs(r.end) ?? s
      if (s == null) continue
      const end = e ?? s
      minT = Math.min(minT, s, end)
      maxT = Math.max(maxT, s, end)
      itemsAcc.push({ row: r, startMs: s, endMs: end })
    }
    if (!Number.isFinite(minT) || itemsAcc.length === 0) {
      return { minMs: 0, maxMs: 1, items: [] as Item[] }
    }
    const pad = Math.max((maxT - minT) * 0.03, 86_400_000)
    return { minMs: minT - pad, maxMs: maxT + pad, items: itemsAcc }
  }, [rows])

  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-8 text-center text-[var(--color-muted)]">
        No rows with valid start/end dates to plot.
      </p>
    )
  }

  const span = Math.max(maxMs - minMs, 1)

  return (
    <div className="w-full space-y-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)]/80 p-4">
      <div className="mb-3 flex justify-between font-mono text-[10px] text-[var(--color-muted)]">
        <span>{fmtDate(new Date(minMs).toISOString())}</span>
        <span>{fmtDate(new Date(maxMs).toISOString())}</span>
      </div>
      <ul className="max-h-[min(70vh,520px)] space-y-2 overflow-y-auto pr-1">
        {items.map(({ row, startMs, endMs }) => {
          const left = ((startMs - minMs) / span) * 100
          const width = Math.max(((endMs - startMs) / span) * 100, 0.8)
          const color = OUTCOME_COLOR[row.outcome] ?? 'rgba(232, 184, 74, 0.75)'
          return (
            <li key={row.app_key} className="grid grid-cols-[minmax(0,1fr)_minmax(120px,42%)] items-center gap-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium text-[var(--color-ink)]" title={row.label}>
                  {row.label}
                </p>
                <p className="truncate text-xs text-[var(--color-muted)]">
                  {row.outcome}
                  {row.rejection_at ? ` · rejected ${fmtDate(row.rejection_at)}` : ''}
                </p>
              </div>
              <div className="relative h-7 rounded-md bg-black/30">
                <span
                  className="absolute top-1 bottom-1 rounded shadow-sm"
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    background: color,
                    minWidth: 4,
                  }}
                  title={`${fmtDate(row.start)} → ${fmtDate(row.end)}`}
                />
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
