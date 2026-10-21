import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  Cpu,
  Database,
  FolderTree,
  Gauge,
  Layers,
  RadioTower,
  Send,
  ServerCog,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-react'
import api from '../lib/api'
import { toast, useAsync } from '../lib/hooks'
import { useAppData } from '../lib/store'
import {
  Badge,
  Button,
  ConfirmDialog,
  ErrorState,
  Field,
  KeyValue,
  LoadingBlock,
  Panel,
  SectionHeading,
  TextInput,
} from '../components/ui'

export default function Settings() {
  const { health, healthError, refreshHealth, refreshStats, refreshAll } = useAppData()
  const [resetOpen, setResetOpen] = useState(false)
  const [resetting, setResetting] = useState(false)

  const { data: llmStatus } = useAsync(() => api.llmStatus(), [], { initial: null })
  const status = llmStatus ?? health

  async function handleReset() {
    setResetting(true)
    try {
      const result = await api.resetDeck()
      toast.success(
        `Removed ${result.deleted_cards} cards and ${result.deleted_materials} materials.`,
        'Deck wiped',
      )
      setResetOpen(false)
      await Promise.all([refreshStats(), refreshHealth()])
    } catch (err) {
      toast.error(err.message, 'Reset failed')
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Settings</h1>
        <p className="mt-1 text-sm text-muted">
          Backend status, LLM configuration and maintenance tools.
        </p>
      </div>

      {healthError && !status ? (
        <ErrorState error={healthError} onRetry={() => refreshAll()} />
      ) : !status ? (
        <Panel className="p-5">
          <LoadingBlock label="Checking backend…" />
        </Panel>
      ) : (
        <>
          <Panel className="p-5">
            <SectionHeading
              icon={ServerCog}
              title="Backend"
              subtitle="Runtime configuration reported by GET /api/health"
              action={
                <div className="flex items-center gap-2">
                  <Badge tone={status.status === 'ok' ? 'good' : 'warn'}>{status.status}</Badge>
                  <Button size="sm" variant="ghost" onClick={() => refreshAll()}>
                    Refresh
                  </Button>
                </div>
              }
            />
            <div className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
              <KeyValue label="Application" value={`${status.app} v${status.version}`} />
              <KeyValue label="Database" value={status.database} />
              <KeyValue label="Embedding backend" value={status.embedding_backend} />
              <KeyValue
                label="LLM configured"
                value={status.llm_configured ? 'Yes — live API key' : 'No — offline engine'}
              />
            </div>
          </Panel>

          <LLMPanel status={status} onRefreshed={() => refreshAll()} />

          <Panel className="p-5">
            <SectionHeading
              icon={Gauge}
              title="How scheduling works"
              subtitle="Every graded answer feeds this loop"
            />
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <InfoTile
                icon={Zap}
                title="Quality 0–5"
                body="Flashcards take your self-rating; MCQs auto-grade (5 correct / 2 wrong); open-ended answers get the Socratic grade."
              />
              <InfoTile
                icon={Layers}
                title="Interval ladder"
                body="Pass → 1 day, then 6 days, then round(interval × EF). Fail → repetition resets and the card returns tomorrow."
              />
              <InfoTile
                icon={Sparkles}
                title="Ease factor"
                body="EF += 0.1 − (5−q)(0.08 + (5−q)×0.02), floored at 1.3. Easy cards drift further apart; hard ones come back sooner."
              />
            </div>
          </Panel>

          <Panel className="p-5">
            <SectionHeading icon={FolderTree} title="Project layout" subtitle="Where things live on disk" />
            <div className="mt-4 space-y-2 font-mono text-xs text-muted">
              <p>
                <span className="text-brand-soft">backend/</span> FastAPI · SQLAlchemy 2.0 · Pydantic v2 ·
                SM-2 engine
              </p>
              <p>
                <span className="text-brand-soft">backend/app/services/sm2.py</span> spaced-repetition core
              </p>
              <p>
                <span className="text-brand-soft">backend/app/services/socratic.py</span> grading engine
              </p>
              <p>
                <span className="text-brand-soft">backend/app/llm/</span> multi-provider structured-output client
              </p>
              <p>
                <span className="text-brand-soft">frontend/</span> React 19 · Vite · Tailwind v4 · Framer
                Motion
              </p>
              <p>
                <span className="text-brand-soft">backend/.env</span> provider keys (copy{' '}
                <span className="text-accent">.env.example</span>)
              </p>
            </div>
          </Panel>

          <Panel className="border-bad/25 p-5">
            <SectionHeading
              icon={AlertTriangle}
              title="Danger zone"
              subtitle="Destructive maintenance actions"
            />
            <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-bad/25 bg-bad/6 p-4">
              <div>
                <p className="text-sm font-medium text-ink">Reset the entire deck</p>
                <p className="mt-0.5 text-xs text-muted">
                  Deletes every material, chunk, card, review state and log. Cannot be undone.
                </p>
              </div>
              <Button variant="danger" icon={Trash2} onClick={() => setResetOpen(true)}>
                Reset deck
              </Button>
            </div>
          </Panel>
        </>
      )}

      <ConfirmDialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        onConfirm={handleReset}
        loading={resetting}
        title="Wipe the entire deck?"
        description="All materials, cards and review history will be permanently deleted."
        confirmLabel="Yes, delete everything"
      />

      <p className="pb-2 text-center text-xs text-faint">
        RecallCraft · SM-2 spaced repetition ·{' '}
        <Link to="/" className="text-brand-soft hover:underline">
          back to dashboard
        </Link>
      </p>
    </div>
  )
}

function LLMPanel({ status, onRefreshed }) {
  const [prompt, setPrompt] = useState('In one sentence, what is spaced repetition?')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  async function runTest() {
    setBusy(true)
    setResult(null)
    try {
      const response = await api.llmTest(prompt)
      setResult(response)
      if (response.ok) toast.success(`Round-trip in ${response.latency_ms} ms.`, 'LLM reachable')
      else toast.error(response.error || 'The provider rejected the request.', 'LLM test failed')
    } catch (err) {
      toast.error(err.message, 'LLM test failed')
    } finally {
      setBusy(false)
      onRefreshed?.()
    }
  }

  const stub = status.offline_stub

  return (
    <Panel className="p-5">
      <SectionHeading
        icon={Cpu}
        title="LLM engine"
        subtitle="Structured JSON generation and Socratic grading"
        action={
          <Badge tone={stub ? 'warn' : 'good'} icon={RadioTower}>
            {stub ? 'Offline engine' : `${status.llm_provider}`}
          </Badge>
        }
      />

      <div className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
        <KeyValue label="Provider" value={status.llm_provider} />
        <KeyValue label="Model" value={status.llm_model} />
        <KeyValue label="API key present" value={status.llm_configured ? 'Yes' : 'No'} />
        <KeyValue label="Weak mode" value={stub ? 'Heuristic offline generator' : 'Live LLM'} />
      </div>

      {stub && (
        <div className="mt-4 rounded-xl border border-warn/30 bg-warn/8 p-3.5 text-xs leading-relaxed text-muted">
          <span className="font-medium text-warn">Running without an API key.</span> RecallCraft
          still works end to end: cards are generated with deterministic heuristics and answers are
          graded by keyword coverage. Add a provider key to{' '}
          <span className="font-mono text-ink">backend/.env</span> (e.g.{' '}
          <span className="font-mono">GROQ_API_KEY=…</span> with{' '}
          <span className="font-mono">LLM_PROVIDER=groq</span>) and restart the backend for
          LLM-quality results.
        </div>
      )}

      <div className="mt-5 border-t border-edge-soft pt-4">
        <Field label="Test prompt" hint="Sends one request to the configured provider.">
          <div className="flex flex-wrap gap-2">
            <TextInput
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="min-w-0 flex-1"
            />
            <Button variant="primary" icon={Send} loading={busy} onClick={runTest} disabled={!prompt.trim()}>
              Run test
            </Button>
          </div>
        </Field>

        {result && (
          <div className="mt-3 rounded-xl border border-edge bg-panel-2/40 p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={result.ok ? 'good' : 'bad'}>{result.ok ? 'Success' : 'Failed'}</Badge>
              <Badge tone="neutral">{result.latency_ms} ms</Badge>
              {result.offline_stub && <Badge tone="warn">offline stub</Badge>}
            </div>
            <p className="mt-2.5 text-sm leading-relaxed whitespace-pre-line text-ink/85">
              {result.ok ? result.output : result.error}
            </p>
          </div>
        )}
      </div>
    </Panel>
  )
}

function InfoTile({ icon: Icon, title, body }) {
  return (
    <div className="rounded-xl border border-edge bg-panel-2/40 p-3.5">
      <span className="grid size-8 place-items-center rounded-lg border border-brand/25 bg-brand/10 text-brand-soft">
        <Icon className="size-4" />
      </span>
      <p className="mt-2.5 text-sm font-medium text-ink">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted">{body}</p>
    </div>
  )
}
