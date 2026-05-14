import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { apiGet, type ApplicationRow, type TimelineRow } from './api'
import { ApplicationBoard } from './features/applications/ApplicationBoard'
import { EmbeddingMergePanel } from './features/embedding-merge/EmbeddingMergePanel'
import { SyncPanel } from './features/sync/SyncPanel'
import { TimelinePanel } from './features/timeline/TimelinePanel'
import { useEnrichedApplications } from './hooks/useEnrichedApplications'
import { AppShell, type MainTab } from './layout/AppShell'

type Props = {
  onSignOut: () => void
}

export function MainApp({ onSignOut }: Props) {
  const [tab, setTab] = useState<MainTab>('Applications')
  const qc = useQueryClient()

  /** After sync, refetch list data even when those tabs are not focused (queries would otherwise be inactive). */
  const invalidateData = useCallback(() => {
    return Promise.all([
      qc.invalidateQueries({ queryKey: ['applications'] }),
      qc.invalidateQueries({ queryKey: ['timeline'], refetchType: 'all' }),
      qc.invalidateQueries({ queryKey: ['meta'] }),
    ]).then(() => undefined)
  }, [qc])

  const onTimelineSaved = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['timeline'] })
  }, [qc])

  const appsQ = useQuery({
    queryKey: ['applications'],
    queryFn: () => apiGet<ApplicationRow[]>('/api/applications'),
    /** Keep this observer active on every tab so post-sync invalidation refetches while you stay on Sync. */
    enabled: true,
  })

  const timelineQ = useQuery({
    queryKey: ['timeline'],
    queryFn: () => apiGet<TimelineRow[]>('/api/timeline'),
    enabled: tab === 'Applications' || tab === 'Timeline',
    staleTime: 60_000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
  })

  const enriched = useEnrichedApplications(appsQ.data, timelineQ.data)

  return (
    <AppShell tab={tab} onTab={setTab} onSignOut={onSignOut}>
      {tab === 'Sync' && <SyncPanel onSynced={invalidateData} />}
      {tab === 'Smart merge' && <EmbeddingMergePanel />}
      {tab === 'Applications' && (
        <ApplicationBoard
          rows={enriched}
          loading={appsQ.isLoading}
          error={appsQ.error ?? timelineQ.error}
        />
      )}
      {tab === 'Timeline' && (
        <TimelinePanel
          rows={timelineQ.data}
          loading={timelineQ.isLoading}
          error={timelineQ.error}
          onSaved={onTimelineSaved}
        />
      )}
    </AppShell>
  )
}
