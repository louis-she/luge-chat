import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useAuth } from './AuthContext'
import { loadSession } from './auth'
import {
  fetchQuota,
  type QuotaExhaustedPayload,
  type QuotaStatus,
} from './quota'

type QuotaContextValue = {
  quota: QuotaStatus | null
  loading: boolean
  refreshQuota: () => Promise<void>
  exhausted: QuotaExhaustedPayload | null
  showExhausted: (payload: QuotaExhaustedPayload) => void
  clearExhausted: () => void
}

const QuotaContext = createContext<QuotaContextValue | null>(null)

export function QuotaProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [quota, setQuota] = useState<QuotaStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [exhausted, setExhausted] = useState<QuotaExhaustedPayload | null>(null)

  const refreshQuota = useCallback(async () => {
    setLoading(true)
    try {
      const session = await loadSession()
      const data = await fetchQuota(session?.access_token)
      setQuota(data)
    } catch {
      setQuota(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshQuota()
  }, [user?.id, refreshQuota])

  const value = useMemo(
    () => ({
      quota,
      loading,
      refreshQuota,
      exhausted,
      showExhausted: setExhausted,
      clearExhausted: () => setExhausted(null),
    }),
    [quota, loading, refreshQuota, exhausted],
  )

  return <QuotaContext.Provider value={value}>{children}</QuotaContext.Provider>
}

export function useQuota() {
  const ctx = useContext(QuotaContext)
  if (!ctx) throw new Error('useQuota must be used within QuotaProvider')
  return ctx
}
