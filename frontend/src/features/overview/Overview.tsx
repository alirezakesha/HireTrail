import type { Meta } from '../../api'
import { Card } from '../../components/ui/Card'

type Props = {
  meta?: Meta
  metaLoading: boolean
  metaError: Error | null
  appCount?: number
  appsLoading: boolean
}

export function Overview({ meta, metaLoading, metaError, appCount, appsLoading }: Props) {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <h2 className="font-display text-lg font-semibold text-[var(--color-ink)]">Environment</h2>
        {metaLoading && <p className="mt-4 text-sm text-[var(--color-muted)]">Loading…</p>}
        {metaError && (
          <p className="mt-4 text-sm text-[var(--color-danger)]">{(metaError as Error).message}</p>
        )}
        {meta && (
          <dl className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl bg-black/20 p-4">
              <dt className="text-xs uppercase tracking-wide text-[var(--color-muted)]">API ready</dt>
              <dd className="mt-1 font-medium text-[var(--color-ok)]">{meta.ready ? 'Yes' : 'No'}</dd>
            </div>
            <div className="rounded-xl bg-black/20 p-4">
              <dt className="text-xs uppercase tracking-wide text-[var(--color-muted)]">OpenAI model</dt>
              <dd className="mt-1 font-mono text-sm text-[var(--color-ink)]">{meta.openai_model ?? '—'}</dd>
            </div>
            <div className="rounded-xl bg-black/20 p-4">
              <dt className="text-xs uppercase tracking-wide text-[var(--color-muted)]">SQLite file</dt>
              <dd className="mt-1 font-mono text-sm text-[var(--color-ink)]">{meta.db_file ?? '—'}</dd>
            </div>
            <div className="rounded-xl bg-black/20 p-4">
              <dt className="text-xs uppercase tracking-wide text-[var(--color-muted)]">Gmail token</dt>
              <dd className="mt-1 font-mono text-sm text-[var(--color-ink)]">{meta.gmail_token_file ?? '—'}</dd>
            </div>
          </dl>
        )}
        {meta && !meta.ready && meta.error && (
          <p className="mt-4 rounded-lg border border-[var(--color-warn)]/40 bg-[var(--color-warn)]/10 p-3 text-sm text-[var(--color-warn)]">
            {meta.error}
          </p>
        )}
      </Card>
      <Card>
        <h2 className="font-display text-lg font-semibold text-[var(--color-ink)]">Quick facts</h2>
        <p className="mt-4 text-sm text-[var(--color-muted)]">
          Applications stored in the database (latest sync wins on upsert).
        </p>
        <p className="mt-6 font-display text-4xl font-semibold tabular-nums text-[var(--color-accent)]">
          {appsLoading ? '…' : appCount ?? '—'}
        </p>
        <p className="mt-1 text-xs text-[var(--color-muted)]">rows in `applications`</p>
        <ol className="mt-8 list-decimal space-y-2 pl-4 text-sm text-[var(--color-muted)]">
          <li>Open the Applications tab for the main tracker.</li>
          <li>Authenticate Gmail on the Sync tab when you need fresh mail.</li>
          <li>Review extracted events or adjust outcomes on the Timeline tab.</li>
        </ol>
      </Card>
    </div>
  )
}
