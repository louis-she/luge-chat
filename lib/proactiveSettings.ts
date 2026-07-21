import * as SecureStore from 'expo-secure-store'

export type ProactiveGuideSettings = {
  enabled: boolean
}

export const DEFAULT_PROACTIVE_SETTINGS: ProactiveGuideSettings = {
  enabled: true,
}

const STORAGE_KEY = 'luge_proactive_guide_v1'

let cached = { ...DEFAULT_PROACTIVE_SETTINGS }

function normalize(raw: Partial<ProactiveGuideSettings> & { minRating?: unknown }): ProactiveGuideSettings {
  return {
    enabled: raw.enabled !== false,
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
