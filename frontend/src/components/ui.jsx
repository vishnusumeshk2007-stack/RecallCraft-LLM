import { useEffect, useId } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  Check,
  CircleAlert,
  CircleCheck,
  Info,
  LoaderCircle,
  TriangleAlert,
  X,
} from 'lucide-react'
import { cn } from '../lib/utils'
import { dismissToast, useToasts } from '../lib/hooks'

/* ---------------------------------------------------------------------------
 * Button
 * ------------------------------------------------------------------------- */
const BUTTON_VARIANTS = {
  primary:
    'bg-brand text-white hover:bg-brand/90 border border-brand/40 shadow-[0_10px_30px_-12px_rgba(124,108,255,0.9)]',
  secondary: 'bg-panel-2 text-ink hover:bg-panel-3 border border-edge',
  outline: 'bg-transparent text-ink hover:bg-panel-2 border border-edge',
  ghost: 'bg-transparent text-muted hover:text-ink hover:bg-panel-2 border border-transparent',
  danger: 'bg-bad/15 text-bad hover:bg-bad/25 border border-bad/40',
  success: 'bg-good/15 text-good hover:bg-good/25 border border-good/40',
}

const BUTTON_SIZES = {
  xs: 'h-7 px-2.5 text-xs gap-1.5 rounded-lg',
  sm: 'h-9 px-3 text-sm gap-1.5 rounded-xl',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-5 text-base gap-2.5 rounded-2xl',
  icon: 'h-9 w-9 rounded-xl',
}

export function Button({
  as: Tag = 'button',
  variant = 'secondary',
  size = 'md',
  loading = false,
  disabled = false,
  icon: Icon,
  iconRight: IconRight,
  className,
  children,
  ...rest
}) {
  const isDisabled = disabled || loading
  return (
    <Tag
      className={cn(
        'relative inline-flex select-none items-center justify-center font-medium',
        'transition-all duration-150 active:scale-[0.98]',
        'disabled:pointer-events-none disabled:opacity-45',
        BUTTON_SIZES[size] ?? BUTTON_SIZES.md,
        BUTTON_VARIANTS[variant] ?? BUTTON_VARIANTS.secondary,
        className,
      )}
      disabled={Tag === 'button' ? isDisabled : undefined}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <LoaderCircle className="size-4 shrink-0 animate-spin" />
      ) : (
        Icon && <Icon className={cn('shrink-0', size === 'lg' ? 'size-5' : 'size-4')} />
      )}
      {children}
      {IconRight && !loading && (
        <IconRight className={cn('shrink-0', size === 'lg' ? 'size-5' : 'size-4')} />
      )}
    </Tag>
  )
}

export function IconButton({ label, icon: Icon, className, size = 'icon', ...rest }) {
  return (
    <Button
      size={size}
      variant="ghost"
      aria-label={label}
      title={label}
      className={cn('px-0', className)}
      {...rest}
    >
      {Icon && <Icon className="size-4" />}
    </Button>
  )
}

/* ---------------------------------------------------------------------------
 * Surfaces
 * ------------------------------------------------------------------------- */
export function Panel({ className, glow = true, children, ...rest }) {
  return (
    <div className={cn('panel rounded-2xl', glow && 'panel-glow', className)} {...rest}>
      {children}
    </div>
  )
}

export function SectionHeading({ icon: Icon, title, subtitle, action, className }) {
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border border-brand/25 bg-brand/10 text-brand-soft">
            <Icon className="size-4.5" />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-ink">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  )
}

export function Badge({ children, className, tone = 'neutral', icon: Icon }) {
  const tones = {
    neutral: 'border-edge bg-panel-2 text-muted',
    brand: 'border-brand/30 bg-brand/12 text-brand-soft',
    accent: 'border-accent/30 bg-accent/12 text-accent',
    good: 'border-good/30 bg-good/12 text-good',
    warn: 'border-warn/30 bg-warn/12 text-warn',
    bad: 'border-bad/30 bg-bad/12 text-bad',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        tones[tone] ?? tones.neutral,
        className,
      )}
    >
      {Icon && <Icon className="size-3" />}
      {children}
    </span>
  )
}

export function Stat({ label, value, hint, icon: Icon, tone = 'brand', className }) {
  const tones = {
    brand: 'text-brand-soft border-brand/25 bg-brand/10',
    accent: 'text-accent border-accent/25 bg-accent/10',
    good: 'text-good border-good/25 bg-good/10',
    warn: 'text-warn border-warn/25 bg-warn/10',
    bad: 'text-bad border-bad/25 bg-bad/10',
  }
  return (
    <Panel className={cn('p-4', className)}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium tracking-wide text-muted uppercase">{label}</p>
        {Icon && (
          <span className={cn('grid size-8 place-items-center rounded-lg border', tones[tone])}>
            <Icon className="size-4" />
          </span>
        )}
      </div>
      <p className="mt-3 text-3xl font-semibold tabular-nums text-ink">{value}</p>
      {hint && <p className="mt-1 text-xs text-faint">{hint}</p>}
    </Panel>
  )
}

