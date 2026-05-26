export function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  const d = s.slice(0, 10)
  return d.length === 10 ? d : s.slice(0, 16).replace('T', ' ')
}

export function effectiveAppliedAt(r: {
  applied_date?: string | null
  status: string
  last_update_date: string | null
  last_email_date_raw: string | null
}) {
  if (r.applied_date) return r.applied_date
  if (r.status === 'application_confirmation') {
    return r.last_update_date ?? r.last_email_date_raw
  }
  return null
}
