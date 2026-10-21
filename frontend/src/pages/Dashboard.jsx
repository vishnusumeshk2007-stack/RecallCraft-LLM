import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Flame,
  Layers,
  Play,
  Plus,
  Target,
  TrendingUp,
  Trophy,
  Upload,
  Zap,
} from 'lucide-react'
import api from '../lib/api'
import { useAsync } from '../lib/hooks'
import { useAppData } from '../lib/store'
import { cardTypeMeta, formatDateTime, percent, pluralise, qualityMeta } from '../lib/utils'
import { AccuracyLine, CompositionBar, ForecastBars, TrendBars } from '../components/charts'
import {
  Badge,
  Button,
  EmptyState,
  Gauge,
  LoadingBlock,
  Panel,
  Progress,
  SectionHeading,
  Stat,
} from '../components/ui'

function greeting() {
  const hour = new Date().getHours()
  if (hour < 5) return 'Still up'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export default function Dashboard() {
  const { stats, statsError, refreshStats } = useAppData()
  const { data: logs } = useAsync(() => api.logs({ limit: 6 }), [], { initial: [] })

  if (!stats) {
    return (
      <div className="space-y-6">
        <Panel className="p-6">
          <LoadingBlock label="Loading your deck…" />
        </Panel>
      </div>
    )
  }

  const byType = stats.cards_by_type ?? {}
  const typeSegments = ['flashcard', 'mcq', 'open_ended'].map((type) => ({
    label: cardTypeMeta(type).short,
    value: byType[type] ?? 0,
    tone: type === 'flashcard' ? 'brand' : type === 'mcq' ? 'accent' : 'good',
  }))

  const dueNow = stats.due_now ?? 0
  const mastered = stats.mature_cards ?? 0
  const empty = stats.total_cards === 0

  return (
    <div className="space-y-6">
      {/* ------------------------------- Hero ------------------------------- */}
      <Panel className="relative overflow-hidden p-6 sm:p-7">
        <div className="pointer-events-none absolute -top-24 -right-16 size-64 rounded-full bg-brand/18 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-28 left-1/3 size-56 rounded-full bg-accent/10 blur-3xl" />

        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-xl">
            <Badge tone="brand" icon={Zap}>
              SM-2 retention engine
            </Badge>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              <span className="text-gradient">{greeting()}.</span>{' '}
              <span className="text-ink">
                {dueNow > 0
                  ? `${pluralise(dueNow, 'card')} ready to review.`
                  : empty
                    ? 'Let’s build your first deck.'
                    : 'You are all caught up.'}
              </span>
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              {empty
                ? 'Paste notes, drop in a Markdown file or upload a PDF. RecallCraft chunks it, generates concept cards, diagnostic MCQs and open-ended prompts, then schedules every card with SM-2.'
                : `You have reviewed ${pluralise(stats.total_reviews, 'card')} so far with a ${percent(stats.retention_rate)} retention rate. Keep the streak alive — consistency beats cramming.`}
            </p>

            <div className="mt-5 flex flex-wrap gap-2.5">
              <Button
                as={Link}
                to={dueNow > 0 ? '/review' : '/ingest'}
                variant="primary"
                size="lg"
                icon={dueNow > 0 ? Play : Plus}
              >
                {dueNow > 0 ? `Review ${dueNow} card${dueNow === 1 ? '' : 's'}` : 'Add study material'}
              </Button>
              <Button as={Link} to="/deck" variant="outline" size="lg" icon={Layers}>
                Browse deck
              </Button>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-5">
            <Gauge
              value={stats.retention_rate}
              label={percent(stats.retention_rate)}
              sublabel="Retention"
              tone="#34d399"
            />
            <div className="hidden w-44 space-y-3 sm:block">
              <MiniStat icon={Flame} label="Streak" value={`${stats.streak_days}d`} tone="warn" />
              <MiniStat
                icon={Target}
                label="7-day accuracy"
                value={percent(stats.accuracy_7d)}
                tone="accent"
              />
              <MiniStat
                icon={Trophy}
                label="Mastered"
                value={mastered}
                tone="good"
              />
            </div>
          </div>
        </div>
      </Panel>

      {/* ------------------------------ Imports ----------------------------- */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Due now" value={dueNow} hint={`${stats.due_today} due today`} icon={CalendarDays} tone="brand" />
        <Stat label="Cards" value={stats.total_cards} hint={`${stats.total_materials} materials`} icon={Layers} tone="accent" />
        <Stat label="Retention" value={percent(stats.retention_rate)} hint="Rolling pass rate" icon={TrendingUp} tone="good" />
        <Stat
          label="Avg. ease"
          value={stats.average_ease_factor.toFixed(2)}
          hint={`Avg. interval ${stats.average_interval.toFixed(1)}d`}
          icon={Zap}
          tone="warn"
        />
      </div>

      {/* ------------------------- Trend + retention ------------------------ */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="p-5 lg:col-span-2">
          <SectionHeading
            icon={TrendingUp}
            title="Review activity"
            subtitle="Last 14 days — correct answers stacked over mistakes"
            action={<Badge tone="accent">{percent(stats.accuracy_7d)} 7d accuracy</Badge>}
          />
          <div className="mt-5">
            <TrendBars data={stats.trend} />
          </div>
          <div className="mt-4 border-t border-edge-soft pt-4">
            <AccuracyLine data={stats.trend} />
          </div>
        </Panel>

        <Panel className="p-5">
          <SectionHeading icon={Target} title="Memory stages" subtitle="SM-2 maturity split" />
          <div className="mt-5 space-y-4">
            <CompositionBar
              segments={[
                { label: 'New', value: stats.new_cards, tone: 'muted' },
                { label: 'Learning', value: stats.learning_cards, tone: 'warn' },
                { label: 'Mature', value: stats.mature_cards, tone: 'good' },
              ]}
            />
            <div className="space-y-3 rounded-xl border border-edge bg-panel-2/40 p-3.5">
              <StageRow label="New — never reviewed" value={stats.new_cards} total={stats.total_cards} tone="brand" />
              <StageRow label="Learning — interval < 21d" value={stats.learning_cards} total={stats.total_cards} tone="warn" />
              <StageRow label="Mature — interval ≥ 21d" value={stats.mature_cards} total={stats.total_cards} tone="good" />
            </div>
          </div>
        </Panel>
      </div>

      {/* ------------------------ Forecast + card mix ----------------------- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="p-5">
          <SectionHeading
            icon={CalendarDays}
            title="Upcoming workload"
            subtitle="Cards falling due over the next 14 days"
          />
          <div className="mt-5">
            <ForecastBars data={stats.forecast} />
          </div>
        </Panel>

        <Panel className="p-5">
          <SectionHeading icon={BookOpen} title="Card mix" subtitle="Review item types in this deck" />
          <div className="mt-5">
            <CompositionBar segments={typeSegments} />
          </div>
          <div className="mt-5 grid grid-cols-3 gap-2">
            {['flashcard', 'mcq', 'open_ended'].map((type) => {
              const meta = cardTypeMeta(type)
              const Icon = meta.icon
              return (
                <div key={type} className="rounded-xl border border-edge bg-panel-2/40 p-3">
                  <Icon className={`size-4 ${meta.tint}`} />
                  <p className="mt-2 text-xl font-semibold tabular-nums text-ink">
                    {byType[type] ?? 0}
                  </p>
                  <p className="text-[11px] text-muted">{meta.label}</p>
                </div>
              )
            })}
          </div>
        </Panel>
      </div>

      {/* --------------------------- Recent activity ------------------------ */}
      <Panel className="p-5">
        <SectionHeading
          icon={Flame}
          title="Recent reviews"
          subtitle="Your latest graded answers"
          action={
            <Button as={Link} to="/review" variant="ghost" size="sm" iconRight={ArrowRight}>
              Review
            </Button>
          }
        />
        <div className="mt-4">
          {logs?.length ? (
            <ul className="divide-y divide-edge-soft">
              {logs.map((log) => {
                const meta = qualityMeta(log.quality_rating)
                const chip =
                  log.quality_rating >= 4
                    ? 'border-good/40 bg-good/15 text-good'
                    : log.quality_rating === 3
                      ? 'border-warn/40 bg-warn/15 text-warn'
                      : 'border-bad/40 bg-bad/15 text-bad'
                return (
                  <li key={log.id} className="flex items-center justify-between gap-4 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className={`grid size-8 shrink-0 place-items-center rounded-lg border text-xs font-semibold tabular-nums ${chip}`}
                      >
                        {log.quality_rating}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm text-ink">
                          {log.socratic_feedback?.socratic_feedback
                            ? log.socratic_feedback.socratic_feedback
                            : log.user_response
                              ? `“${log.user_response}”`
                              : `Self-graded ${meta.label.toLowerCase()}`}
                        </p>
                        <p className="text-xs text-faint">
                          {formatDateTime(log.reviewed_at)}
                          {log.interval_after != null && ` · next in ${log.interval_after}d`}
                        </p>
                      </div>
                    </div>
                    <Badge tone={log.quality_rating >= 3 ? 'good' : 'bad'}>{meta.label}</Badge>
                  </li>
                )
              })}
            </ul>
          ) : (
            <EmptyState
              icon={Play}
              title="No reviews yet"
              description="Grade your first card and your retention history will start building here."
              action={
                <Button as={Link} to={empty ? '/ingest' : '/review'} variant="primary" icon={empty ? Upload : Play}>
                  {empty ? 'Add material' : 'Start reviewing'}
                </Button>
              }
              className="py-10"
            />
          )}
        </div>
      </Panel>

      {statsError && (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-warn/30 bg-warn/8 p-3.5 text-sm">
          <span className="text-muted">Could not refresh statistics: {statsError.message}</span>
          <Button size="sm" variant="outline" onClick={() => refreshStats()}>
            Retry
          </Button>
        </div>
      )}
    </div>
  )
}

function MiniStat({ icon: Icon, label, value, tone = 'brand' }) {
  const tones = {
    brand: 'text-brand-soft border-brand/25 bg-brand/10',
    accent: 'text-accent border-accent/25 bg-accent/10',
    good: 'text-good border-good/25 bg-good/10',
    warn: 'text-warn border-warn/25 bg-warn/10',
  }
  return (
    <div className="flex items-center gap-2.5">
      <span className={`grid size-8 shrink-0 place-items-center rounded-lg border ${tones[tone]}`}>
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold tabular-nums text-ink">{value}</p>
        <p className="truncate text-[11px] text-faint">{label}</p>
      </div>
    </div>
  )
}

function StageRow({ label, value, total, tone }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="font-semibold tabular-nums text-ink">{value}</span>
      </div>
      <Progress value={value} max={Math.max(total, 1)} tone={tone} height="h-1.5" />
    </div>
  )
}