export function Progress({ value, max = 100, className, tone = 'brand', height = 'h-2' }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  const tones = {
    brand: 'bg-gradient-to-r from-brand to-brand-soft',
    accent: 'bg-gradient-to-r from-accent to-brand-soft',
    good: 'bg-gradient-to-r from-good to-accent',
    warn: 'bg-gradient-to-r from-warn to-bad',
  }
  return (
    <div
      className={cn('w-full overflow-hidden rounded-full bg-panel-3/80', height, className)}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <motion.div
        className={cn('h-full rounded-full', tones[tone] ?? tones.brand)}
        initial={false}
        animate={{ width: `${pct}%` }}
        transition={{ type: 'spring', stiffness: 140, damping: 22 }}
      />
    </div>
  )
}

/* ---------------------------------------------------------------------------
 * Feedback
 * ------------------------------------------------------------------------- */
export function Spinner({ className, label }) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-sm text-muted', className)}>
      <LoaderCircle className="size-4 animate-spin text-brand-soft" />
      {label}
    </span>
  )
}

export function LoadingBlock({ label = 'Loading…', className }) {
  return (
    <div className={cn('flex items-center justify-center gap-2 py-16 text-sm text-muted', className)}>
      <LoaderCircle className="size-5 animate-spin text-brand-soft" />
      {label}
    </div>
  )
}

export function SkeletonLines({ rows = 3, className }) {
  return (
    <div className={cn('space-y-2.5', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="animate-shimmer h-3.5 rounded-full bg-gradient-to-r from-panel-2 via-panel-3 to-panel-2"
          style={{ width: `${100 - i * 12}%` }}
        />
      ))}
    </div>
  )
}

