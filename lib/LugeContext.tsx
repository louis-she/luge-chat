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
import { readUserCoords } from './location'
import { useQuota } from './QuotaContext'
import {
  askLugeGuide,
  LugeChatQuotaError,
} from './lugeChat'
import { speakVolcano, stopVolcanoSpeech } from './volcanoTts'

type SayOptions = {
  /** 主动讲解内容写入近期对话，便于用户追问「刚才那个」 */
  recordProactive?: boolean
}

type LugeContextValue = {
  isActive: boolean
  speech: string | null
  isThinking: boolean
  isSpeaking: boolean
  conversationReady: boolean
  startLuge: (opts?: { skipGreeting?: boolean }) => void
  stopLuge: () => void
  say: (text: string, accessToken?: string | null, options?: SayOptions) => Promise<void>
  ask: (message: string) => Promise<void>
  runWhileThinking: (fn: () => Promise<void>) => Promise<void>
  /** 主动讲解文案写入近期对话（RTC ExternalTTS 不走 say 时用） */
  recordProactiveSpeech: (text: string) => void
}

const LugeContext = createContext<LugeContextValue | null>(null)

const GREETING = '路鸽已启动'

function toUserFacingAskError(error: unknown) {
  const msg = error instanceof Error ? error.message : ''

  if (msg.includes('需要定位权限')) return '需要定位权限，我才能结合你的位置回答'
  if (msg.includes('无法获取当前位置')) return '我暂时拿不到当前位置，请稍后再试'
  if (msg.includes('没听清')) return '我刚刚没听清，请再说一次'
  if (msg.includes('调试流') || msg.includes('deepseek') || msg.includes('TTS')) {
    return '我刚刚开了个小差，请再问我一次'
  }
  if (/[\\/:[\]{}]/.test(msg) || /https?:\/\//i.test(msg) || /\b(exception|error|failed|timeout)\b/i.test(msg)) {
    return '我刚刚出了点小问题，请再问我一次'
  }
  return '我暂时没法回答这个问题，请稍后再试'
}

export function LugeProvider({ children }: { children: ReactNode }) {
  const [isActive, setIsActive] = useState(false)
  const [speech, setSpeech] = useState<string | null>(null)
  const [isThinking, setIsThinking] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [conversationReady, setConversationReady] = useState(false)
  const { refreshQuota, showExhausted } = useQuota()
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

      try {
        let ttsToken = accessToken ?? sessionRef.current
        if (!ttsToken) {
          const session = await loadSession()
          sessionRef.current = session?.access_token ?? null
          ttsToken = sessionRef.current
        }
        await speakVolcano(text, ttsToken)
        if (options?.recordProactive && text.trim()) {
          chatWindowRef.current.appendProactive(text.trim())
        }
      } catch (e) {
        if (__DEV__) console.warn('[luge tts]', e)
      } finally {
        sayBusyRef.current = false
        setIsSpeaking(false)
      }
    },
    [],
  )

  const runWhileThinking = useCallback(async (fn: () => Promise<void>) => {
    if (isThinking || sayBusyRef.current) return
    setIsThinking(true)
    try {
      await fn()
    } finally {
      setIsThinking(false)
    }
  }, [isThinking])

  const recordProactiveSpeech = useCallback((text: string) => {
    const t = text.trim()
    if (t) chatWindowRef.current.appendProactive(t)
  }, [])

  const ask = useCallback(
    async (message: string) => {
      if (!message.trim() || isThinking || sayBusyRef.current) return
      const userText = message.trim()
      setIsThinking(true)
      setSpeech(isDevSimulator() ? '稍等，我看看周围…' : null)
      await stopVolcanoSpeech()

      try {
        const coords = await readUserCoords()
        const session = await loadSession()
        sessionRef.current = session?.access_token ?? null
        const recentMessages = chatWindowRef.current.snapshot()
        if (__DEV__) {
          console.log(
            '[luge] 发起提问…',
            recentMessages.length > 0 ? `近期 ${recentMessages.length} 条` : '',
          )
        }
        const result = await askLugeGuide(
          userText,
          coords,
          sessionRef.current,
          recentMessages,
        )
        if (result.ignored) {
          if (__DEV__) {
            console.log('[luge] 已忽略输入', result.ignore_reason ?? '')
          }
          setIsThinking(false)
          return
        }
        if (__DEV__) console.log('[luge] 回答就绪，开始合成语音…')
        setIsThinking(false)
        await say(result.answer, sessionRef.current)
        if (result.answer.trim()) {
          chatWindowRef.current.appendRound(userText, result.answer.trim())
        }
        if (result.quota) void refreshQuota()
      } catch (e) {
        if (e instanceof LugeChatQuotaError) {
          showExhausted(e.payload)
          setSpeech(null)
          return
        }
        console.warn('[luge ask]', e)
        setIsThinking(false)
        await say(toUserFacingAskError(e), sessionRef.current)
      } finally {
        setIsThinking(false)
      }
    },
    [isThinking, say, refreshQuota, showExhausted],
  )

  const startLuge = useCallback((opts?: { skipGreeting?: boolean }) => {
    chatWindowRef.current.clear()
    setIsActive(true)
    setSpeech(null)
    setConversationReady(false)
    if (opts?.skipGreeting) {
      setConversationReady(true)
      return
    }
    greetingTimer.current = setTimeout(() => {
      void say(GREETING).finally(() => setConversationReady(true))
    }, 600)
  }, [say])

  const stopLuge = useCallback(() => {
    if (greetingTimer.current) clearTimeout(greetingTimer.current)
    if (dismissTimer.current) clearTimeout(dismissTimer.current)
    void stopVolcanoSpeech()
    chatWindowRef.current.clear()
    setIsActive(false)
    setSpeech(null)
    setIsThinking(false)
    setIsSpeaking(false)
    setConversationReady(false)
  }, [])

  const value = useMemo(
    () => ({
      isActive,
      speech,
      isThinking,
      isSpeaking,
      conversationReady,
      startLuge,
      stopLuge,
      say,
      ask,
      runWhileThinking,
      recordProactiveSpeech,
    }),
    [
      isActive,
      speech,
      isThinking,
      isSpeaking,
      conversationReady,
      startLuge,
      stopLuge,
      say,
      ask,
      runWhileThinking,
      recordProactiveSpeech,
    ],
  )

  return <LugeContext.Provider value={value}>{children}</LugeContext.Provider>
}

export function useLuge() {
  const ctx = useContext(LugeContext)
  if (!ctx) throw new Error('useLuge must be used within LugeProvider')
  return ctx
}
