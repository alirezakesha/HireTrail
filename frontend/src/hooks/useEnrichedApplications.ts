import { useMemo } from 'react'
import type { ApplicationRow, TimelineRow } from '../api'

export type EnrichedApplication = ApplicationRow & {
  rejection_at: string | null
  interview_at: string | null
}

export function useEnrichedApplications(
  apps: ApplicationRow[] | undefined,
  timeline: TimelineRow[] | undefined,
): EnrichedApplication[] {
  return useMemo(() => {
    const list = apps ?? []
    const tmap = new Map((timeline ?? []).map((t) => [t.app_key, t]))
    return list.map((a) => {
      const t = tmap.get(a.app_key)
      return {
        ...a,
        rejection_at: t?.rejection_at ?? null,
        interview_at: t?.interview_at ?? null,
      }
    })
  }, [apps, timeline])
}
