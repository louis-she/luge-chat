/** 与 supabase/functions/_shared/geoSearchRadius.ts 默认对齐（客户端高级设置） */

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

function clamp(n: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

export function normalizeGeoRadiusPrefs(
  raw: Partial<GeoRadiusPrefs> | null | undefined,
): GeoRadiusPrefs {
  const d = DEFAULT_GEO_RADIUS_PREFS
  if (!raw || typeof raw !== 'object') return { ...d }
  return {
    baseUrbanKm: clamp(Number(raw.baseUrbanKm), 1, 30, d.baseUrbanKm),
    baseTownKm: clamp(Number(raw.baseTownKm), 1, 40, d.baseTownKm),
    baseWildKm: clamp(Number(raw.baseWildKm), 2, 50, d.baseWildKm),
    multNearby: clamp(Number(raw.multNearby), 0.5, 5, d.multNearby),
    multWater: clamp(Number(raw.multWater), 0.5, 5, d.multWater),
    multMountain: clamp(Number(raw.multMountain), 0.5, 5, d.multMountain),
    multDistant: clamp(Number(raw.multDistant), 0.5, 5, d.multDistant),
    multLandmark: clamp(Number(raw.multLandmark), 0.5, 5, d.multLandmark),
  }
}
