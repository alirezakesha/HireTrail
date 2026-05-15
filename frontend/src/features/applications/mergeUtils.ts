/** Mirrors `applyledger.db` default merge suggestions. */

export type MergeSide = 'a' | 'b'

export type MergeFieldKey =
  | 'company'
  | 'job_title'
  | 'job_id'
  | 'status'
  | 'applied_date'
  | 'last_update_date'
  | 'last_email'
  | 'confidence'
  | 'notes'

export const MERGE_FIELD_KEYS: MergeFieldKey[] = [
  'company',
  'job_title',
  'job_id',
  'status',
  'applied_date',
  'last_update_date',
  'last_email',
  'confidence',
  'notes',
]

export const MERGE_FIELD_LABELS: Record<MergeFieldKey, string> = {
  company: 'Company',
  job_title: 'Job title',
  job_id: 'Job ID',
  status: 'Status',
  applied_date: 'Applied date',
  last_update_date: 'Last update',
  last_email: 'Latest email (id + date)',
  confidence: 'Confidence',
  notes: 'Notes',
}

type MergeRow = {
  app_key: string
  company: string | null
  job_title: string | null
  job_id: string | null
  status: string
  applied_date?: string | null
  last_update_date: string | null
  last_email_message_id?: string | null
  last_email_date_raw: string | null
  confidence: number | null
  notes: string | null
  updated_at: string | null
}

const STATUS_RANK: Record<string, number> = {
  rejection: 5,
  interview: 4,
  application_confirmation: 3,
  follow_up: 2,
  offer: 2,
  other: 1,
}

function textScore(v: string | null | undefined): number {
  if (v == null) return 0
  const s = String(v).trim()
  return s.length
}

function pickRicher(va: string | null | undefined, vb: string | null | undefined): MergeSide {
  return textScore(va) >= textScore(vb) ? 'a' : 'b'
}

export function defaultKeptAppKey(a: MergeRow, b: MergeRow): string {
  if (a.status === 'application_confirmation' && b.status !== 'application_confirmation') return a.app_key
  if (b.status === 'application_confirmation' && a.status !== 'application_confirmation') return b.app_key
  const scoreA =
    textScore(a.company) + textScore(a.job_title) + textScore(a.job_id) + textScore(a.notes)
  const scoreB =
    textScore(b.company) + textScore(b.job_title) + textScore(b.job_id) + textScore(b.notes)
  if (scoreA !== scoreB) return scoreA > scoreB ? a.app_key : b.app_key
  return (a.updated_at ?? '') >= (b.updated_at ?? '') ? a.app_key : b.app_key
}

export function defaultMergeFieldChoices(a: MergeRow, b: MergeRow): Record<MergeFieldKey, MergeSide> {
  const choices = {} as Record<MergeFieldKey, MergeSide>
  for (const field of ['company', 'job_title', 'job_id', 'notes'] as const) {
    choices[field] = pickRicher(a[field], b[field])
  }
  const ra = STATUS_RANK[a.status] ?? 0
  const rb = STATUS_RANK[b.status] ?? 0
  choices.status = ra >= rb ? 'a' : 'b'

  const ads: [MergeSide, string | null | undefined][] = [
    ['a', a.applied_date],
    ['b', b.applied_date],
  ]
  const adsN = ads.filter(([, d]) => d)
  if (adsN.length) {
    choices.applied_date = adsN.reduce((best, cur) =>
      String(cur[1]) < String(best[1]) ? cur : best,
    )[0]
  } else {
    choices.applied_date = pickRicher(a.applied_date, b.applied_date)
  }

  const luds: [MergeSide, string | null | undefined][] = [
    ['a', a.last_update_date],
    ['b', b.last_update_date],
  ]
  const ludsN = luds.filter(([, d]) => d)
  if (ludsN.length) {
    choices.last_update_date = ludsN.reduce((best, cur) =>
      String(cur[1]) > String(best[1]) ? cur : best,
    )[0]
  } else {
    choices.last_update_date = pickRicher(a.last_update_date, b.last_update_date)
  }

  choices.last_email = (a.updated_at ?? '') >= (b.updated_at ?? '') ? 'a' : 'b'

  if (a.confidence == null && b.confidence == null) choices.confidence = 'a'
  else if (b.confidence == null) choices.confidence = 'a'
  else if (a.confidence == null) choices.confidence = 'b'
  else choices.confidence = a.confidence >= b.confidence ? 'a' : 'b'

  return choices
}

export function fieldValue(row: MergeRow, field: MergeFieldKey): string {
  switch (field) {
    case 'last_email':
      return [row.last_email_message_id, row.last_email_date_raw].filter(Boolean).join(' · ') || '—'
    case 'confidence':
      return row.confidence != null ? row.confidence.toFixed(2) : '—'
    case 'applied_date':
      return row.applied_date ?? '—'
    default:
      return (row as Record<string, string | null | undefined>)[field] ?? '—'
  }
}

export function rowLabel(r: MergeRow): string {
  const parts = [r.company, r.job_title].filter(Boolean)
  return parts.length ? parts.join(' — ') : r.app_key.slice(0, 48)
}
