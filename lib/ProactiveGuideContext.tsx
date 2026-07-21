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
  DEFAULT_PROACTIVE_SETTINGS,
  loadProactiveSettings,
  saveProactiveSettings,
  type ProactiveGuideSettings,
} from './proactiveSettings'

type ProactiveGuideContextValue = {
  ready: boolean
  settings: ProactiveGuideSettings
  setEnabled: (enabled: boolean) => Promise<void>
}

const ProactiveGuideContext = createContext<ProactiveGuideContextValue | null>(null)

export function ProactiveGuideProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [settings, setSettings] = useState<ProactiveGuideSettings>(DEFAULT_PROACTIVE_SETTINGS)

  useEffect(() => {
    void loadProactiveSettings().then((s) => {
      setSettings(s)
      setReady(true)
    })
  }, [])

  const setEnabled = useCallback(async (enabled: boolean) => {
    const saved = await saveProactiveSettings({ enabled })
    setSettings(saved)
  }, [])

  const value = useMemo(
    () => ({
      ready,
      settings,
      setEnabled,
    }),
    [ready, settings, setEnabled],
  )

  return (
    <ProactiveGuideContext.Provider value={value}>
      {children}
    </ProactiveGuideContext.Provider>
  )
}

export function useProactiveGuideSettings() {
  const ctx = useContext(ProactiveGuideContext)
  if (!ctx) {
    throw new Error('useProactiveGuideSettings must be used within ProactiveGuideProvider')
  }
  return ctx
}
