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
  DEFAULT_TTS_SPEAKER,
  loadTtsSpeaker,
  saveTtsSpeaker,
  TTS_VOICES,
  type TtsVoice,
} from './ttsVoices'

type TtsVoiceContextValue = {
  ready: boolean
  speakerId: string
  voices: TtsVoice[]
  setSpeakerId: (id: string) => Promise<void>
}

const TtsVoiceContext = createContext<TtsVoiceContextValue | null>(null)

export function TtsVoiceProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [speakerId, setSpeakerIdState] = useState(DEFAULT_TTS_SPEAKER)

  useEffect(() => {
    void loadTtsSpeaker().then((id) => {
      setSpeakerIdState(id)
      setReady(true)
    })
  }, [])

  const setSpeakerId = useCallback(async (id: string) => {
    const saved = await saveTtsSpeaker(id)
    setSpeakerIdState(saved)
  }, [])

  const value = useMemo(
    () => ({
      ready,
      speakerId,
      voices: TTS_VOICES,
      setSpeakerId,
    }),
    [ready, speakerId, setSpeakerId],
  )

  return (
    <TtsVoiceContext.Provider value={value}>{children}</TtsVoiceContext.Provider>
  )
}

export function useTtsVoice() {
  const ctx = useContext(TtsVoiceContext)
  if (!ctx) throw new Error('useTtsVoice must be used within TtsVoiceProvider')
  return ctx
}
