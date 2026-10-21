import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Filter, Layers, Plus, Search, Sparkles, X } from 'lucide-react'
import api from '../lib/api'
import { toast, useAsync, useDebounced } from '../lib/hooks'
import { useAppData } from '../lib/store'
import { cardTypeMeta } from '../lib/utils'
import CardPreview from '../components/CardPreview'
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  LoadingBlock,
  Panel,
  Select,
  Segmented,
  Switch,
  TextInput,
} from '../components/ui'

const PAGE_SIZE = 48

export default function Deck() {
  const { refreshStats } = useAppData()
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounced(search, 250)
  const [materialId, setMaterialId] = useState('')
  const [cardType, setCardType] = useState('all')
  const [dueOnly, setDueOnly] = useState(false)
  const [limit, setLimit] = useState(PAGE_SIZE)

  const { data: materials } = useAsync(() => api.listMaterials({ limit: 200 }), [], { initial: [] })

  const params = {
    search: debouncedSearch || undefined,
    material_id: materialId || undefined,
    card_type: cardType === 'all' ? undefined : cardType,
    due_only: dueOnly || undefined,
    limit,
    offset: 0,
  }

  const { data: cards, loading, error, reload } = useAsync(
    () => api.listCards(params),
    [debouncedSearch, materialId, cardType, dueOnly, limit],
    { initial: [] },
  )

  const filtersActive = Boolean(debouncedSearch || materialId || cardType !== 'all' || dueOnly)

  function resetFilters() {
    setSearch('')
    setMaterialId('')
    setCardType('all')
    setDueOnly(false)
    setLimit(PAGE_SIZE)
  }

  async function removeCard(card) {
    try {
      await api.deleteCard(card.id)
      toast.success('Card deleted.', 'Removed')
      await Promise.all([reload(), refreshStats()])
    } catch (err) {
      toast.error(err.message, 'Delete failed')
    }
  }

  const list = cards ?? []
  const canLoadMore = list.length >= limit

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Deck</h1>
          <p className="mt-1 text-sm text-muted">
            Browse, search and inspect every card with its SM-2 scheduling state.
          </p>
        </div>
        <Button as={Link} to="/ingest" variant="primary" icon={Plus}>
          Add material
        </Button>
      </div>

      <Panel className="p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
            <TextInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search prompts and answers…"
              className="pl-9"
            />
          </div>

          <Select value={materialId} onChange={(e) => setMaterialId(e.target.value)}>
            <option value="">All materials</option>
            {materials?.map((material) => (
              <option key={material.id} value={material.id}>
                {material.title}
              </option>
            ))}
          </Select>

          <div className="flex items-center gap-3">
            <Segmented
              size="sm"
              value={cardType}
              onChange={setCardType}
              options={[
                { value: 'all', label: 'All' },
                { value: 'flashcard', label: 'Concept' },
                { value: 'mcq', label: 'MCQ' },
                { value: 'open_ended', label: 'Open' },
              ]}
            />
            {filtersActive && <IconButton label="Clear filters" icon={X} onClick={resetFilters} />}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-edge-soft pt-3">
          <div className="w-full sm:w-72">
            <Switch
              checked={dueOnly}
              onChange={setDueOnly}
              label="Only cards due now"
              description="Hide anything scheduled for the future"
            />
          </div>
          <Badge tone={filtersActive ? 'brand' : 'neutral'} icon={Filter}>
            {list.length}
            {canLoadMore ? '+' : ''} cards
          </Badge>
        </div>
      </Panel>

      {error && !list.length ? (
        <ErrorState error={error} onRetry={() => reload()} />
      ) : loading && !list.length ? (
        <Panel className="p-5">
          <LoadingBlock label="Loading cards…" />
        </Panel>
      ) : list.length === 0 ? (
        <Panel>
          <EmptyState
            icon={filtersActive ? Search : Layers}
            title={filtersActive ? 'No cards match these filters' : 'No cards in your deck'}
            description={
              filtersActive
                ? 'Try widening the search or turning off the due-only filter.'
                : 'Generate cards from a material and they will show up here.'
            }
            action={
              filtersActive ? (
                <Button variant="outline" onClick={resetFilters}>
                  Clear filters
                </Button>
              ) : (
                <Button as={Link} to="/ingest" variant="primary" icon={Sparkles}>
                  Add material
                </Button>
              )
            }
          />
        </Panel>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {list.map((card) => (
              <CardPreview key={card.id} card={card} onDelete={() => removeCard(card)} />
            ))}
          </div>

          {canLoadMore && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                loading={loading}
                onClick={() => setLimit((value) => value + PAGE_SIZE)}
              >
                Load more cards
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
