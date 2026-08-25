import * as SecureStore from 'expo-secure-store'
import type { ProactiveSpanConfig } from './proactiveSpan'
import {
  DEFAULT_GEO_RADIUS_PREFS,
  normalizeGeoRadiusPrefs,
  type GeoRadiusPrefs,
} from './geoRadiusPrefs'

export type { GeoRadiusPrefs }

export type ProactiveSpeakLength = 'short' | 'medium' | 'long'

export type ProactiveGuideSettings = {
  enabled: boolean
  /** 距上次查询锚点最少公里数 */
  minDistanceKm: number
  /** 两次查询最少间隔（分钟） */
  minCheckIntervalMin: number
  /** 两次开口最少间隔（分钟） */
  minSpeakIntervalMin: number
  /** 主动讲解口播篇幅 */
  speakLength: ProactiveSpeakLength
  /** 风景名胜周边搜索半径（公里）— 主动讲解候选 */
  scenicRadiusKm: number
  /** 问路 FC：场景底径 + 语意倍率（随 GPS 同步到会话） */
  geoRadius: GeoRadiusPrefs
  /** 递增后重置客户端查询锚点（路测用） */
  anchorNonce: number
}

export const SPEAK_LENGTH_OPTIONS: {
  value: ProactiveSpeakLength
  label: string
  desc: string
  minChars: number
  maxChars: number
}[] = [
  { value: 'short', label: '短', desc: '80～160 字，车载一瞥', minChars: 80, maxChars: 160 },
  { value: 'medium', label: '中', desc: '150～280 字，多一点典故', minChars: 150, maxChars: 280 },
  { value: 'long', label: '长', desc: '280～450 字，适合停车听', minChars: 280, maxChars: 450 },
]

export const SPAN_PRESETS: {
  id: string
  label: string
  desc: string
  minDistanceKm: number
  minCheckIntervalMin: number
  minSpeakIntervalMin: number
}[] = [
  {
    id: 'release',
    label: '正式默认',
    desc: '20km · 查 10 分 · 讲 15 分',
    minDistanceKm: 20,
    minCheckIntervalMin: 10,
    minSpeakIntervalMin: 15,
  },
  {
    id: 'roadtest',
    label: '路测宽松',
    desc: '2km · 查 1 分 · 讲 2 分',
    minDistanceKm: 2,
    minCheckIntervalMin: 1,
    minSpeakIntervalMin: 2,
  },
  {
    id: 'debug',
    label: '极松调试',
    desc: '0.3km · 查 0.5 分 · 讲 1 分',
    minDistanceKm: 0.3,
    minCheckIntervalMin: 0.5,
    minSpeakIntervalMin: 1,
  },
]

export const DEFAULT_PROACTIVE_SETTINGS: ProactiveGuideSettings = {
  enabled: true,
  minDistanceKm: 20,
  minCheckIntervalMin: 10,
  minSpeakIntervalMin: 15,
  speakLength: 'short',
  scenicRadiusKm: 8,
  geoRadius: { ...DEFAULT_GEO_RADIUS_PREFS },
  anchorNonce: 0,
}

const STORAGE_KEY = 'luge_proactive_guide_v2'

let cached = { ...DEFAULT_PROACTIVE_SETTINGS }

function clamp(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

function isSpeakLength(v: unknown): v is ProactiveSpeakLength {
  return v === 'short' || v === 'medium' || v === 'long'
}

export function speakLengthSpec(length: ProactiveSpeakLength) {
  return SPEAK_LENGTH_OPTIONS.find((o) => o.value === length) ?? SPEAK_LENGTH_OPTIONS[0]
}

export function settingsToSpanConfig(s: ProactiveGuideSettings): ProactiveSpanConfig {
  return {
    minDistanceKm: s.minDistanceKm,
    minCheckIntervalMs: s.minCheckIntervalMin * 60_000,
    minSpeakIntervalMs: s.minSpeakIntervalMin * 60_000,
  }
}

/**
 * 黄点预览 / 风景库预热半径：取「周边半径」与三档场景底径的最大值，
 * 与正式主动讲解 ensureScenicAroundLibrary 一致（避免黄点 8km、讲解 10km 两套圈）。
 */
export function scenicLibraryRadiusKm(s: ProactiveGuideSettings): number {
  return Math.min(
    50,
    Math.max(
      1,
      s.scenicRadiusKm,
      s.geoRadius.baseUrbanKm,
      s.geoRadius.baseTownKm,
      s.geoRadius.baseWildKm,
    ),
  )
}

function normalize(raw: Partial<ProactiveGuideSettings> & { minRating?: unknown }): ProactiveGuideSettings {
  const speakLength = isSpeakLength(raw.speakLength)
    ? raw.speakLength
    : DEFAULT_PROACTIVE_SETTINGS.speakLength
  return {
    enabled: raw.enabled !== false,
    minDistanceKm: clamp(Number(raw.minDistanceKm), 0.1, 200),
    minCheckIntervalMin: clamp(Number(raw.minCheckIntervalMin), 0.1, 180),
    minSpeakIntervalMin: clamp(Number(raw.minSpeakIntervalMin), 0.1, 180),
    speakLength,
    scenicRadiusKm: clamp(Number(raw.scenicRadiusKm), 1, 50),
    geoRadius: normalizeGeoRadiusPrefs(raw.geoRadius),
    anchorNonce: Math.max(0, Math.floor(Number(raw.anchorNonce) || 0)),
  }
}

export function getCachedProactiveSettings(): ProactiveGuideSettings {
  return cached
}

export async function loadProactiveSettings(): Promise<ProactiveGuideSettings> {
  try {
    const stored =
      (await SecureStore.getItemAsync(STORAGE_KEY)) ??
      (await SecureStore.getItemAsync('luge_proactive_guide_v1'))
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
