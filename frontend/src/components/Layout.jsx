import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Brain,
  CircleAlert,
  LayoutDashboard,
  Library,
  Layers,
  Play,
  Settings,
  Sparkles,
  Upload,
} from 'lucide-react'
import { cn } from '../lib/utils'
import { useAppData } from '../lib/store'
import { Badge } from './ui'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/library', label: 'Library', icon: Library },
  { to: '/ingest', label: 'Add material', icon: Upload },
  { to: '/deck', label: 'Deck', icon: Layers },
  { to: '/review', label: 'Review', icon: Play, showDue: true },
  { to: '/settings', label: 'Settings', icon: Settings },
]

function NavItem({ item, due, compact = false }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cn(
          'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
          compact && 'shrink-0 flex-col gap-1.5 px-3.5 py-2 text-[11px]',
          isActive
            ? 'bg-brand/15 text-ink'
            : 'text-muted hover:bg-panel-2 hover:text-ink',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && !compact && (
            <motion.span
              layoutId="nav-active"
              className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-brand"
              transition={{ type: 'spring', stiffness: 400, damping: 34 }}
            />
          )}
          <span className="relative">
            <Icon className={cn('size-4.5', isActive ? 'text-brand-soft' : 'text-faint group-hover:text-muted')} />
            {item.showDue && due > 0 && compact && (
              <span className="absolute -top-1 -right-1 size-2 rounded-full bg-accent" />
            )}
          </span>
          <span className="flex-1 truncate">{item.label}</span>
          {item.showDue && due > 0 && !compact && (
            <span className="rounded-full border border-accent/35 bg-accent/15 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-accent">
              {due}
            </span>
          )}
        </>
      )}
    </NavLink>
  )
}

function StatusPill({ health, error }) {
  const online = Boolean(health)
  const stub = health?.offline_stub
  return (
    <div className="rounded-xl border border-edge bg-panel-2/60 p-3">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'size-2 rounded-full',
            error ? 'bg-bad' : online ? 'bg-good animate-pulse-soft' : 'bg-warn',
          )}
        />
        <span className="text-xs font-medium text-ink">
          {error ? 'API offline' : online ? 'API connected' : 'Connecting…'}
        </span>
      </div>
      {health && (
        <p className="mt-1.5 truncate text-[11px] text-faint" title={health.llm_model}>
          {stub ? 'Offline engine' : health.llm_provider} · {health.llm_model}
        </p>
      )}
      {error && (
        <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-bad">
          <CircleAlert className="mt-px size-3 shrink-0" />
          Start the FastAPI server on :8001
        </p>
      )}
    </div>
  )
}

export default function Layout() {
  const location = useLocation()
  const { stats, health, statsError, healthError } = useAppData()
  const due = stats?.due_now ?? 0

  return (
    <div className="relative z-10 min-h-screen">
      <div className="pointer-events-none fixed inset-0 grid-lines opacity-40" />

      {/* ---------------- Desktop sidebar ---------------- */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-edge bg-panel/70 p-4 backdrop-blur-xl lg:flex">
        <Brand />
        <nav className="mt-7 flex flex-1 flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <NavItem key={item.to} item={item} due={due} />
          ))}
        </nav>
        <div className="space-y-3">
          {stats && (
            <div className="rounded-xl border border-edge bg-panel-2/60 p-3">
              <p className="text-[11px] tracking-wide text-faint uppercase">Retention</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-ink">
                {(stats.retention_rate * 100).toFixed(0)}%
                <span className="ml-2 text-xs font-normal text-muted">
                  {stats.streak_days}d streak
                </span>
              </p>
            </div>
          )}
          <StatusPill health={health} error={healthError} />
        </div>
      </aside>

      {/* ---------------- Mobile header ---------------- */}
      <header className="sticky top-0 z-30 border-b border-edge glass lg:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <Brand compact />
          <Badge tone={health ? 'good' : 'bad'}>{health ? 'Online' : 'Offline'}</Badge>
        </div>
        <nav className="no-scrollbar flex items-center gap-1 overflow-x-auto px-2 pb-2">
          {NAV_ITEMS.map((item) => (
            <NavItem key={item.to} item={item} due={due} compact />
          ))}
        </nav>
      </header>

      {/* ---------------- Content ---------------- */}
      <main className="lg:pl-64">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:py-9">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            >
              {statsError && !stats ? (
                <div className="mb-5 rounded-2xl border border-warn/30 bg-warn/8 p-4 text-sm text-muted">
                  <span className="font-medium text-warn">Heads up:</span> {statsError.message}
                </div>
              ) : null}
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  )
}

function Brand({ compact = false }) {
  return (
    <NavLink to="/" className="flex items-center gap-2.5">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand to-accent shadow-lg shadow-brand/25">
        <Brain className="size-5 text-white" />
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-sm font-semibold tracking-tight text-ink">
          RecallCraft
          {!compact && <Sparkles className="size-3.5 text-accent" />}
        </span>
        <span className="block truncate text-[11px] text-faint">SM-2 spaced repetition</span>
      </span>
    </NavLink>
  )
}
