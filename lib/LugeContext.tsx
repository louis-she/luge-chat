import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { loadSession } from './auth'
import { bubbleVisibleMs } from './bubbleTiming'
import { createChatWindow } from './chatWindow'
import { isDevSimulator } from './isDevSimulator'
import { speakVolcano, stopVolcanoSpeech, type TtsPhase } from './volcanoTts'

type SayOptions = {
  /** 主动讲解内容写入近期对话，便于用户追问「刚才那个」 */
  recordProactive?: boolean
}

type LugeContextValue = {
  isActive: boolean
  speech: string | null
  isThinking: boolean
  isSpeaking: boolean
  speechPhase: 'idle' | TtsPhase
  conversationReady: boolean
  startLuge: (opts?: { skipGreeting?: boolean }) => void
  stopLuge: () => void
  say: (text: string, accessToken?: string | null, options?: SayOptions) => Promise<void>
  runWhileThinking: (fn: () => Promise<void>) => Promise<boolean>
  /** 主动讲解文案写入近期对话，便于后续追问 */
  recordProactiveSpeech: (text: string) => void
  recordRound: (user: string, assistant: string) => void
  getConversation: () => Array<{ role: 'user' | 'assistant'; content: string }>
}

const LugeContext = createContext<LugeContextValue | null>(null)

export function LugeProvider({ children }: { children: ReactNode }) {
  const [isActive, setIsActive] = useState(false)
  const [speech, setSpeech] = useState<string | null>(null)
  const [isThinking, setIsThinking] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [speechPhase, setSpeechPhase] = useState<'idle' | TtsPhase>('idle')
  const [conversationReady, setConversationReady] = useState(false)
  const greetingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const sessionRef = useRef<string | null>(null)
  const sayBusyRef = useRef(false)
  const chatWindowRef = useRef(createChatWindow())

  const say = useCallback(
    async (text: string, accessToken?: string | null, options?: SayOptions) => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current)
      if (isDevSimulator()) {
        setSpeech(text)
        dismissTimer.current = setTimeout(
          () => setSpeech(null),
          bubbleVisibleMs(text),
        )
      } else {
        setSpeech(null)
      }

      await stopVolcanoSpeech()
      sayBusyRef.current = true
      setIsSpeaking(true)
      setSpeechPhase('preparing')

      try {
        let ttsToken = accessToken ?? sessionRef.current
        if (!ttsToken) {
          const session = await loadSession()
          sessionRef.current = session?.access_token ?? null
          ttsToken = sessionRef.current
        }
        await speakVolcano(text, ttsToken, { onPhase: setSpeechPhase })
        if (options?.recordProactive && text.trim()) {
          chatWindowRef.current.appendProactive(text.trim())
        }
      } catch (e) {
        if (__DEV__) console.warn('[luge tts]', e)
      } finally {
        sayBusyRef.current = false
        setIsSpeaking(false)
        setSpeechPhase('idle')
      }
    },
    [],
  )

  const runWhileThinking = useCallback(async (fn: () => Promise<void>): Promise<boolean> => {
    if (isThinking || sayBusyRef.current) return false
    setIsThinking(true)
    try {
      await fn()
      return true
    } finally {
      setIsThinking(false)
    }
  }, [isThinking])

  const recordProactiveSpeech = useCallback((text: string) => {
    const t = text.trim()
    if (t) chatWindowRef.current.appendProactive(t)
  }, [])

  const recordRound = useCallback((user: string, assistant: string) => {
    chatWindowRef.current.appendRound(user, assistant)
  }, [])

  const getConversation = useCallback(
    () => chatWindowRef.current.snapshot(),
    [],
  )

  const startLuge = useCallback((_opts?: { skipGreeting?: boolean }) => {
    chatWindowRef.current.clear()
    setIsActive(true)
    setSpeech(null)
    // RTC 欢迎语由火山 WelcomeMessage 播；本地立即进入可主动讲解状态
    setConversationReady(true)
  }, [])

  const stopLuge = useCallback(() => {
    if (greetingTimer.current) clearTimeout(greetingTimer.current)
    if (dismissTimer.current) clearTimeout(dismissTimer.current)
    void stopVolcanoSpeech()
    chatWindowRef.current.clear()
    setIsActive(false)
    setSpeech(null)
    setIsThinking(false)
    setIsSpeaking(false)
    setSpeechPhase('idle')
    setConversationReady(false)
  }, [])

  const value = useMemo(
    () => ({
      isActive,
      speech,
      isThinking,
      isSpeaking,
      speechPhase,
      conversationReady,
      startLuge,
      stopLuge,
      say,
      runWhileThinking,
      recordProactiveSpeech,
      recordRound,
      getConversation,
    }),
    [
      isActive,
      speech,
      isThinking,
      isSpeaking,
      speechPhase,
      conversationReady,
      startLuge,
      stopLuge,
      say,
      runWhileThinking,
      recordProactiveSpeech,
      recordRound,
      getConversation,
    ],
  )

  return <LugeContext.Provider value={value}>{children}</LugeContext.Provider>
}

export function useLuge() {
  const ctx = useContext(LugeContext)
  if (!ctx) throw new Error('useLuge must be used within LugeProvider')
  return ctx
}
