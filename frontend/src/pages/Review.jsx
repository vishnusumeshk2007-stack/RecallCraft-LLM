import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowRight,
  Brain,
  CalendarDays,
  Check,
  ChevronLeft,
  CircleCheck,
  Eye,
  Flame,
  Gauge,
  Layers,
  Lightbulb,
  ListChecks,
  LoaderCircle,
  MessageSquareText,
  Play,
  RotateCcw,
  Send,
  Sparkles,
  Target,
  Trophy,
  X,
  Zap,
} from 'lucide-react'
import api from '../lib/api'
import { toast } from '../lib/hooks'
import { useAppData } from '../lib/store'
import {
  cardTypeMeta,
  cn,
  dueLabel,
  gradeBand,
  percent,
  pluralise,
  qualityMeta,
} from '../lib/utils'
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  LoadingBlock,
  Panel,
  Progress,
  SectionHeading,
  Segmented,
  TextArea,
} from '../components/ui'
import { SourceNoteButton } from '../components/ReviewCard'

const GRADE_BUTTONS = [
  { q: 0, label: 'Blackout', hint: 'No idea' },
  { q: 1, label: 'Wrong', hint: 'Recalled incorrectly' },
  { q: 2, label: 'Shaky', hint: 'Familiar but broken' },
  { q: 3, label: 'Hard', hint: 'Right, with effort' },
  { q: 4, label: 'Good', hint: 'Comfortable recall' },
  { q: 5, label: 'Perfect', hint: 'Instant and precise' },
]

function gradeTone(q) {
  if (q >= 4) return 'border-good/40 bg-good/12 text-good hover:bg-good/22'
  if (q >= 2) return 'border-warn/40 bg-warn/12 text-warn hover:bg-warn/22'
  return 'border-bad/40 bg-bad/12 text-bad hover:bg-bad/22'
}

