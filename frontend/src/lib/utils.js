import {
  BookOpenCheck,
  HelpCircle,
  Layers,
  ListChecks,
  MessageSquareText,
} from 'lucide-react'

/** Tiny classname joiner (no clsx dependency needed). */
export function cn(...classes) {
  return classes.filter(Boolean).join(' ')
}

export const CARD_TYPES = ['flashcard', 'mcq', 'open_ended']

export const CARD_TYPE_META = {
  flashcard: {
    label: 'Concept card',
    short: 'Concept',
    icon: Layers,
    tint: 'text-brand-soft',
    chip: 'bg-brand/15 text-brand-soft border-brand/30',
    blurb: 'Front/back recall with the key formula.',
  },
  mcq: {
    label: 'Diagnostic MCQ',
    short: 'MCQ',
    icon: ListChecks,
    tint: 'text-accent',
    chip: 'bg-accent/15 text-accent border-accent/30',
    blurb: 'Four options, plus why each distractor is wrong.',
  },
  open_ended: {
    label: 'Open-ended prompt',
    short: 'Open',
    icon: MessageSquareText,
    tint: 'text-good',
    chip: 'bg-good/15 text-good border-good/30',
    blurb: 'Reason it out — graded Socratically against your notes.',
  },
}

export function cardTypeMeta(type) {
  return CARD_TYPE_META[type] ?? CARD_TYPE_META.flashcard
}

/** SM-2 quality labels used by the self-grade buttons. */
export const QUALITY_META = {
  5: { label: 'Perfect', tint: 'text-good', bg: 'bg-good/15 hover:bg-good/25 border-good/40' },
  4: { label: 'Good', tint: 'text-good', bg: 'bg-good/10 hover:bg-good/20 border-good/30' },
  3: { label: 'Hard', tint: 'text-warn', bg: 'bg-warn/10 hover:bg-warn/20 border-warn/30' },
  2: { label: 'Shaky', tint: 'text-warn', bg: 'bg-warn/10 hover:bg-warn/20 border-warn/30' },
  1: { label: 'Wrong', tint: 'text-bad', bg: 'bg-bad/10 hover:bg-bad/20 border-bad/30' },
  0: { label: 'Blackout', tint: 'text-bad', bg: 'bg-bad/10 hover:bg-bad/20 border-bad/30' },
}

export function qualityMeta(quality) {
  return QUALITY_META[quality] ?? QUALITY_META[3]
}

export function gradeBand(score) {
  if (score >= 5) return { label: 'Flawless', tint: 'text-good', bg: 'bg-good/15 border-good/40' }
  if (score === 4) return { label: 'Solid', tint: 'text-good', bg: 'bg-good/10 border-good/30' }
  if (score === 3) return { label: 'Adequate', tint: 'text-warn', bg: 'bg-warn/10 border-warn/30' }
  if (score === 2) return { label: 'Partial', tint: 'text-warn', bg: 'bg-warn/10 border-warn/30' }
  if (score === 1) return { label: 'Mostly wrong', tint: 'text-bad', bg: 'bg-bad/10 border-bad/30' }
  return { label: 'No recall', tint: 'text-bad', bg: 'bg-bad/15 border-bad/40' }
}

/** Backend uses naive UTC datetimes — tag them so the browser localises right. */
export function parseDate(value) {
  if (!value) return null
  const str = typeof value === 'string' ? value : String(value)
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(str)
  const date = new Date(hasZone ? str : `${str}Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatDate(value, opts) {
  const date = parseDate(value)
  if (!date) return '—'
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...opts,
  })
}

export function formatDateTime(value) {
  const date = parseDate(value)
  if (!date) return '—'
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** Human phrase describing when a card comes back. */
export function dueLabel(value) {
  const date = parseDate(value)
  if (!date) return 'Not scheduled'
  const now = Date.now()
  const diffMs = date.getTime() - now
  const days = Math.round(diffMs / 86_400_000)

  if (diffMs <= 0) {
    const overdue = Math.abs(days)
    if (overdue === 0) return 'Due now'
    return `${overdue} day${overdue === 1 ? '' : 's'} overdue`
  }
  if (days === 0) return 'Later today'
  if (days === 1) return 'Tomorrow'
  if (days < 30) return `In ${days} days`
  const months = Math.round(days / 30)
  return `In ${months} month${months === 1 ? '' : 's'}`
}

export function relativeTime(value) {
  const date = parseDate(value)
  if (!date) return '—'
  const seconds = Math.round((Date.now() - date.getTime()) / 1000)
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  const table = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
    ['second', 1],
  ]
  for (const [unit, secs] of table) {
    if (Math.abs(seconds) >= secs || unit === 'second') {
      return rtf.format(-Math.round(seconds / secs), unit)
    }
  }
  return 'just now'
}

export function pluralise(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural ?? `${singular}s`}`
}

export function percent(value, digits = 0) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return `${(n * 100).toFixed(digits)}%`
}

export function truncate(text, max = 160) {
  const str = String(text ?? '')
  if (str.length <= max) return str
  return `${str.slice(0, max - 1).trimEnd()}…`
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

export function readableSourceType(sourceType) {
  const map = { text: 'Pasted text', markdown: 'Markdown', pdf: 'PDF', md: 'Markdown', txt: 'Text' }
  return map[sourceType] ?? (sourceType ? sourceType.toUpperCase() : 'Material')
}

export const BookOpenCheckIcon = BookOpenCheck
export const HelpCircleIcon = HelpCircle
