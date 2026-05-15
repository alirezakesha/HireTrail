import { useEffect, useMemo, useState } from 'react'
import type { ApplicationRow } from '../../api'
import {
  defaultKeptAppKey,
  defaultMergeFieldChoices,
  fieldValue,
  MERGE_FIELD_KEYS,
  MERGE_FIELD_LABELS,
  rowLabel,
  type MergeFieldKey,
  type MergeSide,
} from './mergeUtils'

export type MergeSubmitPayload = {
  app_key_a: string
  app_key_b: string
  kept_app_key: string
  field_choices: Record<string, string>
}

type Props = {
  rowA: ApplicationRow
  rowB: ApplicationRow
  submitting?: boolean
  onCancel: () => void
  onConfirm: (payload: MergeSubmitPayload) => void
}

export function MergeDialog({ rowA, rowB, submitting, onCancel, onConfirm }: Props) {
  const [keptKey, setKeptKey] = useState(() => defaultKeptAppKey(rowA, rowB))
  const [choices, setChoices] = useState(() => defaultMergeFieldChoices(rowA, rowB))

  useEffect(() => {
    setKeptKey(defaultKeptAppKey(rowA, rowB))
    setChoices(defaultMergeFieldChoices(rowA, rowB))
  }, [rowA.app_key, rowB.app_key, rowA, rowB])

  const preview = useMemo(() => {
    const pick = (field: MergeFieldKey) => (choices[field] === 'a' ? rowA : rowB)
    return {
      company: pick('company').company,
      job_title: pick('job_title').job_title,
      status: pick('status').status,
    }
  }, [choices, rowA, rowB])

  function setChoice(field: MergeFieldKey, side: MergeSide) {
    setChoices((c) => ({ ...c, [field]: side }))
  }

  function useSuggested() {
    setChoices(defaultMergeFieldChoices(rowA, rowB))
    setKeptKey(defaultKeptAppKey(rowA, rowB))
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="merge-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onCancel()
      }}
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="merge-dialog-title" className="font-display text-xl font-semibold text-[var(--color-ink)]">
          Merge applications
        </h2>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          Choose which record to keep and pick the best value per field. Suggestions favor the more complete text,
          earliest applied date, latest update, and higher pipeline status rank.
        </p>

        <fieldset className="mt-6 space-y-3">
          <legend className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            Keep this record
          </legend>
          <label className="flex cursor-pointer gap-3 rounded-xl border border-[var(--color-border)] p-3 has-checked:border-[var(--color-accent)]">
            <input
              type="radio"
              name="kept"
              checked={keptKey === rowA.app_key}
              disabled={submitting}
              onChange={() => setKeptKey(rowA.app_key)}
              className="mt-1"
            />
            <span className="min-w-0 flex-1">
              <span className="font-medium text-[var(--color-ink)]">{rowLabel(rowA)}</span>
              <span className="mt-0.5 block font-mono text-xs text-[var(--color-muted)]">{rowA.status}</span>
            </span>
          </label>
          <label className="flex cursor-pointer gap-3 rounded-xl border border-[var(--color-border)] p-3 has-checked:border-[var(--color-accent)]">
            <input
              type="radio"
              name="kept"
              checked={keptKey === rowB.app_key}
              disabled={submitting}
              onChange={() => setKeptKey(rowB.app_key)}
              className="mt-1"
            />
            <span className="min-w-0 flex-1">
              <span className="font-medium text-[var(--color-ink)]">{rowLabel(rowB)}</span>
              <span className="mt-0.5 block font-mono text-xs text-[var(--color-muted)]">{rowB.status}</span>
            </span>
          </label>
          <p className="text-xs text-[var(--color-muted)]">
            The other record will be deleted; its events move to the kept record.
          </p>
        </fieldset>

        <div className="mt-6 overflow-x-auto rounded-xl border border-[var(--color-border)]">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="bg-black/20 text-xs uppercase tracking-wide text-[var(--color-muted)]">
              <tr>
                <th className="px-3 py-2">Field</th>
                <th className="px-3 py-2">A</th>
                <th className="px-3 py-2">B</th>
              </tr>
            </thead>
            <tbody>
              {MERGE_FIELD_KEYS.map((field) => (
                <tr key={field} className="border-t border-[var(--color-border)]/60">
                  <td className="px-3 py-2 font-medium text-[var(--color-muted)]">{MERGE_FIELD_LABELS[field]}</td>
                  <td className="px-3 py-2">
                    <label className="flex cursor-pointer items-start gap-2">
                      <input
                        type="radio"
                        name={`field-${field}`}
                        checked={choices[field] === 'a'}
                        disabled={submitting}
                        onChange={() => setChoice(field, 'a')}
                        className="mt-1 shrink-0"
                      />
                      <span className="break-all font-mono text-xs text-[var(--color-ink)]">
                        {fieldValue(rowA, field)}
                      </span>
                    </label>
                  </td>
                  <td className="px-3 py-2">
                    <label className="flex cursor-pointer items-start gap-2">
                      <input
                        type="radio"
                        name={`field-${field}`}
                        checked={choices[field] === 'b'}
                        disabled={submitting}
                        onChange={() => setChoice(field, 'b')}
                        className="mt-1 shrink-0"
                      />
                      <span className="break-all font-mono text-xs text-[var(--color-ink)]">
                        {fieldValue(rowB, field)}
                      </span>
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-xs text-[var(--color-muted)]">
          Preview: {preview.company ?? '—'} · {preview.job_title ?? '—'} ·{' '}
          <span className="font-mono">{preview.status}</span>
        </p>

        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            disabled={submitting}
            onClick={useSuggested}
            className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-muted)] hover:text-[var(--color-ink)] disabled:opacity-50"
          >
            Reset to suggestions
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={onCancel}
            className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() =>
              onConfirm({
                app_key_a: rowA.app_key,
                app_key_b: rowB.app_key,
                kept_app_key: keptKey,
                field_choices: choices,
              })
            }
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-[#1a1408] disabled:opacity-50"
          >
            {submitting ? 'Merging…' : 'Merge'}
          </button>
        </div>
      </div>
    </div>
  )
}
