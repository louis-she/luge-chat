import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  clearSession,
  fetchDevSandboxPersonas,
  loadSession,
  loginWithApple,
  loginWithDevSandbox,
  loginWithWechat,
  saveSession,
} from './auth'
import { isAppleLoginSupported } from './apple'
import { isDevSimulator } from './isDevSimulator'
import type { AuthUser, DevSandboxPersona } from './types'
import { initWechatSdk, isWechatLoginSupported } from './wechat'

type AuthContextValue = {
  user: AuthUser | null
  loading: boolean
  loggingIn: string | null
  wechatAvailable: boolean
  appleAvailable: boolean
  devLoginAvailable: boolean
  devPersonas: DevSandboxPersona[]
  error: string | null
  loginWithWechat: () => Promise<void>
  loginWithApple: () => Promise<void>
  loginWithDevSandbox: (persona: string) => Promise<void>
  logout: () => Promise<void>
  patchBalanceAsks: (balanceAsks: number) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [loggingIn, setLoggingIn] = useState<string | null>(null)
  const [devPersonas, setDevPersonas] = useState<DevSandboxPersona[]>([])
  const [error, setError] = useState<string | null>(null)
  const [appleAvailable, setAppleAvailable] = useState(false)
  const wechatAvailable = isWechatLoginSupported()
  const devLoginAvailable = isDevSimulator()

  useEffect(() => {
    initWechatSdk().catch(() => {})
  }, [])

  useEffect(() => {
    isAppleLoginSupported()
      .then(setAppleAvailable)
      .catch(() => setAppleAvailable(false))
  }, [])

  useEffect(() => {
    if (!__DEV__) return
    fetchDevSandboxPersonas()
      .then(setDevPersonas)
      .catch(() => {})
  }, [])

  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      try {
        const session = await loadSession()
        if (!cancelled && session) setUser(session.user)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '初始化失败')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    bootstrap()
    return () => {
      cancelled = true
    }
  }, [])

  const handleWechatLogin = useCallback(async () => {
    setLoggingIn('wechat')
    setError(null)
    try {
      const session = await loginWithWechat()
      await saveSession(session)
      setUser(session.user)
    } catch (e) {
      setError(e instanceof Error ? e.message : '微信登录失败')
      throw e
    } finally {
      setLoggingIn(null)
    }
  }, [])

  const handleAppleLogin = useCallback(async () => {
    setLoggingIn('apple')
    setError(null)
    try {
      const session = await loginWithApple()
      await saveSession(session)
      setUser(session.user)
    } catch (e) {
      const code = (e as { code?: string })?.code
      if (code === 'ERR_REQUEST_CANCELED') {
        setError(null)
        return
      }
      setError(e instanceof Error ? e.message : 'Apple 登录失败')
      throw e
    } finally {
      setLoggingIn(null)
    }
  }, [])

  const handleDevLogin = useCallback(async (persona: string) => {
    setLoggingIn(persona)
    setError(null)
    try {
      const session = await loginWithDevSandbox(persona)
      await saveSession(session)
      setUser(session.user)
    } catch (e) {
      setError(e instanceof Error ? e.message : '开发登录失败')
      throw e
    } finally {
      setLoggingIn(null)
    }
  }, [])

  const logout = useCallback(async () => {
    await clearSession()
    setUser(null)
    setError(null)
  }, [])

  const patchBalanceAsks = useCallback(async (balanceAsks: number) => {
    const session = await loadSession()
    if (!session) return
    const nextUser = { ...session.user, balance_asks: balanceAsks }
    await saveSession({ ...session, user: nextUser })
    setUser(nextUser)
  }, [])

  const value = useMemo(
    () => ({
      user,
      loading,
      loggingIn,
      wechatAvailable,
      appleAvailable,
      devLoginAvailable,
      devPersonas,
      error,
      loginWithWechat: handleWechatLogin,
      loginWithApple: handleAppleLogin,
      loginWithDevSandbox: handleDevLogin,
      logout,
      patchBalanceAsks,
    }),
    [
      user,
      loading,
      loggingIn,
      wechatAvailable,
      appleAvailable,
      devLoginAvailable,
      devPersonas,
      error,
      handleWechatLogin,
      handleAppleLogin,
      handleDevLogin,
      logout,
      patchBalanceAsks,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
