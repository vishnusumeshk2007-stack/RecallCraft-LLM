import { motion } from 'framer-motion'
import { cn } from '../lib/utils'

const TONE_BG = {
  brand: 'bg-brand',
  accent: 'bg-accent',
  good: 'bg-good',
  warn: 'bg-warn',
  bad: 'bg-bad',
  muted: 'bg-panel-3',
}

function shortDate(value) {
  if (!value) return ''
  const [, month, day] = String(value).split('-')
  if (!month) return String(value)
  return `${Number(month)}/${Number(day)}`
}

/**
 * 14-day review history. Each column stacks correct (emerald) over incorrect
 * (amber) so accuracy is legible without a second axis.
 */
export function TrendBars({ data = [], height = 132 }) {
  if (!data.length) {
    return <div className="py-8 text-center text-sm text-faint">No review history yet.</div>
  }
  const max = Math.max(1, ...data.map((d) => d.reviews || 0))

  return (
    <div>
      <div className="flex items-end gap-1.5" style={{ height }}>
        {data.map((point, index) => {
          const total = point.reviews || 0
          const correct = point.correct || 0
          const wrong = Math.max(0, total - correct)
          const totalPct = (total / max) * 100
          return (
            <div
              key={point.date ?? index}
              className="group relative flex h-full flex-1 flex-col justify-end"
              title={`${point.date} — ${total} reviews, ${Math.round((point.accuracy || 0) * 100)}% correct`}
            >
              <motion.div
                className="w-full overflow-hidden rounded-t-md bg-panel-3/60"
                initial={{ height: 0 }}
                animate={{ height: `${Math.max(totalPct, total ? 6 : 2)}%` }}
                transition={{ duration: 0.5, delay: index * 0.015, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="flex h-full w-full flex-col">
                  {wrong > 0 && (
                    <div
                      className="w-full bg-warn/70"
                      style={{ height: `${(wrong / total) * 100}%` }}
                    />
                  )}
                  <div className="w-full flex-1 bg-gradient-to-b from-good to-good/70" />
                </div>
              </motion.div>
            </div>
          )
        })}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-faint">
        <span>{shortDate(data[0]?.date)}</span>
        <span>{data.length} days</span>
        <span>{shortDate(data[data.length - 1]?.date)}</span>
      </div>
    </div>
  )
}

/** Upcoming workload: how many cards fall due on each of the next 14 days. */
export function ForecastBars({ data = [], height = 96 }) {
  if (!data.length) {
    return <div className="py-6 text-center text-sm text-faint">Nothing scheduled yet.</div>
  }
  const max = Math.max(1, ...data.map((d) => d.due || 0))

  return (
    <div>
      <div className="flex items-end gap-1" style={{ height }}>
        {data.map((point, index) => (
          <div
            key={point.date ?? index}
            className="group flex h-full flex-1 flex-col justify-end"
            title={`${point.date} — ${point.due} due`}
          >
            <motion.div
              className={cn(
                'w-full rounded-t-sm',
                index === 0
                  ? 'bg-gradient-to-t from-accent to-brand'
                  : 'bg-brand/35 group-hover:bg-brand/60',
              )}
              initial={{ height: 0 }}
              animate={{ height: `${Math.max((point.due / max) * 100, point.due ? 8 : 2)}%` }}
              transition={{ duration: 0.45, delay: index * 0.02 }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-faint">
        <span>Today</span>
        <span>+{data.length - 1} days</span>
      </div>
    </div>
  )
}

/** Horizontal stacked composition bar with a legend underneath. */
export function CompositionBar({ segments = [] }) {
  const total = segments.reduce((sum, s) => sum + (s.value || 0), 0)
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-panel-3/70">
        {total > 0 &&
          segments.map((segment) => (
            <motion.div
              key={segment.label}
              className={cn(TONE_BG[segment.tone] ?? TONE_BG.brand)}
              initial={{ width: 0 }}
              animate={{ width: `${(segment.value / total) * 100}%` }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              title={`${segment.label}: ${segment.value}`}
            />
          ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {segments.map((segment) => (
          <div key={segment.label} className="flex items-center gap-2">
            <span className={cn('size-2.5 shrink-0 rounded-full', TONE_BG[segment.tone])} />
            <span className="truncate text-xs text-muted">
              {segment.label}
              <span className="ml-1.5 font-semibold tabular-nums text-ink">{segment.value}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Compact 7/14-day accuracy sparkline. */
export function AccuracyLine({ data = [], width = 260, height = 48 }) {
  const points = data.filter((d) => d.reviews > 0)
  if (points.length < 2) return null

  const step = width / (points.length - 1)
  const coords = points.map((point, index) => {
    const x = index * step
    const y = height - (point.accuracy || 0) * height
    return [x, y]
  })
  const path = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')

  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id="accuracy-line" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#7c6cff" />
        </linearGradient>
      </defs>
      <motion.path
        d={path}
        fill="none"
        stroke="url(#accuracy-line)"
        strokeWidth="2"
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1, ease: 'easeOut' }}
      />
    </svg>
  )
}
