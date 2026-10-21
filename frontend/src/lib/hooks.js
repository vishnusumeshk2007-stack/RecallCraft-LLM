import { useCallback, useEffect, useRef, useState } from 'react'

/* ---------------------------------------------------------------------------
 * useAsync — minimal data-fetching primitive (no react-query dependency).
 * ------------------------------------------------------------------------- */
export function useAsync(fn, deps = [], { immediate = true, initial = null } = {}) {
  const [data, setData] = useState(initial)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(immediate)

  const fnRef = useRef(fn)
  fnRef.current = fn
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const run = useCallback(async (...args) => {
    setLoading(true)
    setError(null)
    try {
      const result = await fnRef.current(...args)
      if (mounted.current) setData(result)
      return result
    } catch (err) {
      if (mounted.current && err?.name !== 'AbortError') setError(err)
      throw err
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!immediate) return
    run().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, error, loading, reload: run, setData }
}

/* ---------------------------------------------------------------------------
 * Simple module-level toast store + subscription hook.
 * ------------------------------------------------------------------------- */
let toasts = []
let seq = 0
const listeners = new Set()

function emit() {
  const snapshot = [...toasts]
  listeners.forEach((listener) => listener(snapshot))
}

export function pushToast({ kind = 'info', title, message, duration = 4200 }) {
  const id = ++seq
  toasts = [...toasts, { id, kind, title, message }]
  emit()
  if (duration > 0) window.setTimeout(() => dismissToast(id), duration)
  return id
}

export function dismissToast(id) {
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

export const toast = {
  success: (message, title) => pushToast({ kind: 'success', message, title }),
  error: (message, title) => pushToast({ kind: 'error', message, title, duration: 7000 }),
  info: (message, title) => pushToast({ kind: 'info', message, title }),
  warn: (message, title) => pushToast({ kind: 'warn', message, title, duration: 6000 }),
}

export function useToasts() {
  const [state, setState] = useState(toasts)
  useEffect(() => {
    listeners.add(setState)
    setState(toasts)
    return () => listeners.delete(setState)
  }, [])
  return state
}

/** Debounce any fast-changing value (search boxes, textareas). */
export function useDebounced(value, delay = 300) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(id)
  }, [value, delay])
  return debounced
}

/** Persisted UI state, so filters survive a reload. */
export function useLocalState(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = window.localStorage.getItem(key)
      return raw === null ? initial : JSON.parse(raw)
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* storage disabled — non-fatal */
    }
  }, [key, value])
  return [value, setValue]
}
