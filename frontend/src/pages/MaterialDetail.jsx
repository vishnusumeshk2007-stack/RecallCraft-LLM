import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft,
  BookOpen,
  Boxes,
  ChevronLeft,
  Info,
  Layers,
  ListChecks,
  MessageSquareText,
  Package,
  Sparkles,
  Trash2,
  Wand2,
  Zap,
} from 'lucide-react'
import api from '../lib/api'
import { toast, useAsync } from '../lib/hooks'
import { useAppData } from '../lib/store'
import { cardTypeMeta, formatDate, parseDate, pluralise, readableSourceType, truncate } from '../lib/utils'
import CardPreview from '../components/CardPreview'
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  LoadingBlock,
  Panel,
  SectionHeading,
  Segmented,
  Select,
  Stat,
  Switch,
  TextInput,
} from '../components/ui'

const PRESETS = {
  balanced: { concept_cards: 4, diagnostic_mcqs: 4, open_ended_questions: 2, per_chunk: 2 },
  concept: { concept_cards: 8, diagnostic_mcqs: 2, open_ended_questions: 1, per_chunk: 2 },
  quiz: { concept_cards: 2, diagnostic_mcqs: 8, open_ended_questions: 3, per_chunk: 2 },
  socratic: { concept_cards: 2, diagnostic_mcqs: 2, open_ended_questions: 6, per_chunk: 1 },
}

