import * as Speech from 'expo-speech'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config'
import { releaseMicForPlayback } from './speechRecognition'
import { getSelectedTtsSpeaker } from './ttsVoices'

type ExpoAudio = typeof import('expo-audio')
type ExpoFs = typeof import('expo-file-system/legacy')
type AudioPlayer = import('expo-audio').AudioPlayer

let audioModule: ExpoAudio | null | undefined
let fsModule: ExpoFs | null | undefined
let currentPlayer: AudioPlayer | null = null
let warnedNoAudio = false
let speakGeneration = 0
let currentFetchController: AbortController | null = null

export type TtsPhase = 'preparing' | 'playing'

class TtsCancelledError extends Error {
  constructor() {
    super('tts cancelled')
  }
}

function loadAudio(): ExpoAudio | null {
  if (audioModule !== undefined) return audioModule
  try {
    audioModule = require('expo-audio') as ExpoAudio
  } catch {
    audioModule = null
    if (__DEV__ && !warnedNoAudio) {
      warnedNoAudio = true
      console.warn(
        '[luge tts] expo-audio 未编入当前安装包，暂用系统朗读。请执行 npm run build:ios:device 重新装包。',
      )
    }
  }
  return audioModule
}

function loadFs(): ExpoFs | null {
  if (fsModule !== undefined) return fsModule
  try {
    fsModule = require('expo-file-system/legacy') as ExpoFs
  } catch {
    fsModule = null
  }
  return fsModule
}

/** 语音识别结束后切回播放模式 */
async function ensurePlaybackAudioMode() {
  const audio = loadAudio()
  if (!audio) return
  await audio.setAudioModeAsync({
    playsInSilentMode: true,
    allowsRecording: false,
    interruptionMode: 'duckOthers',
  })
}

export async function stopVolcanoSpeech() {
  speakGeneration += 1
  currentFetchController?.abort()
  currentFetchController = null
  Speech.stop()
  if (!currentPlayer) return
  try {
    currentPlayer.pause()
    currentPlayer.release()
  } catch {
    /* ignore */
  }
  currentPlayer = null
}

/** 按句切分，首段尽快出声 */
export function splitTtsChunks(text: string, maxLen = 90): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  if (trimmed.length <= maxLen) return [trimmed]

  const parts: string[] = []
  let buf = ''
  const sentences = trimmed.split(/(?<=[。！？；\n])/g)

  for (const sentence of sentences) {
    if (!sentence) continue
    const next = buf + sentence
    if (next.length <= maxLen) {
      buf = next
      continue
    }
    if (buf.trim()) parts.push(buf.trim())
    if (sentence.length <= maxLen) {
      buf = sentence
    } else {
      for (let i = 0; i < sentence.length; i += maxLen) {
        parts.push(sentence.slice(i, i + maxLen).trim())
      }
      buf = ''
    }
  }
  if (buf.trim()) parts.push(buf.trim())
  return parts.filter(Boolean)
}

