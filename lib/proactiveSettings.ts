import * as SecureStore from 'expo-secure-store'

/** 0 = 不按评分过滤；仅对高德返回了评分的景点类 POI 生效 */
export type ProactiveMinRating = 0 | 3.5 | 4 | 4.5

export type ProactiveGuideSettings = {
  enabled: boolean
  minRating: ProactiveMinRating
}

export const PROACTIVE_RATING_OPTIONS: {
  value: ProactiveMinRating
  label: string
  desc: string
}[] = [
  { value: 0, label: '不限评分', desc: '河流、山川等无评分地标也可讲' },
  { value: 3.5, label: '3.5 分以上', desc: '略过滤一般景点' },
  { value: 4, label: '4.0 分以上', desc: '推荐景点才讲' },
  { value: 4.5, label: '4.5 分以上', desc: '只讲口碑较好的景点' },
]

export const DEFAULT_PROACTIVE_SETTINGS: ProactiveGuideSettings = {
  enabled: true,
  minRating: 0,
}

const STORAGE_KEY = 'luge_proactive_guide_v1'

let cached = { ...DEFAULT_PROACTIVE_SETTINGS }

function isMinRating(v: number): v is ProactiveMinRating {
  return v === 0 || v === 3.5 || v === 4 || v === 4.5
}

function normalize(raw: Partial<ProactiveGuideSettings>): ProactiveGuideSettings {
  const minRating = Number(raw.minRating)
  return {
    enabled: raw.enabled !== false,
    minRating: isMinRating(minRating) ? minRating : DEFAULT_PROACTIVE_SETTINGS.minRating,
  }
}

export function getCachedProactiveSettings(): ProactiveGuideSettings {
  return cached
}

export async function loadProactiveSettings(): Promise<ProactiveGuideSettings> {
  try {
    const stored = await SecureStore.getItemAsync(STORAGE_KEY)
    if (stored) {
      cached = normalize(JSON.parse(stored) as Partial<ProactiveGuideSettings>)
      return cached
    }
  } catch {
    /* use default */
  }
  cached = { ...DEFAULT_PROACTIVE_SETTINGS }
  return cached
}

export async function saveProactiveSettings(
  patch: Partial<ProactiveGuideSettings>,
): Promise<ProactiveGuideSettings> {
  cached = normalize({ ...cached, ...patch })
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(cached))
  return cached
}
