import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import { HeadingFusion } from './heading'
import type { UserCoords } from './location'

const STORAGE_KEY = 'lugechat.dev_location'

export type DevLocationOverride = {
  enabled: boolean
  latitude: number
  longitude: number
  heading: number
  label?: string
}

export const DEV_LOCATION_PRESETS: Array<{
  id: string
  label: string
  latitude: number
  longitude: number
  heading: number
}> = [
  { id: 'chengdu', label: '成都·锦江', latitude: 30.6568, longitude: 104.0652, heading: 70 },
  { id: 'dujiangyan', label: '都江堰', latitude: 31.0034, longitude: 103.6108, heading: 0 },
  { id: 'yaan', label: '雅安·青衣江', latitude: 29.98, longitude: 103.0, heading: 90 },
  { id: 'kangding', label: '康定·折多山', latitude: 30.05, longitude: 101.96, heading: 180 },
  { id: 'lhasa', label: '拉萨·布达拉', latitude: 29.6544, longitude: 91.1172, heading: 0 },
]

let cache: DevLocationOverride | null | undefined

function parseOverride(raw: string | null): DevLocationOverride | null {
  if (!raw) return null
  try {
    const data = JSON.parse(raw) as DevLocationOverride
    if (
      typeof data.enabled !== 'boolean' ||
      typeof data.latitude !== 'number' ||
      typeof data.longitude !== 'number' ||
      typeof data.heading !== 'number'
    ) {
      return null
    }
    return data
  } catch {
    return null
  }
}

async function readRaw(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null
  }
  return SecureStore.getItemAsync(STORAGE_KEY)
}

async function writeRaw(value: string | null) {
  if (Platform.OS === 'web') {
    if (value) globalThis.localStorage?.setItem(STORAGE_KEY, value)
    else globalThis.localStorage?.removeItem(STORAGE_KEY)
    return
  }
  if (value) await SecureStore.setItemAsync(STORAGE_KEY, value)
  else await SecureStore.deleteItemAsync(STORAGE_KEY)
}

export function overrideToCoords(override: DevLocationOverride): UserCoords {
  const snap = HeadingFusion.manual(override.heading)
  return {
    latitude: override.latitude,
    longitude: override.longitude,
    heading: snap.heading,
    headingConfidence: snap.confidence,
    headingSource: snap.source,
    showArrow: snap.showArrow,
    speed: null,
    accuracy: 10,
    source: 'dev_mock',
  }
}

export async function loadDevLocationOverride(): Promise<DevLocationOverride | null> {
  if (cache !== undefined) return cache
  const parsed = parseOverride(await readRaw())
  cache = parsed?.enabled ? parsed : null
  return cache
}

export function peekDevLocationOverride(): DevLocationOverride | null {
  if (cache === undefined) return null
  return cache
}

export async function saveDevLocationOverride(
  input: Omit<DevLocationOverride, 'enabled'> & { enabled?: boolean; label?: string },
): Promise<DevLocationOverride> {
  const next: DevLocationOverride = {
    enabled: input.enabled ?? true,
    latitude: input.latitude,
    longitude: input.longitude,
    heading: input.heading,
    label: input.label,
  }
  cache = next
  await writeRaw(JSON.stringify(next))
  return next
}

export async function clearDevLocationOverride() {
  cache = null
  await writeRaw(null)
}
