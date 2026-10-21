import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Check,
  ChevronDown,
  Clock,
  Eye,
  Layers,
  Lightbulb,
  Quote,
  Trash2,
  Zap,
} from 'lucide-react'
import { cn, cardTypeMeta, dueLabel } from '../lib/utils'
import { Badge, IconButton } from './ui'

/**
 * Read-only card viewer used in the deck browser and on material pages.
 * The answer is hidden behind a reveal so the browser doubles as a study aid.
 */
export default function CardPreview({ card, onDelete, defaultRevealed = false }) {
  const [revealed, setRevealed] = useState(defaultRevealed)
  const [showSource, setShowSource] = useState(false)
  const meta = cardTypeMeta(card.card_type)
  const Icon = meta.icon
  const state = card.review_state

  return (
    <div className="panel panel-glow flex h-full flex-col rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium', meta.chip)}>
            <Icon className="size-3" />
            {meta.label}
          </span>
          {card.tags?.slice(0, 3).map((tag) => (
            <Badge key={tag} tone="neutral" className="text-[10px]">
              #{tag}
            </Badge>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <IconButton
            label={revealed ? 'Hide answer' : 'Reveal answer'}
            icon={Eye}
            size="xs"
            onClick={() => setRevealed((v) => !v)}
            className={revealed ? 'text-brand-soft' : ''}
          />
          {onDelete && (
            <IconButton
              label="Delete card"
              icon={Trash2}
              size="xs"
              onClick={onDelete}
              className="hover:text-bad"
            />
          )}
        </div>
      </div>

      <p className="mt-3 text-sm leading-relaxed font-medium text-ink">{card.front_prompt}</p>

      <AnimatePresence initial={false}>
        {revealed && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-3 border-t border-edge-soft pt-3">
              <McqBody card={card} />
              {card.card_type !== 'mcq' && (
                <p className="text-sm leading-relaxed whitespace-pre-line text-ink/85">
                  {card.back_answer || '—'}
                </p>
              )}

              {card.rubric?.length > 0 && (
                <div className="mt-3 rounded-xl border border-edge bg-panel-2/50 p-3">
                  <p className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted uppercase">
                    <Lightbulb className="size-3" /> Rubric
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {card.rubric.map((point, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-muted">
                        <Check className="mt-0.5 size-3 shrink-0 text-good" />
                        {point}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {card.model_answer && (
                <div className="mt-3 rounded-xl border border-good/25 bg-good/6 p-3">
                  <p className="text-[11px] font-medium tracking-wide text-good uppercase">
                    Model answer
                  </p>
                  <p className="mt-1.5 text-xs leading-relaxed text-ink/85">{card.model_answer}</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!revealed && (
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className="mt-3 text-left text-xs text-brand-soft transition-colors hover:text-brand"
        >
          Reveal answer
        </button>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-edge-soft pt-3 text-[11px] text-faint">
        {state ? (
          <>
            <span className="flex items-center gap-1">
              <Clock className="size-3" />
              {dueLabel(state.next_review_date)}
            </span>
            <span className="flex items-center gap-1">
              <Zap className="size-3" />
              EF {state.ease_factor.toFixed(2)}
            </span>
            <span className="flex items-center gap-1">
              <Layers className="size-3" />
              n={state.repetition} · I={state.interval}d
            </span>
            {state.last_reviewed_at && (
              <Badge tone="brand" className="text-[10px]">
                {state.total_reviews} reviews
              </Badge>
            )}
          </>
        ) : (
          <Badge tone="brand" className="text-[10px]">
            New — never reviewed
          </Badge>
        )}
        {card.source_excerpt && (
          <button
            type="button"
            onClick={() => setShowSource((v) => !v)}
            className="ml-auto flex items-center gap-1 transition-colors hover:text-muted"
          >
            <Quote className="size-3" />
            Source
            <ChevronDown className={cn('size-3 transition-transform', showSource && 'rotate-180')} />
          </button>
        )}
      </div>

      <AnimatePresence initial={false}>
        {showSource && card.source_excerpt && (
          <motion.blockquote
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-3 overflow-hidden border-l-2 border-brand/40 bg-panel-2/40 px-3 py-2 text-xs leading-relaxed text-muted italic"
          >
            {card.source_excerpt}
          </motion.blockquote>
        )}
      </AnimatePresence>
    </div>
  )
}

function McqBody({ card }) {
  if (card.card_type !== 'mcq' || !card.options?.length) return null
  const correct = card.correct_option_index

  return (
    <div className="space-y-2">
      {card.options.map((option, index) => {
        const isCorrect = index === correct
        const distractor = card.distractor_explanations?.[String(index)]
        return (
          <div
            key={index}
            className={cn(
              'rounded-xl border px-3 py-2',
              isCorrect ? 'border-good/40 bg-good/8' : 'border-edge bg-panel-2/40',
            )}
          >
            <div className="flex items-start gap-2">
              <span
                className={cn(
                  'mt-0.5 grid size-4.5 shrink-0 place-items-center rounded-full border text-[10px] font-semibold',
                  isCorrect ? 'border-good/50 bg-good/20 text-good' : 'border-edge text-faint',
                )}
              >
                {String.fromCharCode(65 + index)}
              </span>
              <span className={cn('text-xs leading-relaxed', isCorrect ? 'text-good' : 'text-ink/80')}>
                {option}
              </span>
            </div>
            {distractor && (
              <p className="mt-1.5 pl-6.5 text-[11px] leading-relaxed text-faint">
                Why it’s wrong: {distractor}
              </p>
            )}
          </div>
        )
      })}
      {card.explanation && (
        <p className="rounded-xl border border-accent/25 bg-accent/6 px-3 py-2 text-xs leading-relaxed text-ink/85">
          {card.explanation}
        </p>
      )}
    </div>
  )
}
