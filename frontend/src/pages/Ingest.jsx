import { useCallback, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  FileText,
  FileUp,
  Lightbulb,
  PenLine,
  Sparkles,
  UploadCloud,
  X,
} from 'lucide-react'
import api from '../lib/api'
import { toast } from '../lib/hooks'
import { useAppData } from '../lib/store'
import { cn, pluralise } from '../lib/utils'
import {
  Button,
  ErrorState,
  Field,
  IconButton,
  Panel,
  SectionHeading,
  Segmented,
  TextArea,
  TextInput,
} from '../components/ui'

const ACCEPT = '.pdf,.md,.markdown,.txt,text/plain,application/pdf,text/markdown'
const MIN_CHARS = 40

const SOURCE_OPTIONS = [
  { value: 'text', label: 'Plain text' },
  { value: 'markdown', label: 'Markdown' },
]

export default function Ingest() {
  const navigate = useNavigate()
  const { refreshStats } = useAppData()
  const [mode, setMode] = useState('paste')

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Add study material</h1>
        <p className="mt-1 text-sm text-muted">
          RecallCraft splits your notes into sentence-aligned chunks, embeds them for source
          traceability, then generates cards you can review with SM-2.
        </p>
      </div>

      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: 'paste', label: 'Paste notes', icon: PenLine },
          { value: 'upload', label: 'Upload a file', icon: FileUp },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        {mode === 'paste' ? (
          <PasteForm
            onDone={async (material) => {
              await refreshStats()
              navigate(`/library/${material.id}`)
            }}
          />
        ) : (
          <UploadForm
            onDone={async (material) => {
              await refreshStats()
              navigate(`/library/${material.id}`)
            }}
          />
        )}

        <Tips />
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------------------
 * Paste form
 * ------------------------------------------------------------------------- */
function PasteForm({ onDone }) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [sourceType, setSourceType] = useState('text')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const charCount = content.trim().length
  const ready = title.trim().length > 0 && charCount >= MIN_CHARS

  async function submit(event) {
    event.preventDefault()
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      const material = await api.createMaterial({
        title: title.trim(),
        content,
        source_type: sourceType,
      })
      toast.success(
        `“${material.title}” indexed into ${pluralise(material.chunk_count, 'chunk')}.`,
        'Material saved',
      )
      await onDone(material)
    } catch (err) {
      setError(err)
      toast.error(err.message, 'Could not save material')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel className="p-5">
      <SectionHeading
        icon={PenLine}
        title="Paste your notes"
        subtitle="Lecture notes, textbook passages or a summary you wrote earlier."
      />

      <form onSubmit={submit} className="mt-5 space-y-4">
        <Field label="Title" required hint="Shown in your library and on every generated card.">
          <TextInput
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Cellular respiration — glycolysis & Krebs cycle"
            maxLength={300}
          />
        </Field>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <span className="mb-1.5 block text-xs font-medium tracking-wide text-muted uppercase">
              Format
            </span>
            <Segmented size="sm" value={sourceType} onChange={setSourceType} options={SOURCE_OPTIONS} />
          </div>
          <span
            className={cn(
              'text-xs tabular-nums',
              charCount === 0 ? 'text-faint' : charCount < MIN_CHARS ? 'text-warn' : 'text-good',
            )}
          >
            {charCount.toLocaleString()} chars
            {charCount > 0 && charCount < MIN_CHARS && ` · ${MIN_CHARS - charCount} more needed`}
          </span>
        </div>

        <Field label="Content" required>
          <TextArea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={16}
            placeholder={
              'Paste at least a paragraph or two. Markdown headings are picked up and reused as\ncontext prefixes on each chunk, which keeps generated cards coherent.\n\n## Example heading\nGlycolysis converts one glucose molecule into two pyruvate molecules, netting 2 ATP…'
            }
            className="font-mono text-[13px]"
          />
        </Field>

        {error && <ErrorState error={error} />}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-faint">
            Chunking is sentence-aligned with a one-sentence overlap so facts spanning boundaries
            survive.
          </p>
          <Button type="submit" variant="primary" size="lg" icon={Sparkles} loading={busy} disabled={!ready}>
            Save &amp; index
          </Button>
        </div>
      </form>
    </Panel>
  )
}

