export const REVIEW_STATUSES = [
  'application_confirmation',
  'interview',
  'rejection',
  'follow_up',
  'offer',
  'other',
] as const

export type ReviewStatus = (typeof REVIEW_STATUSES)[number]

export const TIMELINE_OUTCOMES = [
  'Rejected',
  'Interview (no rejection logged)',
  'Open / pending',
] as const

export const DEFAULT_GMAIL_QUERY = 'in:inbox (category:primary OR category:updates)'

export const SESSION_KEY = 'applyledger-session'
