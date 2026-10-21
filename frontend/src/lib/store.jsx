import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import api from './api'

const AppDataContext = createContext(null)

/**
 * App-wide data that many screens read: deck statistics and backend health.
 * Both are cheap endpoints, so we simply refetch on demand after any mutation.
 */
export function AppDataProvider({ children }) {
  const [stats, setStats] = useState(null)
  const [health, setHealth] = useState(null)
  const [statsError, setStatsError] = useState(null)
  const [healthError, setHealthError] = useState(null)

  const refreshStats = useCallback(async () => {
    try {
      const data = await api.stats()
      setStats(data)
      setStatsError(null)
      return data
    } catch (err) {
      setStatsError(err)
      return null
    }
  }, [])

  const refreshHealth = useCallback(async () => {
    try {
      const data = await api.health()
      setHealth(data)
      setHealthError(null)
      return data
    } catch (err) {
      setHealthError(err)
      setHealth(null)
      return null
    }
  }, [])

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshStats(), refreshHealth()])
  }, [refreshStats, refreshHealth])

  useEffect(() => {
    refreshAll()
  }, [refreshAll])

  return (
    <AppDataContext.Provider
      value={{ stats, health, statsError, healthError, refreshStats, refreshHealth, refreshAll }}
    >
      {children}
    </AppDataContext.Provider>
  )
}

export function useAppData() {
  const context = useContext(AppDataContext)
  if (!context) throw new Error('useAppData must be used within <AppDataProvider>')
  return context
}