export default function MaterialDetail() {
  const { materialId } = useParams()
  const navigate = useNavigate()
  const { refreshStats } = useAppData()

  const [tab, setTab] = useState('cards')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const {
    data: material,
    loading,
    error,
    reload,
  } = useAsync(() => api.getMaterial(materialId), [materialId])

  const { data: cards, reload: reloadCards } = useAsync(
    () => api.listCards({ material_id: materialId, limit: 500 }),
    [materialId],
    { initial: [] },
  )

  async function handleExport() {
    setExporting(true)
    try {
      const { blob, filename } = await api.exportAnki(materialId)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      toast.success('Open the file with File → Import in Anki.', 'Deck exported')
    } catch (err) {
      toast.error(err.message, 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await api.deleteMaterial(materialId)
      toast.success('Material and its cards were deleted.', 'Removed')
      await refreshStats()
      navigate('/library')
    } catch (err) {
      toast.error(err.message, 'Delete failed')
      setDeleting(false)
    }
  }

  if (loading && !material) {
    return (
      <Panel className="p-6">
        <LoadingBlock label="Loading material…" />
      </Panel>
    )
  }

  if (error && !material) {
    return (
      <div className="space-y-4">
        <Button as={Link} to="/library" variant="ghost" size="sm" icon={ChevronLeft}>
          Back to library
        </Button>
        <ErrorState error={error} onRetry={() => reload()} />
      </div>
    )
  }

  if (!material) return null

  const chunks = material.chunks ?? []
  const dueCount =
    cards?.filter((c) => {
      const due = parseDate(c.review_state?.next_review_date)
      return due ? due.getTime() <= Date.now() : false
    }).length ?? 0

  return (
    <div className="space-y-5">
      <Link
        to="/library"
        className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink"
      >
        <ArrowLeft className="size-4" />
        Library
      </Link>

      <Panel className="relative overflow-hidden p-5">
        <div className="pointer-events-none absolute -top-20 -right-10 size-52 rounded-full bg-brand/15 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="brand">{readableSourceType(material.source_type)}</Badge>
              <Badge tone="neutral">{formatDate(material.created_at)}</Badge>
              {material.due_count > 0 && <Badge tone="accent">{material.due_count} due</Badge>}
            </div>
            <h1 className="mt-2.5 text-xl font-semibold tracking-tight text-ink sm:text-2xl">
              {material.title}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {material.char_count.toLocaleString()} characters · {pluralise(chunks.length, 'chunk')} ·{' '}
              {pluralise(material.card_count, 'card')}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              as={Link}
              to="/review"
              variant="outline"
              icon={Zap}
              disabled={material.due_count === 0}
            >
              Review due
            </Button>
            <Button
              variant="outline"
              icon={Package}
              loading={exporting}
              disabled={!material.card_count}
              onClick={handleExport}
              title={
                material.card_count
                  ? 'Download these cards as an Anki .apkg deck'
                  : 'Generate cards before exporting'
              }
            >
              Export .apkg
            </Button>
            <Button variant="danger" icon={Trash2} onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          </div>
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Chunks" value={chunks.length} icon={Boxes} tone="accent" />
        <Stat label="Cards" value={material.card_count} icon={Layers} tone="brand" />
        <Stat
          label="Due now"
          value={material.due_count}
          hint={`${dueCount} in loaded page`}
          icon={Zap}
          tone="warn"
        />
      </div>

      <GenerationPanel
        materialId={materialId}
        chunks={chunks}
        onGenerated={async () => {
          await Promise.all([reload(), reloadCards(), refreshStats()])
          setTab('cards')
        }}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'cards', label: `Cards (${cards?.length ?? 0})`, icon: Layers },
            { value: 'chunks', label: `Chunks (${chunks.length})`, icon: Boxes },
            { value: 'source', label: 'Source', icon: BookOpen },
          ]}
        />
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.2 }}
        >
          {tab === 'cards' && (
            <CardList cards={cards ?? []} onDeleted={async () => { await reloadCards(); await refreshStats() }} />
          )}

          {tab === 'chunks' && (
            <div className="space-y-3">
              {chunks.map((chunk) => (
                <Panel key={chunk.id} className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <Badge tone="neutral">Chunk #{chunk.ordinal + 1}</Badge>
                    <span className="text-[11px] text-faint">
                      {chunk.content.length.toLocaleString()} chars
                      {chunk.embedding_backend && ` · ${chunk.embedding_backend} vectors`}
                    </span>
                  </div>
                  <p className="mt-2.5 text-sm leading-relaxed whitespace-pre-line text-ink/85">
                    {chunk.content}
                  </p>
                </Panel>
              ))}
              {!chunks.length && (
                <Panel>
                  <EmptyState icon={Boxes} title="No chunks" description="This material has no indexed chunks." />
                </Panel>
              )}
            </div>
          )}

          {tab === 'source' && (
            <Panel className="p-5">
              <SectionHeading
                icon={BookOpen}
                title="Extracted source text"
                subtitle="What was stored after extraction and cleaning."
              />
              <pre className="mt-4 max-h-[32rem] overflow-auto rounded-xl border border-edge bg-canvas/60 p-4 text-xs leading-relaxed whitespace-pre-wrap text-ink/80">
                {material.raw_content}
              </pre>
            </Panel>
          )}
        </motion.div>
      </AnimatePresence>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
        loading={deleting}
        title={`Delete “${material.title}”?`}
        description="Every generated card and its review history will be removed."
        confirmLabel="Delete material"
      />
    </div>
  )
}

/* ---------------------------------------------------------------------------
 * Generation controls
 * ------------------------------------------------------------------------- */
