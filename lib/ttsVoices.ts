import * as SecureStore from 'expo-secure-store'

export type TtsVoice = {
  id: string
  label: string
  desc: string
}

/** 豆包语音合成 2.0（seed-tts-2.0）精选音色 */
export const TTS_VOICES: TtsVoice[] = [
  {
    id: 'zh_female_peiqi_uranus_bigtts',
    label: '佩奇猪',
    desc: '角色音 · 卡通活泼，当前默认',
  },
  {
    id: 'zh_female_vv_uranus_bigtts',
    label: 'Vivi',
    desc: '女声 · 自然对话',
  },
  {
    id: 'zh_female_xiaohe_uranus_bigtts',
    label: '小何',
    desc: '女声 · 温柔亲切',
  },
  {
    id: 'zh_male_liufei_uranus_bigtts',
    label: '刘飞',
    desc: '男声 · 沉稳讲解',
  },
  {
    id: 'zh_male_m191_uranus_bigtts',
    label: '云舟',
    desc: '男声 · 清爽活力',
  },
]

export const DEFAULT_TTS_SPEAKER = TTS_VOICES[0]!.id

export const TTS_SPEAKER_IDS = new Set(TTS_VOICES.map((v) => v.id))

/** v2：默认改为佩奇猪，旧缓存需失效 */
const STORAGE_KEY = 'luge_tts_speaker_v2'

let cachedSpeaker = DEFAULT_TTS_SPEAKER

export function getSelectedTtsSpeaker(): string {
  return cachedSpeaker
}

export async function loadTtsSpeaker(): Promise<string> {
  try {
    const stored = await SecureStore.getItemAsync(STORAGE_KEY)
    if (stored && TTS_SPEAKER_IDS.has(stored)) {
      cachedSpeaker = stored
      return cachedSpeaker
    }
    if (stored && stored !== cachedSpeaker) {
      await SecureStore.setItemAsync(STORAGE_KEY, DEFAULT_TTS_SPEAKER)
    }
  } catch {
    /* use default */
  }
  cachedSpeaker = DEFAULT_TTS_SPEAKER
  return cachedSpeaker
}

export async function saveTtsSpeaker(speakerId: string): Promise<string> {
  const id = TTS_SPEAKER_IDS.has(speakerId) ? speakerId : DEFAULT_TTS_SPEAKER
  cachedSpeaker = id
  await SecureStore.setItemAsync(STORAGE_KEY, id)
  return id
}

export function findTtsVoice(speakerId: string): TtsVoice | undefined {
  return TTS_VOICES.find((v) => v.id === speakerId)
}
