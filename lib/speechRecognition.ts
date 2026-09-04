import { requireOptionalNativeModule } from 'expo-modules-core'

export type SpeechResultEvent = {
  isFinal: boolean
  results: { transcript: string }[]
}

export type SpeechErrorEvent = {
  error: string
  message: string
}

export type SpeechVolumeEvent = {
  value: number
}

export type SpeechRecognitionModule = {
  start: (options: {
    lang?: string
    interimResults?: boolean
    continuous?: boolean
    addsPunctuation?: boolean
    iosCategory?: {
      category: 'playAndRecord'
      categoryOptions: Array<'defaultToSpeaker' | 'allowBluetooth'>
      mode?: 'default' | 'measurement'
    }
    volumeChangeEventOptions?: {
      enabled?: boolean
      intervalMillis?: number
    }
  }) => void
  stop: () => void
  abort: () => void
  isRecognitionAvailable: () => boolean
  requestPermissionsAsync: () => Promise<{ granted: boolean }>
  addListener: (
    event: 'start' | 'end' | 'result' | 'error' | 'speechstart' | 'volumechange',
    listener: (
      event: SpeechResultEvent | SpeechErrorEvent | SpeechVolumeEvent | null,
    ) => void,
    ) => { remove: () => void }
  setCategoryIOS?: (options: {
    category: 'playback'
    categoryOptions: Array<'duckOthers'>
    mode?: 'voicePrompt' | 'default'
  }) => void
  getAudioSessionCategoryAndOptionsIOS?: () => {
    category: string
    categoryOptions: string[]
    mode: string
  }
}

let cached: SpeechRecognitionModule | null | undefined

/** 安全获取语音识别原生模块；旧版 Dev Build 未编入时返回 null，不抛错。 */
export function getSpeechRecognitionModule(): SpeechRecognitionModule | null {
  if (cached !== undefined) return cached
  cached =
    requireOptionalNativeModule<SpeechRecognitionModule>('ExpoSpeechRecognition')
  return cached
}

/** 恢复 TTS 专用音频会话，避免 ASR 的 measurement 模式压低扬声器输出。 */
export function restorePlaybackAudioSession() {
  const mod = getSpeechRecognitionModule()
  try {
    mod?.setCategoryIOS?.({
      category: 'playback',
      categoryOptions: ['duckOthers'],
      mode: 'voicePrompt',
    })
    if (__DEV__) {
      console.log(
        '[luge audio] 恢复播放会话',
        mod?.getAudioSessionCategoryAndOptionsIOS?.() ?? 'native audio session unavailable',
      )
    }
  } catch (e) {
    if (__DEV__) console.warn('[luge audio] 恢复播放会话失败', e)
  }
}

/** TTS 播放前释放麦克风，避免 iOS 音频会话卡在录音模式 */
export async function releaseMicForPlayback() {
  try {
    getSpeechRecognitionModule()?.abort()
  } catch {
    /* ignore */
  }
  restorePlaybackAudioSession()
  await new Promise((r) => setTimeout(r, 220))
}
