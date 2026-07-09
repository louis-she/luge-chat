import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getSpeechRecognitionModule,
  type SpeechErrorEvent,
  type SpeechResultEvent,
} from './speechRecognition'
import { stopVolcanoSpeech } from './volcanoTts'

const VOICE_FILLER_PHRASES = new Set([
  '嗯',
  '嗯嗯',
  '啊',
  '啊啊',
  '哦',
  '哦哦',
  '呃',
  '呃呃',
  '欸',
  '诶',
  '唉',
  '哎',
  '哈',
  '哈哈',
  '嘿',
  '喂',
  '好的',
  '好吧',
  '行',
  '行吧',
  '可以',
  '收到',
  '没事',
])

function normalizeVoiceText(text: string) {
  return text
    .trim()
    .replace(/[，。！？、,.!?~～…\s]/g, '')
}

function looksLikeQuestionOrCommand(text: string) {
  return /[?？]|怎么|为什么|多少|哪里|哪儿|哪|什么|谁|几|介绍|说说|讲讲|告诉我|看看|前面|后面|左边|右边|附近|这是|那是|这个|那个|路鸽|小鸽/.test(
    text,
  )
}

function shouldSubmitVoiceText(text: string) {
  const normalized = normalizeVoiceText(text)
  if (!normalized) return false
  if (VOICE_FILLER_PHRASES.has(normalized)) return false
  if (normalized.length <= 1) return false
  if (normalized.length <= 3 && !looksLikeQuestionOrCommand(text)) return false
  return true
}

type VoiceInputOptions = {
  onError?: (message: string) => void
  onPermissionDenied?: () => void
  /** 为 false 时不应开麦（如 TTS 播放中） */
  canListen?: () => boolean
}

export function useVoiceInput(
  onSubmit: (text: string) => void,
  options?: VoiceInputOptions,
) {
  const [isListening, setIsListening] = useState(false)
  const [partial, setPartial] = useState<string | null>(null)
  const [available, setAvailable] = useState(false)
  const transcriptRef = useRef('')
  const submittedRef = useRef(false)
  const onSubmitRef = useRef(onSubmit)
  const onErrorRef = useRef(options?.onError)

  useEffect(() => {
    onSubmitRef.current = onSubmit
  }, [onSubmit])

  useEffect(() => {
    onErrorRef.current = options?.onError
  }, [options?.onError])

  const onPermissionDeniedRef = useRef(options?.onPermissionDenied)
  const canListenRef = useRef(options?.canListen)
  useEffect(() => {
    onPermissionDeniedRef.current = options?.onPermissionDenied
  }, [options?.onPermissionDenied])
  useEffect(() => {
    canListenRef.current = options?.canListen
  }, [options?.canListen])

  const submitIfReady = useCallback(() => {
    if (submittedRef.current) return
    const text = transcriptRef.current.trim()
    transcriptRef.current = ''
    setPartial(null)
    if (!text) return
    if (!shouldSubmitVoiceText(text)) {
      if (__DEV__) console.log('[voice] 忽略低意图输入:', text)
      return
    }
    submittedRef.current = true
    onSubmitRef.current(text)
  }, [])

  useEffect(() => {
    const mod = getSpeechRecognitionModule()
    setAvailable(!!mod?.isRecognitionAvailable())

    if (!mod) return

    const subs = [
      mod.addListener('start', () => {
        submittedRef.current = false
        setIsListening(true)
      }),
      mod.addListener('end', () => {
        setIsListening(false)
        submitIfReady()
      }),
      mod.addListener('result', (event) => {
        const e = event as SpeechResultEvent
        const text = e.results[0]?.transcript ?? ''
        transcriptRef.current = text
        setPartial(text || null)
        if (e.isFinal && text.trim()) {
          mod.stop()
        }
      }),
      mod.addListener('error', (event) => {
        const e = event as SpeechErrorEvent
        if (__DEV__ && e.error !== 'aborted' && e.error !== 'no-speech') {
          console.warn('[voice]', e.error, e.message)
        }
        setIsListening(false)
        setPartial(null)
        transcriptRef.current = ''
        if (e.error === 'not-allowed') {
          onPermissionDeniedRef.current?.()
          onErrorRef.current?.('需要麦克风和语音识别权限，才能语音问路')
        } else if (e.error !== 'aborted' && e.error !== 'no-speech') {
          onErrorRef.current?.('没听清，请再试一次')
        }
      }),
    ]

    return () => subs.forEach((s) => s.remove())
  }, [submitIfReady])

  const abortListening = useCallback(() => {
    getSpeechRecognitionModule()?.abort()
    setIsListening(false)
    setPartial(null)
    transcriptRef.current = ''
  }, [])

  const startListening = useCallback(async () => {
    if (canListenRef.current && !canListenRef.current()) return false

    const mod = getSpeechRecognitionModule()
    if (!mod?.isRecognitionAvailable()) {
      onErrorRef.current?.('当前版本不支持语音输入，请重新安装最新版 App')
      return false
    }

    const perm = await mod.requestPermissionsAsync()
    if (!perm.granted) {
      onPermissionDeniedRef.current?.()
      onErrorRef.current?.('需要麦克风和语音识别权限，才能语音问路')
      return false
    }

    await stopVolcanoSpeech()
    transcriptRef.current = ''
    setPartial(null)
    submittedRef.current = false

    mod.start({
      lang: 'zh-CN',
      interimResults: true,
      continuous: false,
      addsPunctuation: true,
    })
    return true
  }, [])

  const stopListening = useCallback(() => {
    const mod = getSpeechRecognitionModule()
    if (mod) mod.stop()
    else abortListening()
  }, [abortListening])

  const toggleListening = useCallback(async () => {
    if (isListening) {
      stopListening()
      return
    }
    await startListening()
  }, [isListening, startListening, stopListening])

  useEffect(() => () => abortListening(), [abortListening])

  return {
    available,
    isListening,
    partial,
    startListening,
    stopListening,
    toggleListening,
    abortListening,
  }
}
