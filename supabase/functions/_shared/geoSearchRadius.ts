/**
 * 问路 FC 搜索半径：场景底径 × 语意倍率，再 clamp。
 *
 * 最终半径(m) = clamp( round( baseKm[scene] × mult[intent] × 1000 ) , 1000 , 100000 )
 *
 * 上限原本是 50km（高德 API 的限制）。改查本地 PostGIS 后没有这个约束，
 * 放宽到 100km，「前面那座雪山是什么」这类远距离提问才答得上。
 *
 * 高级设置可覆盖 base / mult；未上报时用下方默认。
 */

export type GeoSceneClass = 'urban' | 'town' | 'wild'
export type GeoIntentClass =
  | 'nearby'
  | 'water'
  | 'mountain'
  | 'distant'
  | 'landmark'

export type GeoRadiusPrefs = {
  baseUrbanKm: number
  baseTownKm: number
  baseWildKm: number
  multNearby: number
  multWater: number
  multMountain: number
  multDistant: number
  multLandmark: number
}

/** 正式默认（与高级设置、文档对齐） */
export const DEFAULT_GEO_RADIUS_PREFS: GeoRadiusPrefs = {
  baseUrbanKm: 4,
  baseTownKm: 6,
  baseWildKm: 10,
  multNearby: 1,
  multWater: 1.5,
  multMountain: 2.5,
  multDistant: 3,
  multLandmark: 1.2,
}

export const MAX_RADIUS_M = 100_000
const MIN_RADIUS_M = 1_000

function clampNum(n: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

export function normalizeGeoRadiusPrefs(
  raw: Partial<GeoRadiusPrefs> | null | undefined,
): GeoRadiusPrefs {
  const d = DEFAULT_GEO_RADIUS_PREFS
  if (!raw || typeof raw !== 'object') return { ...d }
  return {
    baseUrbanKm: clampNum(Number(raw.baseUrbanKm), 1, 30, d.baseUrbanKm),
    baseTownKm: clampNum(Number(raw.baseTownKm), 1, 40, d.baseTownKm),
    baseWildKm: clampNum(Number(raw.baseWildKm), 2, 50, d.baseWildKm),
    multNearby: clampNum(Number(raw.multNearby), 0.5, 5, d.multNearby),
    multWater: clampNum(Number(raw.multWater), 0.5, 5, d.multWater),
    multMountain: clampNum(Number(raw.multMountain), 0.5, 5, d.multMountain),
    multDistant: clampNum(Number(raw.multDistant), 0.5, 5, d.multDistant),
    multLandmark: clampNum(Number(raw.multLandmark), 0.5, 5, d.multLandmark),
  }
}

/** 从工具 focus / 用户问法关键词推断语意档 */
export function classifyGeoIntent(text: string | null | undefined): GeoIntentClass {
  const t = String(text ?? '').trim()
  if (!t) return 'nearby'
  if (/远处|远方|很远|天边|地平线/.test(t)) return 'distant'
  if (/雪山|山峰|山脉|那座山|前面.*山|峰|岭/.test(t) || /^(山|峰|岭)$/.test(t)) {
    return 'mountain'
  }
  if (/水库|湖泊|那片水|水面|江|河|湖|溪|堰|坝|有水/.test(t) || /^(水|湖|河|江|溪|库)$/.test(t)) {
    return 'water'
  }
  if (/桥|隧道|寺|庙|风景|景点|镇|村|坝/.test(t)) return 'landmark'
  return 'nearby'
}

function baseKmForScene(scene: GeoSceneClass, prefs: GeoRadiusPrefs): number {
  if (scene === 'urban') return prefs.baseUrbanKm
  if (scene === 'town') return prefs.baseTownKm
  return prefs.baseWildKm
}

function multForIntent(intent: GeoIntentClass, prefs: GeoRadiusPrefs): number {
  switch (intent) {
    case 'water':
      return prefs.multWater
    case 'mountain':
      return prefs.multMountain
    case 'distant':
      return prefs.multDistant
    case 'landmark':
      return prefs.multLandmark
    default:
      return prefs.multNearby
  }
}

export type GeoRadiusDecision = {
  radiusM: number
  scene: GeoSceneClass
  intent: GeoIntentClass
  baseKm: number
  mult: number
  prefs: GeoRadiusPrefs
  formula: string
}

export function resolveGeoSearchRadius(opts: {
  scene: GeoSceneClass
  intent: GeoIntentClass
  prefs?: Partial<GeoRadiusPrefs> | null
}): GeoRadiusDecision {
  const prefs = normalizeGeoRadiusPrefs(opts.prefs)
  const baseKm = baseKmForScene(opts.scene, prefs)
  const mult = multForIntent(opts.intent, prefs)
  const rawM = Math.round(baseKm * mult * 1000)
  const radiusM = Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, rawM))
  return {
    radiusM,
    scene: opts.scene,
    intent: opts.intent,
    baseKm,
    mult,
    prefs,
    formula: `clamp(${baseKm}km×${mult}, 1～100km) → ${radiusM}m [${opts.scene}/${opts.intent}]`,
  }
}

/**
 * 主动讲解：只有场景、没有用户问话语意。
 * 半径 = 场景底径（不再乘 water/mountain 等倍率）。
 */
export function resolveProactiveScenicRadius(opts: {
  scene: GeoSceneClass
  prefs?: Partial<GeoRadiusPrefs> | null
}): {
  radiusKm: number
  radiusM: number
  scene: GeoSceneClass
  baseKm: number
  prefs: GeoRadiusPrefs
  formula: string
} {
  const prefs = normalizeGeoRadiusPrefs(opts.prefs)
  const baseKm = baseKmForScene(opts.scene, prefs)
  const radiusKm = Math.min(50, Math.max(1, baseKm))
  const radiusM = Math.round(radiusKm * 1000)
  return {
    radiusKm,
    radiusM,
    scene: opts.scene,
    baseKm,
    prefs,
    formula: `主动讲解场景底径 ${baseKm}km → ${radiusM}m [${opts.scene}]`,
  }
}

/** 泛化词不能当专名去精确匹配，否则 3km 内「湖」「水库」会直接搜空 */
export function isGenericGeoFocus(focus: string | null | undefined): boolean {
  const t = String(focus ?? '').trim()
  if (!t) return true
  return /^(水|湖|河|江|溪|库|山|峰|岭|水库|雪山|桥|风景|景点|旁边|附近|前面)$/.test(t)
}