function GenerationPanel({ materialId, chunks, onGenerated }) {
  const [counts, setCounts] = useState(PRESETS.balanced)
  const [preset, setPreset] = useState('balanced')
  const [selected, setSelected] = useState(() => new Set(chunks.map((c) => c.id)))
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  // Keep the selection in sync the first time chunks arrive.
  useEffect(() => {
    if (chunks.length && selected.size === 0) {
      setSelected(new Set(chunks.map((c) => c.id)))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chunks.length])

  const allSelected = selected.size === chunks.length && chunks.length > 0
  const totalRequested = counts.concept_cards + counts.diagnostic_mcqs + counts.open_ended_questions
  const perChunkTotal =
    (counts.concept_cards ? 1 : 0) + (counts.diagnostic_mcqs ? 1 : 0) + (counts.open_ended_questions ? 1 : 0)

  function applyPreset(key) {
    setPreset(key)
    setCounts(PRESETS[key])
  }

  const chunkSummary = useMemo(() => {
    if (allSelected) return 'All chunks'
    if (selected.size === 0) return 'No chunks selected'
    return `${selected.size} of ${chunks.length} chunks`
  }, [allSelected, selected.size, chunks.length])

  async function generate() {
    if (!totalRequested || selected.size === 0) return
    setBusy(true)
    setResult(null)
    try {
      const payload = {
        ...counts,
        chunk_ids: allSelected ? null : [...selected],
      }
      const response = await api.generate(materialId, payload)
      setResult(response)
      const created = response.created?.length ?? 0
      if (created > 0) {
        toast.success(
          `Created ${pluralise(created, 'card')}${response.skipped_duplicates ? ` · skipped ${response.skipped_duplicates} duplicates` : ''} using ${response.provider}.`,
          'Generation complete',
        )
      } else {
        toast.warn(
          `No new cards — ${pluralise(response.skipped_duplicates, 'item')} already existed in this deck.`,
          'Nothing new',
        )
      }
      await onGenerated()
    } catch (err) {
      toast.error(err.message, 'Generation failed')
    } finally {
      setBusy(false)
    }
  }

  if (!chunks.length) {
    return (
      <Panel>
        <EmptyState
          icon={Info}
          title="No chunks to generate from"
          description="This material produced no usable text chunks, so cards cannot be generated."
        />
      </Panel>
    )
  }

  return (
    <Panel className="p-5">
      <SectionHeading
        icon={Wand2}
        title="Generate review items"
        subtitle="Pydantic-validated JSON straight from the LLM — no malformed cards reach your deck."
        action={
          <Badge tone={counts.per_chunk > 1 ? 'accent' : 'neutral'}>
            {counts.per_chunk} per chunk
          </Badge>
        }
      />

      <div className="mt-4 flex flex-wrap gap-2">
        {Object.keys(PRESETS).map((key) => (
          <Button
            key={key}
            size="xs"
            variant={preset === key ? 'primary' : 'outline'}
            onClick={() => applyPreset(key)}
            className="capitalize"
          >
            {key}
          </Button>
        ))}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="grid gap-3 sm:grid-cols-3">
          <CountField
            icon={Layers}
            label="Concept cards"
            value={counts.concept_cards}
            onChange={(v) => {
              setCounts((c) => ({ ...c, concept_cards: v }))
              setPreset('custom')
            }}
          />
          <CountField
            icon={ListChecks}
            label="Diagnostic MCQs"
            value={counts.diagnostic_mcqs}
            onChange={(v) => {
              setCounts((c) => ({ ...c, diagnostic_mcqs: v }))
              setPreset('custom')
            }}
          />
          <CountField
            icon={MessageSquareText}
            label="Open-ended"
            value={counts.open_ended_questions}
            onChange={(v) => {
              setCounts((c) => ({ ...c, open_ended_questions: v }))
              setPreset('custom')
            }}
          />
        </div>

        <div className="space-y-4">
          <Field label="Items per chunk" hint="How many of each type each chunk is asked for.">
            <Select
              value={counts.per_chunk}
              onChange={(e) => setCounts((c) => ({ ...c, per_chunk: Number(e.target.value) }))}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n} per type
                </option>
              ))}
            </Select>
          </Field>

          <div className="rounded-xl border border-edge bg-panel-2/40 p-3.5">
            <Switch
              checked={allSelected}
              onChange={(next) =>
                setSelected(next ? new Set(chunks.map((c) => c.id)) : new Set())
              }
              label="Use every chunk"
              description={chunkSummary}
            />
          </div>
        </div>
      </div>

      {!allSelected && (
        <div className="mt-4 max-h-52 space-y-1.5 overflow-y-auto rounded-xl border border-edge bg-canvas/40 p-3">
          {chunks.map((chunk) => {
            const checked = selected.has(chunk.id)
            return (
              <label
                key={chunk.id}
                className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-panel-2/60"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    setSelected((current) => {
                      const next = new Set(current)
                      if (checked) next.delete(chunk.id)
                      else next.add(chunk.id)
                      return next
                    })
                  }
                  className="mt-0.5 size-3.5 shrink-0 accent-[#7c6cff]"
                />
                <span className="min-w-0 text-xs leading-relaxed text-muted">
                  <span className="mr-1.5 font-mono text-faint">#{chunk.ordinal + 1}</span>
                  {truncate(chunk.content, 140)}
                </span>
              </label>
            )
          })}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-edge-soft pt-4">
        <p className="text-xs text-faint">
          {totalRequested} items across {selected.size} chunk{selected.size === 1 ? '' : 's'} · up to{' '}
          {perChunkTotal * counts.per_chunk} per chunk
        </p>
        <Button
          variant="primary"
          size="lg"
          icon={Sparkles}
          loading={busy}
          disabled={!totalRequested || selected.size === 0}
          onClick={generate}
        >
          Generate cards
        </Button>
      </div>

      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-4 rounded-xl border border-brand/25 bg-brand/6 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="good" icon={Package}>
                  {result.created?.length ?? 0} created
                </Badge>
                {result.skipped_duplicates > 0 && (
                  <Badge tone="warn">{result.skipped_duplicates} duplicates skipped</Badge>
                )}
                <Badge tone="neutral">{result.chunks_processed} chunks processed</Badge>
                <Badge tone={result.offline_stub ? 'warn' : 'brand'}>
                  {result.offline_stub ? 'offline engine' : `${result.provider} · ${result.model}`}
                </Badge>
              </div>
              {result.notes?.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {result.notes.map((note, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-muted">
                      <Info className="mt-0.5 size-3 shrink-0 text-accent" />
                      {note}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Panel>
  )
}

function CountField({ icon: Icon, label, value, onChange }) {
  return (
    <div className="rounded-xl border border-edge bg-panel-2/40 p-3.5">
      <span className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted uppercase">
        <Icon className="size-3.5" />
        {label}
      </span>
      <div className="mt-2.5 flex items-center gap-2">
        <input
          type="range"
          min={0}
          max={20}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-panel-3 accent-[#7c6cff]"
        />
        <TextInput
          type="number"
          min={0}
          max={60}
          value={value}
          onChange={(e) => onChange(Math.max(0, Math.min(60, Number(e.target.value) || 0)))}
          className="h-8 w-14 px-2 text-center text-sm tabular-nums"
        />
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------------------
 * Generated cards
 * ------------------------------------------------------------------------- */
function CardList({ cards, onDeleted }) {
  const [typeFilter, setTypeFilter] = useState('all')

  const filtered = useMemo(
    () => (typeFilter === 'all' ? cards : cards.filter((c) => c.card_type === typeFilter)),
    [cards, typeFilter],
  )

  async function remove(card) {
    try {
      await api.deleteCard(card.id)
      toast.success('Card deleted.', 'Removed')
      await onDeleted()
    } catch (err) {
      toast.error(err.message, 'Delete failed')
    }
  }

  if (!cards.length) {
    return (
      <Panel>
        <EmptyState
          icon={Sparkles}
          title="No cards generated yet"
          description="Pick how many concept cards, MCQs and open-ended prompts you want, then hit Generate."
        />
      </Panel>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          size="sm"
          value={typeFilter}
          onChange={setTypeFilter}
          options={[
            { value: 'all', label: `All ${cards.length}` },
            ...['flashcard', 'mcq', 'open_ended'].map((type) => ({
              value: type,
              label: `${cardTypeMeta(type).short} ${cards.filter((c) => c.card_type === type).length}`,
            })),
          ]}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((card) => (
          <CardPreview key={card.id} card={card} onDelete={() => remove(card)} />
        ))}
      </div>
    </div>
  )
}
