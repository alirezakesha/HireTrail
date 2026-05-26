import type { ReactNode } from 'react'
import { TabButton } from '../components/ui/TabButton'

export const MAIN_TABS = ['Applications', 'Smart merge', 'Sync', 'Timeline', 'Tables'] as const
export type MainTab = (typeof MAIN_TABS)[number]

type Props = {
  tab: MainTab
  onTab: (t: MainTab) => void
  onSignOut: () => void
  children: ReactNode
}

export function AppShell({ tab, onTab, onSignOut, children }: Props) {
  return (
    <div className="mx-auto flex min-h-svh max-w-7xl flex-col px-4 pb-16 pt-8 sm:px-6 lg:px-8">
      <header className="mb-10 flex flex-col gap-6 border-b border-[var(--color-border)] pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-display text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-accent-dim)]">
            Signed in
          </p>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-[var(--color-ink)] sm:text-4xl">
            ApplyLedger
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--color-muted)]">
            Gmail → OpenAI → SQLite. Browse applications, use Smart merge for embedding-based duplicate detection, sync
            from Gmail, refine outcomes on the timeline, or inspect and edit raw database tables.
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-3 sm:items-end">
          <div className="flex flex-wrap justify-end gap-2">
            {MAIN_TABS.map((t) => (
              <TabButton key={t} active={tab === t} onClick={() => onTab(t)}>
                {t}
              </TabButton>
            ))}
          </div>
          <button
            type="button"
            onClick={onSignOut}
            className="self-end text-xs font-medium text-[var(--color-muted)] underline-offset-4 hover:text-[var(--color-ink)] hover:underline"
          >
            Sign out
          </button>
        </div>
      </header>
      {children}
    </div>
  )
}