export default function Review() {
  const [searchParams] = useSearchParams()
  const { refreshStats, stats } = useAppData()

  const [cards, setCards] = useState([])
  const [queueInfo, setQueueInfo] = useState({ total_due: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [scope, setScope] = useState('all')
  const [practiceMode, setPracticeMode] = useState(false)

  const [index, setIndex] = useState(0)
  const [result, setResult] = useState(null)
  const [detail, setDetail] = useState(null)
  const [flipped, setFlipped] = useState(false)
  const [selected, setSelected] = useState(null)
  const [response, setResponse] = useState('')
  const [busy, setBusy] = useState(false)
  const [revealing, setRevealing] = useState(false)
  const [tally, setTally] = useState({ reviewed: 0, passed: 0, quality: 0 })
  const [startedAt] = useState(() => Date.now())

  const materialFilter = searchParams.get('material_id') || undefined
  const typeFilter = scope === 'all' ? undefined : scope

  /* ----------------------------- data loading ---------------------------- */
  const loadQueue = useCallback(
    async (mode = 'due') => {
      setLoading(true)
      setError(null)
      try {
        if (mode === 'practice') {
          const practice = await api.listCards({
            material_id: materialFilter,
            card_type: typeFilter,
            limit: 20,
          })
          setCards(practice ?? [])
          setQueueInfo({ total_due: practice?.length ?? 0 })
          setPracticeMode(true)
        } else {
          const queue = await api.queue({
            limit: 20,
            material_id: materialFilter,
            card_type: typeFilter,
          })
          setCards(queue?.cards ?? [])
          setQueueInfo({ total_due: queue?.total_due ?? 0 })
          setPracticeMode(false)
        }
        setIndex(0)
        setResult(null)
        setDetail(null)
        setFlipped(false)
        setSelected(null)
        setResponse('')
        setTally({ reviewed: 0, passed: 0, quality: 0 })
      } catch (err) {
        setError(err)
      } finally {
        setLoading(false)
      }
    },
    [materialFilter, typeFilter],
  )

  useEffect(() => {
    loadQueue('due')
  }, [loadQueue])

  const current = cards[index] ?? null
  const finished = !loading && !current && cards.length > 0
  const nothingToDo = !loading && !current && cards.length === 0

  /* ------------------------------- actions ------------------------------- */
  const submit = useCallback(
    async (payload) => {
      if (!current || busy) return
      setBusy(true)
      try {
        const res = await api.submitReview({ card_id: current.id, ...payload })
        setResult(res)
        setTally((t) => ({
          reviewed: t.reviewed + 1,
          passed: t.passed + (res.passed ? 1 : 0),
          quality: t.quality + res.quality,
        }))
        refreshStats()
      } catch (err) {
        toast.error(err.message, 'Could not submit review')
      } finally {
        setBusy(false)
      }
    },
    [current, busy, refreshStats],
  )

  const reveal = useCallback(async () => {
    if (!current) return
    if (current.card_type !== 'flashcard') {
      setFlipped(true)
      return
    }
    setFlipped(true)
    if (detail || revealing) return
    setRevealing(true)
    try {
      const full = await api.getCard(current.id)
      setDetail(full)
    } catch (err) {
      toast.error(err.message, 'Could not load the answer')
      setFlipped(false)
    } finally {
      setRevealing(false)
    }
  }, [current, detail, revealing])

  const advance = useCallback(() => {
    setResult(null)
    setDetail(null)
    setFlipped(false)
    setSelected(null)
    setResponse('')
    setIndex((i) => i + 1)
  }, [])

  /* ------------------------------ shortcuts ------------------------------ */
  const keyHandler = useRef(null)
  keyHandler.current = (event) => {
    if (busy) return
    const tag = event.target?.tagName?.toLowerCase()
    const typing = tag === 'textarea' || tag === 'input'

    if (event.key === 'Escape') {
      if (typing) event.target.blur()
      return
    }
    if (result) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        advance()
      }
      return
    }
    if (!current || typing) return

    if (current.card_type === 'flashcard') {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault()
        if (!flipped) reveal()
        return
      }
      if (flipped && /^[0-5]$/.test(event.key)) {
        event.preventDefault()
        submit({ quality: Number(event.key) })
      }
    } else if (current.card_type === 'mcq' && /^[1-4]$/.test(event.key)) {
      event.preventDefault()
      submit({ selected_option_index: Number(event.key) - 1 })
    }
  }

  useEffect(() => {
    const listener = (event) => keyHandler.current?.(event)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  /* -------------------------------- render ------------------------------- */
  const progress = cards.length ? (index / cards.length) * 100 : 0
  const elapsedMinutes = Math.max(1, Math.round((Date.now() - startedAt) / 60000))

  if (error && !cards.length) {
    return (
      <div className="space-y-4">
        <ErrorState error={error} onRetry={() => loadQueue('due')} />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* ------------------------------ header ----------------------------- */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-ink">
            <Brain className="size-6 text-brand-soft" />
            Review session
          </h1>
          <p className="mt-1 text-sm text-muted">
            {practiceMode
              ? 'Practice mode — reviews will still reschedule these cards.'
              : `SM-2 · ${pluralise(queueInfo.total_due, 'card')} due in total`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            size="sm"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'all', label: 'Mixed' },
              { value: 'flashcard', label: 'Concept', icon: Layers },
              { value: 'mcq', label: 'MCQ', icon: ListChecks },
              { value: 'open_ended', label: 'Open', icon: MessageSquareText },
            ]}
          />
          <Button
            variant="ghost"
            size="sm"
            icon={RotateCcw}
            loading={loading}
            onClick={() => loadQueue(practiceMode ? 'practice' : 'due')}
          >
            Reload
          </Button>
        </div>
      </div>

      {cards.length > 0 && (
        <Panel className="p-4">
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs font-medium text-muted">
              Card {Math.min(index + 1, cards.length)} of {cards.length}
            </span>
            <span className="text-xs tabular-nums text-faint">
              {tally.reviewed > 0
                ? `${tally.passed}/${tally.reviewed} passed · avg ${(tally.quality / tally.reviewed).toFixed(1)}`
                : 'Not started'}
            </span>
          </div>
          <Progress value={progress} className="mt-2.5" />
        </Panel>
      )}

      {loading ? (
        <Panel className="p-6">
          <LoadingBlock label="Building your queue…" />
        </Panel>
      ) : nothingToDo ? (
        <Panel>
          <EmptyState
            icon={CircleCheck}
            title="Nothing due right now"
            description={
              stats?.forecast?.length
                ? `Nice work. Your next batch lands ${dueLabel(stats.forecast?.[0]?.date)} — or practice ahead below.`
                : 'Generate some cards and they will appear here when they are due.'
            }
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="outline" icon={Eye} onClick={() => loadQueue('practice')}>
                  Practice ahead
                </Button>
                <Button as={Link} to="/deck" variant="ghost" icon={Layers}>
                  Browse deck
                </Button>
                <Button as={Link} to="/ingest" variant="primary" icon={Sparkles}>
                  Add material
                </Button>
              </div>
            }
          />
        </Panel>
      ) : finished ? (
        <SessionSummary
          tally={tally}
          total={cards.length}
          minutes={elapsedMinutes}
          onAgain={() => loadQueue('due')}
          onPractice={() => loadQueue('practice')}
        />
      ) : (
        <>
          <AnimatePresence mode="wait">
            <motion.div
              key={current.id}
              initial={{ opacity: 0, y: 16, scale: 0.99 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.99 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            >
              {current.card_type === 'flashcard' && (
                <FlashcardStage
                  card={current}
                  detail={detail}
                  flipped={flipped}
                  revealing={revealing}
                  busy={busy}
                  result={result}
                  onFlip={reveal}
                  onGrade={(quality) => submit({ quality })}
                />
              )}

              {current.card_type === 'mcq' && (
                <McqStage
                  card={current}
                  busy={busy}
                  result={result}
                  selected={selected}
                  onSelect={(optionIndex) => {
                    setSelected(optionIndex)
                    submit({ selected_option_index: optionIndex })
                  }}
                />
              )}

              {current.card_type === 'open_ended' && (
                <OpenEndedStage
                  card={current}
                  busy={busy}
                  result={result}
                  response={response}
                  onResponse={setResponse}
                  onSubmit={() => submit({ user_response: response })}
                />
              )}
            </motion.div>
          </AnimatePresence>

          {result && (
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
            >
              <ScheduleOutcome result={result} onNext={advance} isLast={index === cards.length - 1} />
            </motion.div>
          )}

          <p className="text-center text-[11px] text-faint">
            Shortcuts: <kbd className="font-mono">space</kbd> reveal ·{' '}
            <kbd className="font-mono">0–5</kbd> grade · <kbd className="font-mono">1–4</kbd> pick MCQ
            option · <kbd className="font-mono">enter</kbd> next
          </p>
        </>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------------------
 * Flashcard — 3D flip
 * ------------------------------------------------------------------------- */
function FlashcardStage({ card, detail, flipped, revealing, busy, result, onFlip, onGrade }) {
  const meta = cardTypeMeta(card.card_type)
  const Icon = meta.icon
  const back = detail?.back_answer

  return (
    <div className="space-y-4">
      <div className="perspective-card">
        <motion.div
          className="preserve-3d relative min-h-[20rem]"
          animate={{ rotateY: flipped ? 180 : 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* front */}
          <button
            type="button"
            onClick={onFlip}
            className="backface-hidden panel panel-glow flex min-h-[20rem] w-full cursor-pointer flex-col items-center justify-center rounded-3xl p-8 text-center transition-colors hover:border-brand/40"
          >
            <div className="flex flex-wrap items-center justify-center gap-2">
              <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium', meta.chip)}>
                <Icon className="size-3" />
                {meta.label}
              </span>
              {card.overdue_days > 0 && (
                <Badge tone="bad" className="text-[10px]">
                  {card.overdue_days}d overdue
                </Badge>
              )}
              {card.material_title && (
                <Badge tone="neutral" className="text-[10px]">
                  {card.material_title}
                </Badge>
              )}
            </div>

            <p className="mt-7 max-w-2xl text-xl leading-snug font-medium text-ink sm:text-2xl">
              {card.front_prompt}
            </p>

            <span className="mt-8 inline-flex items-center gap-2 text-xs text-muted">
              <Eye className="size-3.5" />
              Click or press space to reveal the answer
            </span>
          </button>

          {/* back */}
          <div className="backface-hidden flip-y-180 panel panel-glow absolute inset-0 flex min-h-[20rem] flex-col overflow-y-auto rounded-3xl border-brand/30 p-8">
            <div className="flex items-center gap-2">
              <Badge tone="brand" icon={Check}>
                Answer
              </Badge>
              {detail?.tags?.slice(0, 3).map((tag) => (
                <Badge key={tag} tone="neutral" className="text-[10px]">
                  #{tag}
                </Badge>
              ))}
            </div>

            {revealing && !back ? (
              <div className="flex flex-1 items-center justify-center">
                <span className="inline-flex items-center gap-2 text-sm text-muted">
                  <LoaderCircle className="size-4 animate-spin text-brand-soft" />
                  Fetching answer…
                </span>
              </div>
            ) : (
              <>
                <p className="mt-4 text-base leading-relaxed whitespace-pre-line text-ink">
                  {back || '—'}
                </p>
                {detail?.source_excerpt && (
                  <p className="mt-4 border-l-2 border-brand/40 pl-3 text-xs leading-relaxed text-muted italic">
                    {detail.source_excerpt}
                  </p>
                )}
              </>
            )}
          </div>
        </motion.div>
      </div>

      {!result && (
        <Panel className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionHeading
              icon={Target}
              title={flipped ? 'How well did you recall it?' : 'Recall it first'}
              subtitle={
                flipped
                  ? 'Your rating decides the next interval via SM-2.'
                  : 'Say the answer out loud, then flip the card.'
              }
              className="flex-1"
            />
            {!flipped && (
              <Button variant="primary" icon={Eye} onClick={onFlip}>
                Reveal answer
              </Button>
            )}
          </div>

          {flipped && (
            <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
              {GRADE_BUTTONS.map((grade) => (
                <button
                  key={grade.q}
                  type="button"
                  disabled={busy}
                  onClick={() => onGrade(grade.q)}
                  title={grade.hint}
                  className={cn(
                    'flex flex-col items-center gap-0.5 rounded-xl border px-2 py-2.5 transition-colors disabled:opacity-50',
                    gradeTone(grade.q),
                  )}
                >
                  <span className="text-base font-semibold tabular-nums">{grade.q}</span>
                  <span className="text-[10px] leading-tight">{grade.label}</span>
                </button>
              ))}
            </div>
          )}
        </Panel>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------------------
 * MCQ
 * ------------------------------------------------------------------------- */
function McqStage({ card, busy, result, selected, onSelect }) {
  const meta = cardTypeMeta(card.card_type)
  const reveal = result?.answer_reveal
  const correctIndex = reveal?.correct_option_index

  return (
    <Panel className="p-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium', meta.chip)}>
          <ListChecks className="size-3" />
          {meta.label}
        </span>
        {card.material_title && (
          <Badge tone="neutral" className="text-[10px]">
            {card.material_title}
          </Badge>
        )}
        {!result && <Badge tone="accent" className="text-[10px]">Pick the best answer</Badge>}
      </div>

      <p className="mt-5 text-lg leading-snug font-medium text-ink">{card.front_prompt}</p>

      <div className="mt-5 space-y-2.5">
        {(card.options ?? []).map((option, optionIndex) => {
          const isCorrect = correctIndex === optionIndex
          const isChosen = selected === optionIndex
          const answered = Boolean(result)

          let classes = 'border-edge bg-panel-2/40 hover:border-brand/40 hover:bg-panel-2'
          if (answered) {
            if (isCorrect) classes = 'border-good/50 bg-good/10'
            else if (isChosen) classes = 'border-bad/50 bg-bad/10'
            else classes = 'border-edge bg-panel-2/30 opacity-60'
          }

          return (
            <button
              key={optionIndex}
              type="button"
              disabled={answered || busy}
              onClick={() => onSelect(optionIndex)}
              className={cn(
                'flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition-all',
                'disabled:cursor-default',
                classes,
              )}
            >
              <span
                className={cn(
                  'mt-0.5 grid size-6 shrink-0 place-items-center rounded-lg border text-xs font-semibold',
                  answered && isCorrect
                    ? 'border-good/50 bg-good/25 text-good'
                    : answered && isChosen
                      ? 'border-bad/50 bg-bad/25 text-bad'
                      : 'border-edge bg-panel-3/60 text-muted',
                )}
              >
                {answered && isCorrect ? (
                  <Check className="size-3.5" />
                ) : answered && isChosen ? (
                  <X className="size-3.5" />
                ) : (
                  String.fromCharCode(65 + optionIndex)
                )}
              </span>
              <span className="text-sm leading-relaxed text-ink/90">{option}</span>
            </button>
          )
        })}
      </div>

      {result && (
        <div className="mt-5 space-y-3 border-t border-edge-soft pt-4">
          <div className="flex items-center gap-2">
            <Badge tone={result.is_correct ? 'good' : 'bad'} icon={result.is_correct ? Check : X}>
              {result.is_correct ? 'Correct' : 'Incorrect'}
            </Badge>
            <Badge tone="neutral">Quality {result.quality}/5</Badge>
          </div>

          {reveal?.explanation && (
            <p className="rounded-xl border border-accent/25 bg-accent/6 p-3 text-sm leading-relaxed text-ink/85">
              <span className="mr-1.5 font-medium text-accent">Why:</span>
              {reveal.explanation}
            </p>
          )}

          {reveal?.distractor_explanations &&
            Object.keys(reveal.distractor_explanations).length > 0 && (
              <div className="rounded-xl border border-edge bg-panel-2/40 p-3">
                <p className="text-[11px] font-medium tracking-wide text-muted uppercase">
                  Common misconceptions
                </p>
                <ul className="mt-2 space-y-2">
                  {Object.entries(reveal.distractor_explanations).map(([optionIndex, why]) => (
                    <li key={optionIndex} className="flex items-start gap-2 text-xs leading-relaxed">
                      <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded border border-edge text-[10px] text-faint">
                        {String.fromCharCode(65 + Number(optionIndex))}
                      </span>
                      <span className="text-muted">{why}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

          {reveal?.source_excerpt && (
            <p className="border-l-2 border-brand/40 pl-3 text-xs leading-relaxed text-muted italic">
              {reveal.source_excerpt}
            </p>
          )}
        </div>
      )}
    </Panel>
  )
}

/* ---------------------------------------------------------------------------
 * Open-ended + Socratic grading
 * ------------------------------------------------------------------------- */
function OpenEndedStage({ card, busy, result, response, onResponse, onSubmit }) {
  const meta = cardTypeMeta(card.card_type)
  const evaluation = result?.evaluation
  const band = evaluation ? gradeBand(evaluation.grade) : null
  const wordCount = response.trim() ? response.trim().split(/\s+/).length : 0

  return (
    <Panel className="p-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium', meta.chip)}>
          <MessageSquareText className="size-3" />
          {meta.label}
        </span>
        {card.material_title && (
          <Badge tone="neutral" className="text-[10px]">
            {card.material_title}
          </Badge>
        )}
        <Badge tone="accent" className="text-[10px]">
          Graded Socratically against your notes
        </Badge>
        <SourceNoteButton card={card} className="ml-auto" />
      </div>

      <p className="mt-5 text-lg leading-snug font-medium text-ink">{card.front_prompt}</p>

      {!result ? (
        <div className="mt-5">
          <TextArea
            value={response}
            onChange={(e) => onResponse(e.target.value)}
            rows={8}
            autoFocus
            placeholder="Explain it in your own words — the more precise your terminology, the higher the grade. Write everything you remember; partial credit is real."
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-faint">
              {wordCount} word{wordCount === 1 ? '' : 's'} · aim for the key points, not length
            </span>
            <Button
              variant="primary"
              size="lg"
              icon={Send}
              loading={busy}
              disabled={response.trim().length < 2}
              onClick={onSubmit}
            >
              Submit for evaluation
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          <div className={cn('rounded-2xl border p-4', band.bg)}>
            <div className="flex items-center gap-3">
              <span className={cn('grid size-12 shrink-0 place-items-center rounded-xl border text-xl font-semibold tabular-nums', band.bg, band.tint)}>
                {evaluation.grade}
              </span>
              <div>
                <p className={cn('text-sm font-semibold', band.tint)}>{band.label}</p>
                <p className="text-xs text-muted">
                  SM-2 quality {evaluation.grade}/5 · {result.passed ? 'passed' : 'failed'}
                </p>
              </div>
              {result.offline_stub && (
                <Badge tone="warn" className="ml-auto text-[10px]">
                  offline grader
                </Badge>
              )}
            </div>
            {evaluation.socratic_feedback && (
              <p className="mt-3.5 flex items-start gap-2 text-sm leading-relaxed text-ink/90">
                <Lightbulb className="mt-0.5 size-4 shrink-0 text-warn" />
                {evaluation.socratic_feedback}
              </p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-good/25 bg-good/6 p-3.5">
              <p className="text-[11px] font-medium tracking-wide text-good uppercase">
                You nailed ({evaluation.matched_points?.length ?? 0})
              </p>
              <ul className="mt-2 space-y-1.5">
                {(evaluation.matched_points ?? []).map((point, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs leading-relaxed text-ink/85">
                    <Check className="mt-0.5 size-3 shrink-0 text-good" />
                    {point}
                  </li>
                ))}
                {!evaluation.matched_points?.length && (
                  <li className="text-xs text-faint">Nothing matched yet — read the feedback above.</li>
                )}
              </ul>
            </div>

            <div className="rounded-xl border border-bad/25 bg-bad/6 p-3.5">
              <p className="text-[11px] font-medium tracking-wide text-bad uppercase">
                Missing nuances ({evaluation.missing_nuances?.length ?? 0})
              </p>
              <ul className="mt-2 space-y-1.5">
                {(evaluation.missing_nuances ?? []).map((point, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs leading-relaxed text-ink/85">
                    <X className="mt-0.5 size-3 shrink-0 text-bad" />
                    {point}
                  </li>
                ))}
                {!evaluation.missing_nuances?.length && (
                  <li className="text-xs text-faint">Nothing missing. Excellent recall.</li>
                )}
              </ul>
            </div>
          </div>

          <div className="rounded-xl border border-edge bg-panel-2/40 p-3.5">
            <p className="text-[11px] font-medium tracking-wide text-muted uppercase">Your answer</p>
            <p className="mt-1.5 text-xs leading-relaxed whitespace-pre-line text-ink/80">
              {result.user_response}
            </p>
          </div>

          {result.answer_reveal?.rubric?.length > 0 && (
            <div className="rounded-xl border border-brand/25 bg-brand/6 p-3.5">
              <p className="text-[11px] font-medium tracking-wide text-brand-soft uppercase">
                Rubric used for grading
              </p>
              <ul className="mt-2 space-y-1.5">
                {result.answer_reveal.rubric.map((point, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs leading-relaxed text-ink/85">
                    <Target className="mt-0.5 size-3 shrink-0 text-brand-soft" />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.answer_reveal?.model_answer && (
            <details className="rounded-xl border border-edge bg-panel-2/40 p-3.5">
              <summary className="cursor-pointer text-xs font-medium text-muted transition-colors hover:text-ink">
                Show model answer
              </summary>
              <p className="mt-2.5 text-sm leading-relaxed whitespace-pre-line text-ink/85">
                {result.answer_reveal.model_answer}
              </p>
            </details>
          )}
        </div>
      )}
    </Panel>
  )
}

/* ---------------------------------------------------------------------------
 * Post-answer scheduling feedback
 * ------------------------------------------------------------------------- */
function ScheduleOutcome({ result, onNext, isLast }) {
  const meta = qualityMeta(result.quality)
  return (
    <Panel className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-xl border border-edge bg-panel-2 text-sm font-semibold tabular-nums text-ink">
              {result.quality}
            </span>
            <div>
              <p className={cn('text-sm font-medium', meta.tint)}>{meta.label}</p>
              <p className="text-[11px] text-faint">SM-2 quality rating</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <span className="flex items-center gap-1.5">
              <CalendarDays className="size-3.5" />
              Next {dueLabel(result.next_review_date)}
            </span>
            <span className="flex items-center gap-1.5">
              <Zap className="size-3.5" />
              Interval {result.interval}d
            </span>
            <span className="flex items-center gap-1.5">
              <Gauge className="size-3.5" />
              EF {result.ease_factor.toFixed(2)}
            </span>
            <span className="flex items-center gap-1.5">
              <Layers className="size-3.5" />
              n={result.repetition}
            </span>
          </div>
        </div>

        <Button variant="primary" iconRight={ArrowRight} onClick={onNext} autoFocus>
          {isLast ? 'Finish session' : 'Next card'}
        </Button>
      </div>
    </Panel>
  )
}

/* ---------------------------------------------------------------------------
 * Session summary
 * ------------------------------------------------------------------------- */
function SessionSummary({ tally, total, minutes, onAgain, onPractice }) {
  const accuracy = tally.reviewed ? tally.passed / tally.reviewed : 0
  const average = tally.reviewed ? tally.quality / tally.reviewed : 0

  return (
    <Panel className="p-8 text-center">
      <motion.span
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 18 }}
        className="mx-auto grid size-16 place-items-center rounded-2xl border border-good/35 bg-good/12 text-good"
      >
        <Trophy className="size-8" />
      </motion.span>

      <h2 className="mt-4 text-xl font-semibold text-ink">Session complete</h2>
      <p className="mt-1 text-sm text-muted">
        You reviewed {pluralise(tally.reviewed, 'card')} in about {pluralise(minutes, 'minute')}.
      </p>

      <div className="mx-auto mt-6 grid max-w-lg grid-cols-3 gap-3">
        <SummaryStat icon={Target} label="Accuracy" value={percent(accuracy)} tone="good" />
        <SummaryStat icon={Gauge} label="Avg. quality" value={average.toFixed(1)} tone="accent" />
        <SummaryStat icon={Flame} label="Reviewed" value={`${tally.reviewed}/${total}`} tone="warn" />
      </div>

      <div className="mt-7 flex flex-wrap justify-center gap-2">
        <Button variant="primary" icon={Play} onClick={onAgain}>
          Check for more due
        </Button>
        <Button variant="outline" icon={Eye} onClick={onPractice}>
          Practice ahead
        </Button>
        <Button as={Link} to="/" variant="ghost" icon={ChevronLeft}>
          Dashboard
        </Button>
      </div>
    </Panel>
  )
}

function SummaryStat({ icon: Icon, label, value, tone }) {
  const tones = {
    good: 'text-good border-good/25 bg-good/10',
    accent: 'text-accent border-accent/25 bg-accent/10',
    warn: 'text-warn border-warn/25 bg-warn/10',
  }
  return (
    <div className="rounded-xl border border-edge bg-panel-2/40 p-3.5">
      <span className={cn('mx-auto grid size-8 place-items-center rounded-lg border', tones[tone])}>
        <Icon className="size-4" />
      </span>
      <p className="mt-2.5 text-xl font-semibold tabular-nums text-ink">{value}</p>
      <p className="text-[11px] text-muted">{label}</p>
    </div>
  )
}
