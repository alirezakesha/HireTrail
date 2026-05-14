import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiPost, type EmbeddingMergeSuggestionsResponse } from '../../api'
import { Card } from '../../components/ui/Card'

const ANALYZE_MS = 120_000

function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  const d = s.slice(0, 10)
  return d.length === 10 ? d : s.slice(0, 16).replace('T', ' ')
}

function pctSimilarity(sim: number) {
  if (!Number.isFinite(sim)) return '—'
  return `${(sim * 100).toFixed(1)}%`
}

export function EmbeddingMergePanel() {
  const qc = useQueryClient()

  const analyzeM = useMutation({
    mutationFn: () =>
      apiPost<EmbeddingMergeSuggestionsResponse>(
        '/api/applications/embedding-merge-suggestions',
        { top_k: 3 },
        ANALYZE_MS,
      ),
  })

  const mergeM = useMutation({
    mutationFn: (p: { app_key_a: string; app_key_b: string }) =>
      apiPost<{ kept_app_key: string; removed_app_key: string }>('/api/applications/merge', p),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['applications'] })
      await qc.invalidateQueries({ queryKey: ['timeline'] })
      try {
        await analyzeM.mutateAsync()
      } catch {
        /* merge succeeded; user can re-run analysis */
      }
    },
  })

  const err = analyzeM.error ?? mergeM.error
  const minSim = analyzeM.data?.min_cosine_similarity ?? 0.9

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <h2 className="font-display text-lg font-semibold text-[var(--color-ink)]">Embedding merge suggestions</h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted)]">
          For each open row (<span className="font-mono text-[var(--color-accent)]">application_confirmation</span>),
          we list up to three <span className="font-mono text-[var(--color-accent)]">rejection</span> rows whose{' '}
          <span className="font-mono">app_key</span> embedding cosine similarity is at least{' '}
          <span className="font-mono">{(minSim * 100).toFixed(0)}%</span>{' '}
          (same batch embedding flow as <span className="font-mono">get_embeddings_batch</span> in{' '}
          <span className="font-mono">gmail.ipynb</span>). Pairs below that cutoff are not shown. The number labeled
          <span className="font-medium text-[var(--color-ink)]"> Confidence </span>
          is the classifier score stored for that rejection from the pipeline; embedding similarity is separate and only
          describes how close the two <span className="font-mono">app_key</span> strings are in vector space. Merge
          keeps the confirmation row and deletes the duplicate rejection row.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => analyzeM.mutate()}
            disabled={analyzeM.isPending || mergeM.isPending}
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {analyzeM.isPending ? 'Calling OpenAI embeddings…' : 'Run embedding analysis'}
          </button>
          {analyzeM.data?.embedding_model && (
            <span className="text-xs text-[var(--color-muted)]">
              Model: <span className="font-mono">{analyzeM.data.embedding_model}</span>
            </span>
          )}
        </div>
        {err && <p className="mt-3 text-sm text-[var(--color-danger)]">{(err as Error).message}</p>}
        {analyzeM.data?.hint && (
          <p className="mt-3 text-sm text-[var(--color-muted)]">{analyzeM.data.hint}</p>
        )}
      </Card>

      {analyzeM.data && !analyzeM.data.hint && analyzeM.data.items.length === 0 && (
        <Card>
          <p className="text-sm text-[var(--color-muted)]">No pairs to show.</p>
        </Card>
      )}

      {analyzeM.data?.items.map((row) => (
        <Card key={row.confirmation.app_key}>
          <div className="flex flex-col gap-1 border-b border-[var(--color-border)] pb-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-accent-dim)]">
              Open application
            </p>
            <p className="font-medium text-[var(--color-ink)]">
              {[row.confirmation.company, row.confirmation.job_title].filter(Boolean).join(' — ') || '—'}
            </p>
            <p className="text-xs text-[var(--color-muted)]">
              Applied {fmtDate(row.confirmation.applied_date)} · Updated {fmtDate(row.confirmation.updated_at)}
            </p>
            <p className="mt-1 break-all font-mono text-xs text-[var(--color-muted)]">{row.confirmation.app_key}</p>
          </div>
          <div className="pt-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-accent-dim)]">
              Rejection matches (embedding similarity ≥ {(minSim * 100).toFixed(0)}%)
            </p>
            <ul className="flex flex-col gap-4">
              {row.candidates.map((c, idx) => (
                <li
                  key={c.rejection.app_key}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-[var(--color-muted)]">Match #{idx + 1}</p>
                      <p className="font-medium text-[var(--color-ink)]">
                        {[c.rejection.company, c.rejection.job_title].filter(Boolean).join(' — ') || '—'}
                      </p>
                      <p className="mt-1 break-all font-mono text-xs text-[var(--color-muted)]">{c.rejection.app_key}</p>
                      <p className="mt-1 text-xs text-[var(--color-muted)]">
                        <span className="font-medium text-[var(--color-ink)]">Confidence</span> (classifier / pipeline):{' '}
                        {c.rejection.confidence != null ? c.rejection.confidence.toFixed(2) : '—'}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <div className="text-right">
                        <p className="text-xs text-[var(--color-muted)]">Embedding similarity</p>
                        <p className="font-display text-lg font-semibold tabular-nums text-[var(--color-accent)]">
                          {pctSimilarity(c.cosine_similarity)}
                        </p>
                        <p className="text-[10px] text-[var(--color-muted)]">cosine of app_key texts</p>
                      </div>
                      <button
                        type="button"
                        disabled={mergeM.isPending || analyzeM.isPending}
                        onClick={() =>
                          mergeM.mutate({
                            app_key_a: row.confirmation.app_key,
                            app_key_b: c.rejection.app_key,
                          })
                        }
                        className="shrink-0 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink)] hover:bg-[var(--color-border)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Merge into open row
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      ))}
    </div>
  )
}
