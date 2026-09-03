import { useCallback, useEffect, useRef, useState } from 'react'
import { loadSession } from './auth'
import { askLuge, LugeChatQuotaError } from './lugeChat'
import { getProactivePoiContext } from './proactiveContext'
import { getSpeechRecognitionModule, releaseMicForPlayback } from './speechRecognition'
import type { UserCoords } from './location'

/** 语音助手式窗口：首次不说话 5 秒取消，说过话后约 1.5 秒静音结束本句。 */
export const VOICE_INITIAL_TIMEOUT_MS = 5_000
export const VOICE_SILENCE_TIMEOUT_MS = 1_500
export const VOICE_FOLLOW_UP_TIMEOUT_MS = 5_000

export type VoiceInteractionState = 'idle' | 'listening' | 'thinking' | 'follow_up'

export function useVoiceInteraction(opts: {
  active: boolean
  coords: UserCoords | null
  say: (text: string, token?: string | null) => Promise<void>
  recordRound: (user: string, assistant: string) => void
  onError?: (message: string) => void
  onQuotaExhausted?: (e: LugeChatQuotaError) => void
}) {
  const [state, setState] = useState<VoiceInteractionState>('idle')
  const stateRef = useRef<VoiceInteractionState>('idle')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const transcriptRef = useRef('')
  const submittedRef = useRef(false)
  const conversationRef = useRef<Array<{ role: 'user' | 'assistant'; content: string }>>([])
  const unsubsRef = useRef<Array<{ remove: () => void }>>([])
  const optsRef = useRef(opts)
  optsRef.current = opts

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const setPhase = useCallback((next: VoiceInteractionState) => {
    stateRef.current = next
    setState(next)
  }, [])

  const cleanupListeners = useCallback(() => {
    for (const sub of unsubsRef.current) sub.remove()
    unsubsRef.current = []
  }, [])

  const finishListening = useCallback(() => {
    clearTimer()
    try {
      getSpeechRecognitionModule()?.stop()
    } catch {
      /* ignore */
    }
  }, [clearTimer])

  const listen = useCallback((followUp: boolean) => {
    const mod = getSpeechRecognitionModule()
    if (!mod || !mod.isRecognitionAvailable()) {
      optsRef.current.onError?.('当前设备不支持语音识别')
      setPhase('idle')
      return
    }
    cleanupListeners()
    clearTimer()
    transcriptRef.current = ''
    submittedRef.current = false
    setPhase(followUp ? 'follow_up' : 'listening')
    const timeout = followUp ? VOICE_FOLLOW_UP_TIMEOUT_MS : VOICE_INITIAL_TIMEOUT_MS
    timerRef.current = setTimeout(() => finishListening(), timeout)
    unsubsRef.current = [
      mod.addListener('result', (event) => {
        if (!event || !('results' in event)) return
        const text = event.results?.[0]?.transcript?.trim() ?? ''
        if (!text) return
        transcriptRef.current = text
        clearTimer()
        timerRef.current = setTimeout(() => finishListening(), VOICE_SILENCE_TIMEOUT_MS)
      }),
      mod.addListener('end', () => {
        clearTimer()
        cleanupListeners()
        const text = transcriptRef.current.trim()
        if (!text || submittedRef.current) {
          setPhase('idle')
          return
        }
        submittedRef.current = true
        const current = optsRef.current
        if (!current.active || !current.coords) {
          setPhase('idle')
          return
        }
        void (async () => {
          setPhase('thinking')
          try {
            const session = await loadSession()
            const result = await askLuge(current.coords!, text, session?.access_token, {
              conversation: conversationRef.current,
              proactiveContext: getProactivePoiContext(),
            })
            const nextConversation: Array<{ role: 'user' | 'assistant'; content: string }> = [
              ...conversationRef.current,
              { role: 'user', content: text },
              { role: 'assistant', content: result.answer },
            ]
            conversationRef.current = nextConversation.slice(-12)
            current.recordRound(text, result.answer)
            await current.say(result.answer, session?.access_token)
            if (optsRef.current.active) listen(true)
            else setPhase('idle')
          } catch (e) {
            if (e instanceof LugeChatQuotaError) optsRef.current.onQuotaExhausted?.(e)
            else optsRef.current.onError?.(e instanceof Error ? e.message : '路鸽暂时无法回答')
            setPhase('idle')
          }
        })()
      }),
      mod.addListener('error', (event) => {
        if (__DEV__ && event) console.warn('[voice interaction]', event)
        clearTimer()
        cleanupListeners()
        setPhase('idle')
      }),
    ]
    try {
      mod.start({ lang: 'zh-CN', interimResults: true, continuous: false, addsPunctuation: true })
    } catch {
      cleanupListeners()
      setPhase('idle')
    }
  }, [cleanupListeners, clearTimer, finishListening, setPhase])

  const start = useCallback(async () => {
    if (!optsRef.current.active || stateRef.current !== 'idle') return
    const mod = getSpeechRecognitionModule()
    if (!mod) return
    const permission = await mod.requestPermissionsAsync()
    if (!permission.granted) {
      optsRef.current.onError?.('需要麦克风和语音识别权限')
      return
    }
    await releaseMicForPlayback()
    listen(false)
  }, [listen])

  const startFollowUp = useCallback(async () => {
    if (!optsRef.current.active || stateRef.current !== 'idle') return
    await releaseMicForPlayback()
    listen(true)
  }, [listen])

  useEffect(() => {
    if (opts.active) return
    clearTimer()
    cleanupListeners()
    try {
      getSpeechRecognitionModule()?.abort()
    } catch {
      /* ignore */
    }
    setPhase('idle')
  }, [opts.active, clearTimer, cleanupListeners, setPhase])

  useEffect(() => () => {
    clearTimer()
    cleanupListeners()
    try {
      getSpeechRecognitionModule()?.abort()
    } catch {
      /* ignore */
    }
  }, [clearTimer, cleanupListeners])

  return { state, start, startFollowUp }
}
