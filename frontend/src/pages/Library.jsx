import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  FileText,
  Layers,
  Library as LibraryIcon,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react'
import api from '../lib/api'
import { toast, useAsync, useDebounced } from '../lib/hooks'
import { useAppData } from '../lib/store'
import { formatDate, pluralise, readableSourceType } from '../lib/utils'
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  LoadingBlock,
  Panel,
  TextInput,
} from '../components/ui'

const SOURCE_ICON = { pdf: FileText, markdown: BookOpen, text: FileText }

export default function Library() {
  const { refreshStats } = useAppData()
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounced(search, 200)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const {
    data: materials,
    loading,
    error,
    reload,
  } = useAsync(() => api.listMaterials({ limit: 200 }), [], { initial: [] })

  const filtered = useMemo(() => {
    const needle = debouncedSearch.trim().toLowerCase()
    if (!needle) return materials ?? []
    return (materials ?? []).filter(
      (material) =>
        material.title.toLowerCase().includes(needle) ||
        material.source_type?.toLowerCase().includes(needle),
    )
  }, [materials, debouncedSearch])

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await api.deleteMaterial(pendingDelete.id)
      toast.success(`Deleted “${pendingDelete.title}”.`, 'Material removed')
      setPendingDelete(null)
      await Promise.all([reload(), refreshStats()])
    } catch (err) {
      toast.error(err.message, 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Library</h1>
          <p className="mt-1 text-sm text-muted">
            Every source you have ingested, with its chunks and generated cards.
          </p>
        </div>
        <Button as={Link} to="/ingest" variant="primary" icon={Plus}>
          Add material
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
          <TextInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search materials…"
            className="pl-9"
          />
        </div>
        <Badge tone="neutral" icon={Layers}>
          {pluralise(filtered.length, 'material')}
        </Badge>
      </div>

      {error && !materials?.length ? (
        <ErrorState error={error} onRetry={() => reload()} />
      ) : loading && !materials?.length ? (
        <Panel className="p-5">
          <LoadingBlock label="Loading library…" />
        </Panel>
      ) : filtered.length === 0 ? (
        <Panel>
          <EmptyState
            icon={materials?.length ? Search : LibraryIcon}
            title={materials?.length ? 'No matches' : 'Your library is empty'}
            description={
              materials?.length
                ? 'Try a different search term.'
                : 'Add your first set of notes and RecallCraft will turn them into a review deck.'
            }
            action={
              materials?.length ? (
                <Button variant="outline" onClick={() => setSearch('')}>
                  Clear search
                </Button>
              ) : (
                <Button as={Link} to="/ingest" variant="primary" icon={Plus}>
                  Add material
                </Button>
              )
            }
          />
        </Panel>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((material, index) => (
            <MaterialCard
              key={material.id}
              material={material}
              index={index}
              onDelete={() => setPendingDelete(material)}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
        loading={deleting}
        title={`Delete “${pendingDelete?.title ?? ''}”?`}
        description="The material, its chunks and every generated card will be removed."
        confirmLabel="Delete material"
      />
    </div>
  )
}

function MaterialCard({ material, index, onDelete }) {
  const Icon = SOURCE_ICON[material.source_type] ?? FileText
  const hasCards = material.card_count > 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index * 0.04, 0.3) }}
    >
      <Panel className="group flex h-full flex-col p-4 transition-colors hover:border-brand/40">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-edge bg-panel-2 text-muted">
              <Icon className="size-4" />
            </span>
            <div className="min-w-0">
              <Link
                to={`/library/${material.id}`}
                className="line-clamp-2 text-sm font-semibold text-ink transition-colors hover:text-brand-soft"
              >
                {material.title}
              </Link>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Badge tone="neutral" className="text-[10px]">
                  {readableSourceType(material.source_type)}
                </Badge>
                {material.due_count > 0 && (
                  <Badge tone="accent" className="text-[10px]">
                    {material.due_count} due
                  </Badge>
                )}
                {!hasCards && (
                  <Badge tone="warn" className="text-[10px]">
                    no cards yet
                  </Badge>
                )}
              </div>
            </div>
          </div>
          <IconButton
            label="Delete material"
            icon={Trash2}
            onClick={onDelete}
            className="opacity-0 transition-opacity group-hover:opacity-100 hover:text-bad"
          />
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-edge-soft pt-3 text-center">
          <Metric label="Chunks" value={material.chunk_count} />
          <Metric label="Cards" value={material.card_count} />
          <Metric label="Chars" value={formatCompact(material.char_count)} />
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[11px] text-faint">
            <CalendarDays className="size-3" />
            {formatDate(material.created_at)}
          </span>
          <Button
            as={Link}
            to={`/library/${material.id}`}
            size="sm"
            variant={hasCards ? 'outline' : 'primary'}
            icon={hasCards ? ArrowRight : Sparkles}
          >
            {hasCards ? 'Open' : 'Generate'}
          </Button>
        </div>
      </Panel>
    </motion.div>
  )
}

function Metric({ label, value }) {
  return (
    <div>
      <p className="text-sm font-semibold tabular-nums text-ink">{value}</p>
      <p className="text-[10px] tracking-wide text-faint uppercase">{label}</p>
    </div>
  )
}

function formatCompact(value) {
  const n = Number(value) || 0
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}
