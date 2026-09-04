import { useCallback, useEffect, useRef, useState } from 'react'
import { loadSession } from './auth'
import { askLuge, LugeChatQuotaError } from './lugeChat'
import { getProactivePoiContext } from './proactiveContext'
import { getSpeechRecognitionModule, releaseMicForPlayback } from './speechRecognition'
import type { UserCoords } from './location'

/** 语音助手式窗口：首次/追问不说话 5 秒取消；有转写后按新结果静音收句。 */
export const VOICE_INITIAL_TIMEOUT_MS = 5_000
export const VOICE_FOLLOW_UP_TIMEOUT_MS = 5_000
export const VOICE_SILENCE_TIMEOUT_MS = 3_000

export type VoiceInteractionState = 'idle' | 'listening' | 'thinking' | 'follow_up'

export function useVoiceInteraction(opts: {
  active: boolean
  coords: UserCoords | null
  say: (text: string, token?: string | null) => Promise<void>
  recordRound: (user: string, assistant: string) => void
  getConversation: () => Array<{ role: 'user' | 'assistant'; content: string }>
  onError?: (message: string) => void
  onQuotaExhausted?: (e: LugeChatQuotaError) => void
}) {
  const [state, setState] = useState<VoiceInteractionState>('idle')
  const stateRef = useRef<VoiceInteractionState>('idle')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const transcriptRef = useRef('')
  const submittedRef = useRef(false)
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
      if (__DEV__) console.warn('[voice interaction] 语音识别模块不可用')
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
    const markSpeechActivity = () => {
      clearTimer()
      timerRef.current = setTimeout(
        () => finishListening(),
        VOICE_SILENCE_TIMEOUT_MS,
      )
    }
    unsubsRef.current = [
      mod.addListener('start', () => {
        if (__DEV__) console.log('[voice interaction] ASR 已启动', { followUp })
      }),
      mod.addListener('speechstart', () => {
        if (__DEV__) console.log('[voice interaction] 检测到用户讲话')
        markSpeechActivity()
      }),
      mod.addListener('result', (event) => {
        if (!event || !('results' in event)) return
        const text = event.results?.[0]?.transcript?.trim() ?? ''
        if (!text) return
        if (__DEV__) {
          console.log('[voice interaction] ASR 结果', {
            text,
            isFinal: 'isFinal' in event ? event.isFinal : undefined,
          })
        }
        if (text === transcriptRef.current) return
        transcriptRef.current = text
        markSpeechActivity()
      }),
      mod.addListener('end', () => {
        clearTimer()
        cleanupListeners()
        const text = transcriptRef.current.trim()
        if (__DEV__) console.log('[voice interaction] ASR 结束', { text })
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
              conversation: current.getConversation(),
              proactiveContext: getProactivePoiContext(),
            })
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
        const errorCode = event && 'error' in event ? String(event.error ?? '') : ''
        const errorMessage = event && 'message' in event ? String(event.message ?? '') : ''
        if (
          errorCode === 'no-speech' ||
          errorMessage.toLowerCase().includes('no speech')
        ) {
          if (__DEV__) console.log('[voice interaction] 忽略正常的无讲话事件')
          setPhase('idle')
          return
        }
        if (errorMessage) {
          optsRef.current.onError?.(`语音识别失败：${errorMessage}`)
        }
        setPhase('idle')
      }),
    ]
    if (__DEV__) console.log('[voice interaction] 请求启动 ASR', { followUp })
    try {
      mod.start({
        lang: 'zh-CN',
        interimResults: true,
        continuous: true,
        addsPunctuation: true,
        // 不使用 measurement，避免识别结束后把低输出的音频会话带给下一次 TTS。
        iosCategory: {
          category: 'playAndRecord',
          categoryOptions: ['defaultToSpeaker', 'allowBluetooth'],
          mode: 'default',
        },
      })
    } catch (e) {
      if (__DEV__) console.warn('[voice interaction] ASR 启动失败', e)
      cleanupListeners()
      optsRef.current.onError?.('语音识别启动失败，请再试一次')
      setPhase('idle')
    }
  }, [cleanupListeners, clearTimer, finishListening, setPhase])

  const start = useCallback(async () => {
    if (!optsRef.current.active || stateRef.current !== 'idle') {
      if (__DEV__) {
        console.log('[voice interaction] 忽略启动', {
          active: optsRef.current.active,
          state: stateRef.current,
        })
      }
      return
    }
    const mod = getSpeechRecognitionModule()
    if (!mod) {
      if (__DEV__) console.warn('[voice interaction] 点击时未找到 ASR 模块')
      optsRef.current.onError?.('当前设备不支持语音识别')
      return
    }
    if (__DEV__) console.log('[voice interaction] 点击开始收音')
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
