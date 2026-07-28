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
  type ProactiveSpeakLength,
} from './proactiveSettings'

type ProactiveGuideContextValue = {
  ready: boolean
  settings: ProactiveGuideSettings
  setEnabled: (enabled: boolean) => Promise<void>
  updateSettings: (patch: Partial<ProactiveGuideSettings>) => Promise<ProactiveGuideSettings>
  setSpeakLength: (speakLength: ProactiveSpeakLength) => Promise<void>
  bumpAnchorNonce: () => Promise<void>
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

  const updateSettings = useCallback(async (patch: Partial<ProactiveGuideSettings>) => {
    const saved = await saveProactiveSettings(patch)
    setSettings(saved)
    return saved
  }, [])

  const setEnabled = useCallback(
    async (enabled: boolean) => {
      await updateSettings({ enabled })
    },
    [updateSettings],
  )

  const setSpeakLength = useCallback(
    async (speakLength: ProactiveSpeakLength) => {
      await updateSettings({ speakLength })
    },
    [updateSettings],
  )

  const bumpAnchorNonce = useCallback(async () => {
    await updateSettings({ anchorNonce: settings.anchorNonce + 1 })
  }, [settings.anchorNonce, updateSettings])

  const value = useMemo(
    () => ({
      ready,
      settings,
      setEnabled,
      updateSettings,
      setSpeakLength,
      bumpAnchorNonce,
    }),
    [ready, settings, setEnabled, updateSettings, setSpeakLength, bumpAnchorNonce],
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