/* ---------------------------------------------------------------------------
 * Upload form
 * ------------------------------------------------------------------------- */
function UploadForm({ onDone }) {
  const inputRef = useRef(null)
  const [file, setFile] = useState(null)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState(null)

  const pick = useCallback((incoming) => {
    if (!incoming) return
    setFile(incoming)
    setError(null)
    setTitle((current) => current || incoming.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '))
  }, [])

  function onDrop(event) {
    event.preventDefault()
    setDragging(false)
    pick(event.dataTransfer?.files?.[0])
  }

  async function submit(event) {
    event.preventDefault()
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const material = await api.uploadMaterial(file, title.trim() || undefined)
      toast.success(
        `Extracted ${pluralise(material.chunk_count, 'chunk')} from ${file.name}.`,
        'Material saved',
      )
      await onDone(material)
    } catch (err) {
      setError(err)
      toast.error(err.message, 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel className="p-5">
      <SectionHeading
        icon={FileUp}
        title="Upload a document"
        subtitle="PDFs (text-based), Markdown or plain-text files."
      />

      <form onSubmit={submit} className="mt-5 space-y-4">
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={cn(
            'cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition-colors',
            dragging
              ? 'border-brand bg-brand/8'
              : file
                ? 'border-good/45 bg-good/6'
                : 'border-edge bg-panel-2/40 hover:border-brand/50 hover:bg-panel-2/70',
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => pick(e.target.files?.[0])}
          />

          <motion.span
            className={cn(
              'mx-auto grid size-12 place-items-center rounded-2xl border',
              file ? 'border-good/40 bg-good/12 text-good' : 'border-edge bg-panel-3 text-muted',
            )}
            animate={{ scale: dragging ? 1.08 : 1 }}
          >
            {file ? <FileText className="size-6" /> : <UploadCloud className="size-6" />}
          </motion.span>

          {file ? (
            <div className="mt-3">
              <p className="text-sm font-medium text-ink">{file.name}</p>
              <p className="mt-0.5 text-xs text-faint">
                {(file.size / 1024).toFixed(1)} KB · click to choose a different file
              </p>
            </div>
          ) : (
            <div className="mt-3">
              <p className="text-sm font-medium text-ink">
                Drop a file here, or <span className="text-brand-soft">browse</span>
              </p>
              <p className="mt-1 text-xs text-faint">PDF · MD · TXT — up to 15 MB</p>
            </div>
          )}

          {file && (
            <div className="mt-3 flex justify-center">
              <IconButton
                label="Remove file"
                icon={X}
                onClick={(e) => {
                  e.stopPropagation()
                  setFile(null)
                }}
              />
            </div>
          )}
        </div>

        <Field label="Title" hint="Leave blank to use the filename.">
          <TextInput
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Optional title"
            maxLength={300}
          />
        </Field>

        {error && <ErrorState error={error} />}

        <div className="flex justify-end">
          <Button type="submit" variant="primary" size="lg" icon={UploadCloud} loading={busy} disabled={!file}>
            Upload &amp; index
          </Button>
        </div>
      </form>
    </Panel>
  )
}

/* ---------------------------------------------------------------------------
 * Side tips
 * ------------------------------------------------------------------------- */
function Tips() {
  const tips = [
    {
      icon: Lightbulb,
      title: 'Structure beats volume',
      body: 'Headings and short paragraphs produce far better cards than one wall of text.',
    },
    {
      icon: Sparkles,
      title: 'Deduplication is automatic',
      body: 'Every generated card is embedded and compared against the deck, so re-running generation will not duplicate cards.',
    },
    {
      icon: ArrowRight,
      title: 'Then generate',
      body: 'After saving you land on the material page where you choose how many concept cards, MCQs and open-ended prompts to create.',
    },
  ]

  return (
    <Panel className="h-fit p-5">
      <h2 className="text-sm font-semibold text-ink">Getting good cards</h2>
      <ul className="mt-4 space-y-4">
        {tips.map((tip) => (
          <li key={tip.title} className="flex gap-3">
            <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border border-brand/25 bg-brand/10 text-brand-soft">
              <tip.icon className="size-3.5" />
            </span>
            <div>
              <p className="text-sm font-medium text-ink">{tip.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">{tip.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
