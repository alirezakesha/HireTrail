import { useMutation } from '@tanstack/react-query'
import { apiPost, type Meta } from '../../api'
import { Card } from '../../components/ui/Card'
import { SESSION_KEY } from '../../constants/statuses'

type Props = {
  meta?: Meta
  metaLoading: boolean
  metaError: Error | null
  onEnterApp: () => void
}

export function SignInView({ meta, metaLoading, metaError, onEnterApp }: Props) {
  const authM = useMutation({
    mutationFn: () => apiPost<{ gmail_token_file: string; message: string }>('/api/auth/gmail'),
    onSuccess: () => {
      sessionStorage.setItem(SESSION_KEY, '1')
      onEnterApp()
    },
  })

  function enterWithoutOAuth() {
    sessionStorage.setItem(SESSION_KEY, '1')
    onEnterApp()
  }

  return (
    <div className="mx-auto flex min-h-svh max-w-lg flex-col justify-center px-4 py-16 sm:px-6">
      <div className="mb-8 text-center">
        <p className="font-display text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-accent-dim)]">
          Job search
        </p>
        <h1 className="font-display mt-2 text-3xl font-semibold tracking-tight text-[var(--color-ink)] sm:text-4xl">
          ApplyLedger
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-[var(--color-muted)]">
          Sign in with Google to link Gmail, then track every application—where you applied, outcomes, job IDs, and
          status updates—in one place.
        </p>
      </div>

      <Card>
        <div className="mb-4 min-h-[3rem] text-sm">
          {metaLoading && <p className="text-[var(--color-muted)]">Checking server…</p>}
          {metaError && (
            <p className="text-[var(--color-danger)]">
              {(metaError as Error).message} You can still open the dashboard below.
            </p>
          )}
          {meta && !metaLoading && !metaError && (
            <dl className="grid gap-3">
              <div className="flex justify-between gap-4 rounded-xl bg-black/20 px-3 py-2">
                <dt className="text-[var(--color-muted)]">API</dt>
                <dd className={meta.ready ? 'font-medium text-[var(--color-ok)]' : 'text-[var(--color-warn)]'}>
                  {meta.ready ? 'Ready' : 'Needs configuration'}
                </dd>
              </div>
              {meta.gmail_token_file && (
                <div className="flex justify-between gap-4 rounded-xl bg-black/20 px-3 py-2">
                  <dt className="text-[var(--color-muted)]">Token file</dt>
                  <dd className="max-w-[60%] truncate font-mono text-xs text-[var(--color-ink)]">
                    {meta.gmail_token_file}
                  </dd>
                </div>
              )}
            </dl>
          )}
        </div>

        <button
          type="button"
          disabled={authM.isPending}
          onClick={() => authM.mutate()}
          className="mt-6 w-full rounded-xl bg-[var(--color-accent)] px-4 py-3 text-sm font-semibold text-[#1a1408] shadow-lg shadow-[var(--color-accent)]/20 transition hover:brightness-110 disabled:opacity-50"
        >
          {authM.isPending ? 'Opening browser…' : 'Sign in with Google (Gmail)'}
        </button>

        <button
          type="button"
          onClick={enterWithoutOAuth}
          className="mt-3 w-full rounded-xl border border-[var(--color-border)] px-4 py-3 text-sm font-medium text-[var(--color-muted)] transition hover:border-[var(--color-accent)]/40 hover:text-[var(--color-ink)]"
        >
          Continue to dashboard
        </button>
        <p className="mt-3 text-center text-xs text-[var(--color-muted)]">
          Use “Continue” if <code className="rounded bg-black/30 px-1 font-mono">token.json</code> is already on this
          machine. You can authenticate later under Sync.
        </p>

        {authM.isError && (
          <p className="mt-4 text-sm text-[var(--color-danger)]">{(authM.error as Error).message}</p>
        )}
      </Card>
    </div>
  )
}
