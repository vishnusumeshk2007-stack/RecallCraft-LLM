/**
 * ReviewCard.tsx — chunk lineage affordance for review cards.
 *
 * The card surfaces themselves live in `pages/Review.jsx`; this module provides
 * the "View Source Note" button plus its side drawer, which surfaces the raw
 * document chunk and the originating filename behind a card. Backed by
 * `GET /api/cards/{id}/lineage`.
 */

import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CircleAlert, FileText, LoaderCircle, Quote, X } from 'lucide-react'
import api from '../lib/api'
import { cn, readableSourceType } from '../lib/utils'

export interface CardLineage {
  card_id: string
  card_type: string
  material_id: string
  material_title: string
  source_filename: string | null
  source_type: string | null
  chunk_id: string | null
  chunk_ordinal: number | null
  chunk_text: string | null
  source_excerpt: string | null
  total_chunks: number
}

interface SourceNoteCard {
  id: string
  card_type?: string
  material_title?: string | null
}

interface SourceNoteButtonProps {
  card: SourceNoteCard
  className?: string
}

interface SourceNoteDrawerProps {
  open: boolean
  onClose: () => void
  card: SourceNoteCard | null
  lineage: CardLineage | null
  loading: boolean
  error: string | null
}

/**
 * "View Source Note" trigger. Fetches the lineage lazily on first open and
 * hands it to the drawer.
 */
export function SourceNoteButton({ card, className }: SourceNoteButtonProps) {
  const [open, setOpen] = useState(false)
  const [lineage, setLineage] = useState<CardLineage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (lineage || loading) return
    setLoading(true)
    setError(null)
    try {
      setLineage((await api.cardLineage(card.id)) as CardLineage)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this card’s source note.')
    } finally {
      setLoading(false)
    }
  }, [card.id, lineage, loading])

  function openDrawer() {
    setOpen(true)
    load()
  }

  return (
    <>
      <button
        type="button"
        onClick={openDrawer}
        title="See the document chunk this card was generated from"
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border border-edge bg-panel-2/60',
          'px-2.5 py-0.5 text-[11px] font-medium text-muted transition-colors',
          'hover:border-brand/40 hover:text-ink',
          className,
        )}
      >
        <Quote className="size-3" />
        View Source Note
      </button>

      <SourceNoteDrawer
        open={open}
        onClose={() => setOpen(false)}
        card={card}
        lineage={lineage}
        loading={loading}
        error={error}
      />
    </>
  )
}

/** Right-hand drawer showing the raw chunk text + source filename. */
export function SourceNoteDrawer({
  open,
  onClose,
  card,
  lineage,
  loading,
  error,
}: SourceNoteDrawerProps) {
  useEffect(() => {
    if (!open) return
    // Capture phase so the review session's global shortcuts (space/0-5) do not
    // grade the card behind the drawer while it is open.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      e.stopPropagation()
    }
    document.addEventListener('keydown', onKey, true)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = previous
    }
  }, [open, onClose])

  const filename = lineage?.source_filename || null
  const chunkLabel =
    lineage?.chunk_ordinal !== null && lineage?.chunk_ordinal !== undefined
      ? `Chunk ${lineage.chunk_ordinal + 1}${lineage.total_chunks ? ` of ${lineage.total_chunks}` : ''}`
      : null

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <motion.div
            className="fixed inset-0 bg-canvas/80 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label="Source note"
            className="panel panel-glow fixed inset-y-0 right-0 z-10 flex w-full max-w-md flex-col border-l border-edge-soft"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
          >
            <header className="flex items-start justify-between gap-4 border-b border-edge-soft p-5">
              <div className="flex min-w-0 items-start gap-3">
                <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border border-brand/25 bg-brand/10 text-brand-soft">
                  <FileText className="size-4.5" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-ink">Source note</h2>
                  <p className="mt-0.5 truncate text-sm text-muted">
                    {lineage?.material_title || card?.material_title || 'Where this card came from'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close source note"
                className="text-faint transition-colors hover:text-ink"
              >
                <X className="size-4" />
              </button>
            </header>

            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              {loading && (
                <span className="flex items-center gap-2 text-sm text-muted">
                  <LoaderCircle className="size-4 animate-spin text-brand-soft" />
                  Loading the source chunk…
                </span>
              )}

              {error && !loading && (
                <div className="flex items-start gap-2.5 rounded-xl border border-bad/30 bg-bad/8 p-3">
                  <CircleAlert className="mt-0.5 size-4 shrink-0 text-bad" />
                  <p className="text-sm text-muted">{error}</p>
                </div>
              )}

              {!loading && !error && lineage && (
                <>
                  <div className="rounded-xl border border-edge bg-panel-2/40 p-3.5">
                    <p className="text-[11px] font-medium tracking-wide text-muted uppercase">
                      Source file
                    </p>
                    <p className="mt-1.5 flex items-center gap-2 text-sm font-medium break-all text-ink">
                      <FileText className="size-3.5 shrink-0 text-brand-soft" />
                      {filename || 'Pasted text — no file was uploaded'}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-faint">
                      <span>{readableSourceType(lineage.source_type ?? 'text')}</span>
                      {chunkLabel && <span>· {chunkLabel}</span>}
                    </div>
                  </div>

                  {lineage.chunk_text ? (
                    <div>
                      <p className="text-[11px] font-medium tracking-wide text-muted uppercase">
                        Raw document chunk
                      </p>
                      <p className="mt-2 max-h-[26rem] overflow-y-auto rounded-xl border border-edge bg-canvas/60 p-3.5 text-xs leading-relaxed whitespace-pre-wrap text-ink/85">
                        {lineage.chunk_text}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted">
                      This card is no longer linked to a stored chunk — the material may have been
                      re-ingested.
                    </p>
                  )}

                  {lineage.source_excerpt && (
                    <div>
                      <p className="text-[11px] font-medium tracking-wide text-muted uppercase">
                        Quoted in this card
                      </p>
                      <p className="mt-2 border-l-2 border-brand/40 pl-3 text-xs leading-relaxed text-muted italic">
                        {lineage.source_excerpt}
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>

            <footer className="border-t border-edge-soft p-5">
              <p className="text-[11px] leading-relaxed text-faint">
                Every card keeps a link back to the chunk it was generated from, so you can always
                check the original wording.
              </p>
            </footer>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  )
}

export default SourceNoteButton