async function fetchVolcanoMp3(
  text: string,
  accessToken?: string | null,
  generation?: number,
): Promise<string> {
  const token = accessToken?.trim() || SUPABASE_ANON_KEY
  const t0 = Date.now()
  const controller = new AbortController()
  currentFetchController = controller
  const timeout = setTimeout(() => controller.abort(), 20_000)
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/tts`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        speaker: getSelectedTtsSpeaker(),
      }),
      signal: controller.signal,
    })

    const data = await res.json().catch(() => ({}))
    if (generation != null && generation !== speakGeneration) {
      throw new TtsCancelledError()
    }
    if (!res.ok) {
      const msg =
        (typeof data.error === 'string' && data.error) || `TTS 失败 (${res.status})`
      throw new Error(msg)
    }

    const b64 = data.audio_base64 as string | undefined
    if (!b64) throw new Error('TTS 未返回音频')
    if (__DEV__) {
      console.log(
        `[luge tts] ${text.length}字 → ${Math.round(b64.length / 1024)}KB 音频，耗时 ${Date.now() - t0}ms`,
      )
    }
    return b64
  } catch (e) {
    if (generation != null && generation !== speakGeneration) {
      throw new TtsCancelledError()
    }
    throw e
  } finally {
    clearTimeout(timeout)
    if (currentFetchController === controller) currentFetchController = null
  }
}

async function speakWithSystemVoice(text: string) {
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      resolve()
    }
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      reject(error instanceof Error ? error : new Error('系统语音播放失败'))
    }
    Speech.speak(text, {
      language: 'zh-CN',
      rate: 0.95,
      onDone: finish,
      onStopped: finish,
      onError: fail,
    })
  })
}

async function playMp3Base64(
  b64: string,
  generation: number,
  onPhase?: (phase: TtsPhase) => void,
): Promise<void> {
  const audio = loadAudio()
  const fs = loadFs()
  if (!audio || !fs) {
    throw new Error('expo-audio unavailable')
  }

  const uri = `${fs.cacheDirectory}luge-tts-${Date.now()}.mp3`
  await fs.writeAsStringAsync(uri, b64, { encoding: fs.EncodingType.Base64 })
  if (generation !== speakGeneration) return

  await ensurePlaybackAudioMode()
  const player = audio.createAudioPlayer(uri, {
    updateInterval: 100,
    keepAudioSessionActive: true,
  })
  currentPlayer = player

  await new Promise<void>((resolve, reject) => {
    let settled = false
    let sawPlaying = false
    let sawProgress = false
    let lastStatusKey = ''
    let startupTimer: ReturnType<typeof setTimeout> | null = null

    const logStatus = (status: typeof player.currentStatus, event: string) => {
      if (!__DEV__) return
      const key = [
        event,
        status.playing,
        status.isLoaded,
        status.isBuffering,
        status.didJustFinish,
        status.error ?? '',
      ].join('|')
      if (key === lastStatusKey) return
      lastStatusKey = key
      console.log('[luge tts] 播放器状态', {
        event,
        playing: status.playing,
        isLoaded: status.isLoaded,
        isBuffering: status.isBuffering,
        currentTime: Number(status.currentTime.toFixed(2)),
        duration: Number(status.duration.toFixed(2)),
        volume: player.volume,
        muted: player.muted,
        playbackState: status.playbackState,
        timeControlStatus: status.timeControlStatus,
        reasonForWaitingToPlay: status.reasonForWaitingToPlay,
        error: status.error,
      })
    }

    const cleanup = () => {
      clearTimeout(timer)
      if (startupTimer) clearTimeout(startupTimer)
      listener.remove()
      if (currentPlayer === player) currentPlayer = null
      try {
        player.release()
      } catch {
        /* ignore */
      }
    }

    const finish = (reason: string) => {
      if (settled) return
      settled = true
      cleanup()
      if (__DEV__) console.log(`[luge tts] 播放完成 (${reason})`)
      resolve()
    }

    const fail = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      if (__DEV__) console.warn('[luge tts] 播放失败', error.message)
      reject(error)
    }

    const listener = player.addListener('playbackStatusUpdate', (status) => {
      logStatus(status, 'update')
      if (generation !== speakGeneration) {
        finish('cancelled')
        return
      }
      if (status.error) {
        fail(new Error(`播放器错误：${status.error}`))
        return
      }
      const firstPlayingStatus = status.playing && !sawPlaying
      if (status.playing) sawPlaying = true
      if (status.currentTime > 0.05) sawProgress = true
      if (firstPlayingStatus) onPhase?.('playing')
      if (status.didJustFinish) {
        if (!sawPlaying || !sawProgress || status.duration <= 0) {
          fail(new Error('音频未进入有效播放状态'))
          return
        }
        finish('didJustFinish')
        return
      }
      if (
        sawPlaying &&
        status.playing === false &&
        status.isLoaded &&
        status.duration > 0 &&
        status.currentTime >= status.duration - 0.1
      ) {
        finish('end')
      }
    })

    const timer = setTimeout(() => {
      if (__DEV__) console.warn('[luge tts] 播放超时，跳过本段')
      fail(new Error('音频播放超时'))
    }, 90_000)

    try {
      const initialStatus = player.currentStatus
      logStatus(initialStatus, 'before-play')
      if (__DEV__) console.log('[luge tts] 开始播放')
      player.play()
      startupTimer = setTimeout(() => {
        if (!sawPlaying && !settled) {
          fail(new Error('音频未开始播放'))
        }
      }, 8_000)
    } catch (e) {
      fail(e instanceof Error ? e : new Error(String(e)))
    }
  })
}

async function speakWithVolcanoAudio(
  text: string,
  accessToken?: string | null,
  onPhase?: (phase: TtsPhase) => void,
) {
  const audio = loadAudio()
  const fs = loadFs()
  if (!audio || !fs) {
    onPhase?.('playing')
    await speakWithSystemVoice(text)
    return
  }

  await releaseMicForPlayback()
  await stopVolcanoSpeech()
  const generation = speakGeneration
  await ensurePlaybackAudioMode()

  // 通常整段讲解不超过 450 字，一次合成可以避免分段播放之间出现长空档。
  // 超长文本仍然分段，但不再并行堆积多个 TTS 请求。
  const stableChunks = splitTtsChunks(text, 900)
  onPhase?.('preparing')
  for (const chunk of stableChunks) {
    if (generation !== speakGeneration) return
    const b64 = await fetchVolcanoMp3(chunk, accessToken, generation)
    if (generation !== speakGeneration) return
    await playMp3Base64(b64, generation, onPhase)
  }
}

export async function speakVolcano(
  text: string,
  accessToken?: string | null,
  options?: { onPhase?: (phase: TtsPhase) => void },
): Promise<void> {
  const trimmed = text.trim()
  if (!trimmed) return

  try {
    await speakWithVolcanoAudio(trimmed, accessToken, options?.onPhase)
  } catch (e) {
    if (e instanceof TtsCancelledError) return
    if (__DEV__) console.warn('[luge tts] 豆包播放失败，回退系统朗读', e)
    options?.onPhase?.('playing')
    await speakWithSystemVoice(trimmed)
  }
}