export function EmptyState({ icon: Icon, title, description, action, className }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-16 text-center', className)}>
      {Icon && (
        <span className="mb-4 grid size-14 place-items-center rounded-2xl border border-edge bg-panel-2 text-muted">
          <Icon className="size-6" />
        </span>
      )}
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry, className }) {
  const message =
    error?.message || 'Something went wrong while talking to the RecallCraft API.'
  return (
    <div
      className={cn(
        'flex flex-col items-start gap-3 rounded-2xl border border-bad/30 bg-bad/8 p-4',
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <CircleAlert className="mt-0.5 size-4.5 shrink-0 text-bad" />
        <div>
          <p className="text-sm font-medium text-bad">Request failed</p>
          <p className="mt-0.5 text-sm text-muted">{message}</p>
        </div>
      </div>
      {onRetry && (
        <Button size="sm" variant="danger" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------------------
 * Form controls
 * ------------------------------------------------------------------------- */
export function Field({ label, hint, error, required, children, className }) {
  return (
    <label className={cn('block', className)}>
      {label && (
        <span className="mb-1.5 flex items-center gap-1 text-xs font-medium tracking-wide text-muted uppercase">
          {label}
          {required && <span className="text-bad">*</span>}
        </span>
      )}
      {children}
      {error ? (
        <span className="mt-1 block text-xs text-bad">{error}</span>
      ) : (
        hint && <span className="mt-1 block text-xs text-faint">{hint}</span>
      )}
    </label>
  )
}

const CONTROL_BASE =
  'w-full rounded-xl border border-edge bg-canvas/70 px-3.5 text-sm text-ink placeholder:text-faint ' +
  'transition-colors focus:border-brand/60 focus:bg-canvas focus:outline-none disabled:opacity-50'

export function TextInput({ className, ...rest }) {
  return <input className={cn(CONTROL_BASE, 'h-10', className)} {...rest} />
}

export function TextArea({ className, rows = 6, ...rest }) {
  return <textarea rows={rows} className={cn(CONTROL_BASE, 'py-2.5 leading-relaxed', className)} {...rest} />
}

export function Select({ className, children, ...rest }) {
  return (
    <select className={cn(CONTROL_BASE, 'h-10 cursor-pointer pr-8', className)} {...rest}>
      {children}
    </select>
  )
}

export function Segmented({ options, value, onChange, className, size = 'md' }) {
  // One shared layoutId per instance so the highlight slides between options.
  const groupId = useId()
  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex items-center gap-1 rounded-xl border border-edge bg-panel-2/70 p-1',
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative inline-flex items-center gap-1.5 rounded-lg font-medium transition-colors',
              size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-sm',
              active ? 'text-ink' : 'text-muted hover:text-ink',
            )}
          >
            {active && (
              <motion.span
                layoutId={`segmented-${groupId}`}
                className="absolute inset-0 -z-10 rounded-lg border border-brand/35 bg-brand/18"
                transition={{ type: 'spring', stiffness: 320, damping: 30 }}
              />
            )}
            {option.icon && <option.icon className="size-3.5" />}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export function Switch({ checked, onChange, label, description }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 text-left"
    >
      <span>
        <span className="block text-sm font-medium text-ink">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-muted">{description}</span>}
      </span>
      <span
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full border transition-colors',
          checked ? 'border-brand/50 bg-brand/70' : 'border-edge bg-panel-3',
        )}
      >
        <motion.span
          className="absolute top-0.5 size-4.5 rounded-full bg-white shadow"
          animate={{ left: checked ? 22 : 3 }}
          transition={{ type: 'spring', stiffness: 500, damping: 32 }}
        />
      </span>
    </button>
  )
}

/* ---------------------------------------------------------------------------
 * Modal
 * ------------------------------------------------------------------------- */
export function Modal({ open, onClose, title, description, children, footer, size = 'md' }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [open, onClose])

  const widths = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl' }

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center">
          <motion.div
            className="fixed inset-0 bg-canvas/80 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            className={cn(
              'panel panel-glow relative z-10 my-auto w-full rounded-2xl',
              widths[size] ?? widths.md,
            )}
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
          >
            {(title || onClose) && (
              <div className="flex items-start justify-between gap-4 border-b border-edge-soft p-5">
                <div>
                  <h2 className="text-base font-semibold text-ink">{title}</h2>
                  {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
                </div>
                <IconButton label="Close" icon={X} onClick={onClose} />
              </div>
            )}
            <div className="p-5">{children}</div>
            {footer && (
              <div className="flex items-center justify-end gap-2 border-t border-edge-soft p-5">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  destructive = true,
  loading = false,
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex items-start gap-3 rounded-xl border border-edge bg-panel-2/60 p-3.5">
        <TriangleAlert className="mt-0.5 size-4.5 shrink-0 text-warn" />
        <p className="text-sm text-muted">
          This action cannot be undone. Make sure you no longer need this data.
        </p>
      </div>
    </Modal>
  )
}

/* ---------------------------------------------------------------------------
 * Toaster
 * ------------------------------------------------------------------------- */
const TOAST_STYLES = {
  success: { icon: CircleCheck, tint: 'text-good', border: 'border-good/35' },
  error: { icon: CircleAlert, tint: 'text-bad', border: 'border-bad/35' },
  warn: { icon: AlertTriangle, tint: 'text-warn', border: 'border-warn/35' },
  info: { icon: Info, tint: 'text-accent', border: 'border-accent/35' },
}

export function Toaster() {
  const toasts = useToasts()
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:bottom-auto sm:top-4 sm:items-end">
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const style = TOAST_STYLES[t.kind] ?? TOAST_STYLES.info
          const Icon = style.icon
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: -12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.15 } }}
              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              className={cn(
                'glass pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border p-3.5 shadow-2xl',
                style.border,
              )}
            >
              <Icon className={cn('mt-0.5 size-4.5 shrink-0', style.tint)} />
              <div className="min-w-0 flex-1">
                {t.title && <p className="text-sm font-semibold text-ink">{t.title}</p>}
                <p className="text-sm break-words text-muted">{t.message}</p>
              </div>
              <button
                type="button"
                onClick={() => dismissToast(t.id)}
                className="text-faint transition-colors hover:text-ink"
                aria-label="Dismiss notification"
              >
                <X className="size-3.5" />
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}

/* ---------------------------------------------------------------------------
 * Misc
 * ------------------------------------------------------------------------- */
export function CheckRow({ children, tone = 'good' }) {
  const tones = { good: 'text-good', bad: 'text-bad', warn: 'text-warn' }
  const Icon = tone === 'bad' ? X : Check
  return (
    <li className="flex items-start gap-2.5 text-sm">
      <Icon className={cn('mt-0.5 size-4 shrink-0', tones[tone] ?? tones.good)} />
      <span className="text-ink/90">{children}</span>
    </li>
  )
}

export function Gauge({ value, label, sublabel, size = 132, tone = '#7c6cff' }) {
  const radius = size / 2 - 10
  const circumference = 2 * Math.PI * radius
  const pct = Math.min(1, Math.max(0, Number(value) || 0))

  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#182241"
          strokeWidth="10"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={tone}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference * (1 - pct) }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div className="absolute text-center">
        <p className="text-2xl font-semibold tabular-nums text-ink">{label}</p>
        {sublabel && <p className="mt-0.5 text-[11px] tracking-wide text-muted uppercase">{sublabel}</p>}
      </div>
    </div>
  )
}

export function KeyValue({ label, value, className }) {
  return (
    <div className={cn('flex items-center justify-between gap-3 text-sm', className)}>
      <span className="text-muted">{label}</span>
      <span className="font-medium tabular-nums text-ink">{value}</span>
    </div>
  )
}
