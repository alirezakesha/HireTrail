import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Fragment, useMemo, useState } from 'react'
import {
  apiDelete,
  apiGet,
  apiPatch,
  type DbTableMeta,
  type DbTableRowItem,
  type DbTableRowsResponse,
} from '../../api'
import { Card } from '../../components/ui/Card'

const TABLE_NAMES = ['emails', 'processed_messages', 'applications', 'app_events', 'human_reviews'] as const
type TableName = (typeof TABLE_NAMES)[number]

function fmtEmailSent(ms: number, label: string | null) {
  if (label) return label.length > 24 ? `${label.slice(0, 24)}…` : label
  if (ms > 0) return new Date(ms).toISOString().slice(0, 16).replace('T', ' ')
  return '—'
}

function cellPreview(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  const s = String(v)
  return s.length > 120 ? `${s.slice(0, 120)}…` : s
}

type RowDraft = Record<string, string>

function rowKey(item: DbTableRowItem) {
  return String(item.pk)
}

export function TablesPanel() {
  const qc = useQueryClient()
  const [table, setTable] = useState<TableName>('emails')
  const [page, setPage] = useState(0)
  const [expandedPk, setExpandedPk] = useState<string | null>(null)
  const [draft, setDraft] = useState<RowDraft>({})
  const limit = 50

  const metaQ = useQuery({
    queryKey: ['db-tables-meta'],
    queryFn: () => apiGet<DbTableMeta[]>('/api/db/tables'),
  })

  const rowsQ = useQuery({
    queryKey: ['db-table-rows', table, page],
    queryFn: () =>
      apiGet<DbTableRowsResponse>(
        `/api/db/tables/${table}?limit=${limit}&offset=${page * limit}`,
      ),
  })

  const patchM = useMutation({
    mutationFn: (args: { pk: string | number; fields: Record<string, unknown> }) =>
      apiPatch<{ updated: string[] }>(`/api/db/tables/${table}`, { pk: args.pk, fields: args.fields }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['db-table-rows', table] })
      void qc.invalidateQueries({ queryKey: ['db-tables-meta'] })
      void qc.invalidateQueries({ queryKey: ['applications'] })
      void qc.invalidateQueries({ queryKey: ['timeline'] })
      setDraft({})
      setExpandedPk(null)
    },
  })

  const deleteM = useMutation({
    mutationFn: (pk: string | number) =>
      apiDelete<{ deleted: boolean }>(`/api/db/tables/${table}`, { pk }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['db-table-rows', table] })
      void qc.invalidateQueries({ queryKey: ['db-tables-meta'] })
      void qc.invalidateQueries({ queryKey: ['applications'] })
      void qc.invalidateQueries({ queryKey: ['timeline'] })
      setExpandedPk(null)
      setDraft({})
    },
  })

  const immutable = useMemo(
    () => new Set(rowsQ.data?.immutable_columns ?? []),
    [rowsQ.data?.immutable_columns],
  )

  const pkCol = rowsQ.data?.primary_key ?? 'pk'
  const total = rowsQ.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / limit))

  const onTableChange = (t: TableName) => {
    setTable(t)
    setPage(0)
    setExpandedPk(null)
    setDraft({})
  }

  const startEdit = (item: DbTableRowItem) => {
    const key = rowKey(item)
    setExpandedPk(key)
    const next: RowDraft = {}
    for (const col of rowsQ.data?.columns ?? []) {
      if (col === pkCol || immutable.has(col)) continue
      const v = item.data[col]
      next[col] = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
    }
    setDraft(next)
  }

  const saveEdit = (item: DbTableRowItem) => {
    const fields: Record<string, unknown> = {}
    for (const [col, raw] of Object.entries(draft)) {
      const orig = item.data[col]
      const origStr =
        orig === null || orig === undefined
          ? ''
          : typeof orig === 'object'
            ? JSON.stringify(orig)
            : String(orig)
      if (raw !== origStr) fields[col] = raw === '' ? null : raw
    }
    if (Object.keys(fields).length === 0) return
    patchM.mutate({ pk: item.pk, fields })
  }

  const err = metaQ.error ?? rowsQ.error
  const busy = patchM.isPending || deleteM.isPending

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="font-display text-lg font-semibold text-[var(--color-ink)]">Database tables</h2>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          Rows are sorted by when the related Gmail message was sent (newest first). Expand a row to edit
          fields or delete it. Deleting an application also removes its events and reviews.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {TABLE_NAMES.map((t) => {
            const count = metaQ.data?.find((m) => m.name === t)?.row_count
            return (
              <button
                key={t}
                type="button"
                onClick={() => onTableChange(t)}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                  table === t
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-[var(--color-ink)]'
                    : 'border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                }`}
              >
                {t}
                {count !== undefined ? (
                  <span className="ml-1.5 text-xs opacity-70">({count})</span>
                ) : null}
              </button>
            )
          })}
        </div>
      </Card>

      {err ? (
        <p className="text-sm text-[var(--color-danger)]">{err.message}</p>
      ) : null}

      <Card className="overflow-x-auto p-0">
        {rowsQ.isLoading ? (
          <p className="p-6 text-sm text-[var(--color-muted)]">Loading…</p>
        ) : (
          <>
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface)]/80">
                  <th className="px-4 py-3 font-medium text-[var(--color-muted)]">Email sent</th>
                  <th className="px-4 py-3 font-medium text-[var(--color-muted)]">{pkCol}</th>
                  {(rowsQ.data?.columns ?? [])
                    .filter((c) => c !== pkCol)
                    .slice(0, 4)
                    .map((c) => (
                      <th key={c} className="px-4 py-3 font-medium text-[var(--color-muted)]">
                        {c}
                      </th>
                    ))}
                  <th className="px-4 py-3 font-medium text-[var(--color-muted)]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(rowsQ.data?.rows ?? []).map((item) => {
                  const key = rowKey(item)
                  const open = expandedPk === key
                  const previewCols = (rowsQ.data?.columns ?? []).filter((c) => c !== pkCol).slice(0, 4)
                  return (
                    <Fragment key={key}>
                      <tr
                        className="border-b border-[var(--color-border)]/60 hover:bg-[var(--color-surface)]/40"
                      >
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-[var(--color-accent-dim)]">
                          {fmtEmailSent(item.email_sent_ms, item.email_sent_label)}
                        </td>
                        <td className="max-w-[140px] truncate px-4 py-3 font-mono text-xs" title={String(item.pk)}>
                          {String(item.pk)}
                        </td>
                        {previewCols.map((col) => (
                          <td key={col} className="max-w-[180px] truncate px-4 py-3 text-[var(--color-muted)]">
                            {cellPreview(item.data[col])}
                          </td>
                        ))}
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => (open ? setExpandedPk(null) : startEdit(item))}
                            className="text-xs font-medium text-[var(--color-accent)] hover:underline"
                          >
                            {open ? 'Close' : 'Edit'}
                          </button>
                        </td>
                      </tr>
                      {open ? (
                        <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface)]/50">
                          <td colSpan={previewCols.length + 3} className="px-4 py-4">
                            <div className="grid gap-3 sm:grid-cols-2">
                              {(rowsQ.data?.columns ?? []).map((col) => {
                                const readOnly = col === pkCol || immutable.has(col)
                                return (
                                  <label key={col} className="block text-xs">
                                    <span className="font-medium text-[var(--color-muted)]">{col}</span>
                                    {readOnly ? (
                                      <pre className="mt-1 max-h-24 overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2 font-mono text-[11px] text-[var(--color-ink)]">
                                        {cellPreview(item.data[col]) || '—'}
                                      </pre>
                                    ) : (
                                      <textarea
                                        rows={col === 'body_text' || col === 'snippet' || col === 'raw_json' ? 4 : 1}
                                        className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 font-mono text-[11px] text-[var(--color-ink)]"
                                        value={draft[col] ?? ''}
                                        onChange={(e) => setDraft((d) => ({ ...d, [col]: e.target.value }))}
                                      />
                                    )}
                                  </label>
                                )
                              })}
                            </div>
                            <div className="mt-4 flex flex-wrap gap-3">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => saveEdit(item)}
                                className="rounded-lg bg-[var(--color-accent)]/20 px-3 py-1.5 text-xs font-semibold text-[var(--color-ink)] hover:bg-[var(--color-accent)]/30"
                              >
                                Save changes
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                  if (!window.confirm(`Delete this row from ${table}?`)) return
                                  deleteM.mutate(item.pk)
                                }}
                                className="rounded-lg border border-[var(--color-danger)]/40 px-3 py-1.5 text-xs font-medium text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10"
                              >
                                Delete row
                              </button>
                              {(patchM.error || deleteM.error) && (
                                <span className="text-xs text-[var(--color-danger)]">
                                  {(patchM.error ?? deleteM.error)?.message}
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
            {rowsQ.data && rowsQ.data.rows.length === 0 ? (
              <p className="p-6 text-sm text-[var(--color-muted)]">No rows in this table.</p>
            ) : null}
          </>
        )}
        <div className="flex items-center justify-between border-t border-[var(--color-border)] px-4 py-3 text-xs text-[var(--color-muted)]">
          <span>
            {total} row{total === 1 ? '' : 's'} · page {page + 1} of {pageCount}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 0 || rowsQ.isLoading}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="rounded border border-[var(--color-border)] px-2 py-1 hover:text-[var(--color-ink)] disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page + 1 >= pageCount || rowsQ.isLoading}
              onClick={() => setPage((p) => p + 1)}
              className="rounded border border-[var(--color-border)] px-2 py-1 hover:text-[var(--color-ink)] disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </Card>
    </div>
  )
}
