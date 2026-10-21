/**
 * Thin typed-ish client for the RecallCraft FastAPI backend.
 *
 * Resolution order for the API root:
 *   1. VITE_API_BASE — e.g. `https://recallcraft.onrender.com/api` on Vercel
 *   2. VITE_API_URL  — e.g. `https://recallcraft.onrender.com` (a trailing
 *      `/api` is appended when the value is a bare origin)
 *   3. `/api`        — the relative default, which the Vite dev server proxies
 *      to FastAPI (see vite.config.js) so development has no CORS round-trip.
 */

function resolveBase() {
  const raw = import.meta.env.VITE_API_BASE ?? import.meta.env.VITE_API_URL
  if (!raw) return '/api'
  const trimmed = String(raw).replace(/\/+$/, '')
  // A bare origin (no path) still needs the API prefix.
  return /^https?:\/\/[^/]+$/i.test(trimmed) ? `${trimmed}/api` : trimmed
}

export const API_BASE = resolveBase()

export class ApiError extends Error {
  constructor(message, status, payload) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.payload = payload
  }
}

/** FastAPI returns `detail` as a string or a list of validation errors. */
function extractDetail(data, fallback) {
  if (!data) return fallback
  const detail = data.detail ?? data
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail
      .map((d) => (typeof d === 'string' ? d : d?.msg || JSON.stringify(d)))
      .filter(Boolean)
      .join(' • ')
  }
  if (detail && typeof detail === 'object') return detail.message || JSON.stringify(detail)
  return fallback
}

async function request(path, { method = 'GET', body, form, signal } = {}) {
  const url = `${API_BASE}${path}`
  const headers = {}
  let payload

  if (form) {
    payload = form
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }

  let response
  try {
    response = await fetch(url, { method, headers, body: payload, signal })
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new ApiError(
      `Cannot reach the RecallCraft API at ${API_BASE}. Is the backend running?`,
      0,
      null,
    )
  }

  if (response.status === 204) return null

  const isJson = (response.headers.get('content-type') || '').includes('application/json')
  const data = isJson ? await response.json().catch(() => null) : await response.text()

  if (!response.ok) {
    throw new ApiError(
      extractDetail(data, `${response.status} ${response.statusText}`),
      response.status,
      data,
    )
  }
  return data
}

const qs = (params = {}) => {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '' || value === false) return
    search.append(key, String(value))
  })
  const s = search.toString()
  return s ? `?${s}` : ''
}

export const api = {
  // --- system -------------------------------------------------------------
  health: (opts) => request('/health', opts),
  llmStatus: (opts) => request('/system/llm', opts),
  llmTest: (prompt, opts) =>
    request('/system/llm/test', { method: 'POST', body: { prompt }, ...opts }),
  resetDeck: (opts) => request('/system/reset?confirm=true', { method: 'POST', ...opts }),

  // --- materials ----------------------------------------------------------
  listMaterials: (params, opts) => request(`/materials${qs(params)}`, opts),
  getMaterial: (id, opts) => request(`/materials/${id}`, opts),
  getMaterialChunks: (id, opts) => request(`/materials/${id}/chunks`, opts),
  createMaterial: (payload, opts) =>
    request('/materials', { method: 'POST', body: payload, ...opts }),
  uploadMaterial: (file, title, opts) => {
    const form = new FormData()
    form.append('file', file)
    if (title) form.append('title', title)
    return request('/materials/upload', { method: 'POST', form, ...opts })
  },
  deleteMaterial: (id, opts) => request(`/materials/${id}`, { method: 'DELETE', ...opts }),
  generate: (id, payload, opts) =>
    request(`/materials/${id}/generate`, { method: 'POST', body: payload, ...opts }),
  exportAnki: (id, opts) =>
    requestBlob(`/materials/${id}/export/anki`, { fallbackName: 'recallcraft-deck.apkg', ...opts }),

  // --- cards --------------------------------------------------------------
  listCards: (params, opts) => request(`/cards${qs(params)}`, opts),
  getCard: (id, opts) => request(`/cards/${id}`, opts),
  cardHistory: (id, opts) => request(`/cards/${id}/history`, opts),
  cardLineage: (id, opts) => request(`/cards/${id}/lineage`, opts),
  deleteCard: (id, opts) => request(`/cards/${id}`, { method: 'DELETE', ...opts }),

  // --- review -------------------------------------------------------------
  queue: (params, opts) => request(`/review/queue${qs(params)}`, opts),
  submitReview: (payload, opts) =>
    request('/review/submit', { method: 'POST', body: payload, ...opts }),
  logs: (params, opts) => request(`/review/logs${qs(params)}`, opts),

  // --- stats --------------------------------------------------------------
  stats: (opts) => request('/stats', opts),
}

export default api
