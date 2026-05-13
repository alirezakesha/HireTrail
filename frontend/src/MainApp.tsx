import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { apiGet, type ApplicationRow, type Meta, type ReviewEventRow, type TimelineRow } from './api'
import { ApplicationBoard } from './features/applications/ApplicationBoard'
import { Overview } from './features/overview/Overview'
import { ReviewPanel } from './features/review/ReviewPanel'
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

  const invalidateData = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['applications'] })
    void qc.invalidateQueries({ queryKey: ['review-events'] })
    void qc.invalidateQueries({ queryKey: ['timeline'] })
    void qc.invalidateQueries({ queryKey: ['meta'] })
  }, [qc])

  const onTimelineSaved = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['timeline'] })
  }, [qc])

  const metaQ = useQuery({
    queryKey: ['meta'],
    queryFn: () => apiGet<Meta>('/api/meta'),
  })

  const appsQ = useQuery({
    queryKey: ['applications'],
    queryFn: () => apiGet<ApplicationRow[]>('/api/applications'),
    enabled: tab === 'Applications' || tab === 'Overview',
  })

  const eventsQ = useQuery({
    queryKey: ['review-events'],
    queryFn: () => apiGet<ReviewEventRow[]>('/api/events/review?limit=200'),
    enabled: tab === 'Review',
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
      {tab === 'Overview' && (
        <Overview
          meta={metaQ.data}
          metaLoading={metaQ.isLoading}
          metaError={metaQ.error}
          appCount={appsQ.data?.length}
          appsLoading={appsQ.isLoading}
        />
      )}
      {tab === 'Sync' && <SyncPanel onSynced={invalidateData} />}
      {tab === 'Review' && <ReviewPanel data={eventsQ.data} loading={eventsQ.isLoading} error={eventsQ.error} />}
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
