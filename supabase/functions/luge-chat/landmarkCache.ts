import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

export type LandmarkType =
  | 'town'
  | 'river'
  | 'scenery'
  | 'bridge'
  | 'mountain'
  | 'other'

export type GeoLandmarkRow = {
  id: string
  landmark_name: string
  landmark_type: LandmarkType
  ai_formatted_story: string
  distance_m: number
  lat: number
  lng: number
  source: string
  amap_poi_id: string | null
  valid_until: string
  hit_count: number
  metadata: Record<string, unknown>
}

export type LandmarkMapHit = {
  name: string
  category?: string
  distance_m: number
  direction: string
  lat: number
  lng: number
  tags: Record<string, string>
  source: 'cache' | 'amap' | 'osm' | 'tianditu'
  amap_poi_id?: string | null
  cache_id?: string | null
  cached_story?: string
}

type GeoBearingHelpers = {
  haversineM: (lat1: number, lng1: number, lat2: number, lng2: number) => number
  bearingTo: (lat1: number, lng1: number, lat2: number, lng2: number) => number
  bearingLabel: (bearing: number, heading: number | null) => string
}

const LANDMARK_TYPE_LABELS: Record<LandmarkType, string> = {
  town: '城镇',
  river: '河流',
  scenery: '风景名胜',
  bridge: '桥梁',
  mountain: '山脉',
  other: '地标',
}

const LANDMARK_TYPES: LandmarkType[] = [
  'town',
  'river',
  'scenery',
  'bridge',
  'mountain',
  'other',
]

export function inferLandmarkType(
  category?: string,
  tags?: Record<string, string>,
): LandmarkType {
  const text = `${category ?? ''}${tags?.type ?? ''}${tags?.name ?? ''}`
  if (/桥/.test(text)) return 'bridge'
  if (/山|峰|岭|垭口/.test(text)) return 'mountain'
  if (/河|江|溪|湖|渠|湾|水库|湿地|水系/.test(text)) return 'river'
  if (/风景名胜|景点|景区|公园|古迹|遗址|博物馆|寺庙|塔/.test(text)) return 'scenery'
  if (/镇|乡|街道|村|社区|地名/.test(text)) return 'town'
  return 'other'
}

export async function fetchNearbyGeoLandmarks(
  supabase: SupabaseClient,
  lat: number,
  lng: number,
  radiusM = 3000,
): Promise<GeoLandmarkRow[]> {
  const { data, error } = await supabase.rpc('nearby_geo_landmarks', {
    p_lat: lat,
    p_lng: lng,
    p_radius_m: radiusM,
  })
  if (error) {
    console.warn('nearby_geo_landmarks failed:', error.message)
    return []
  }
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    landmark_name: String(row.landmark_name ?? ''),
    landmark_type: normalizeLandmarkType(row.landmark_type),
    ai_formatted_story: String(row.ai_formatted_story ?? ''),
    distance_m: Number(row.distance_m) || 0,
    lat: Number(row.lat),
    lng: Number(row.lng),
    source: String(row.source ?? 'amap'),
    amap_poi_id: row.amap_poi_id != null ? String(row.amap_poi_id) : null,
    valid_until: String(row.valid_until ?? ''),
    hit_count: Number(row.hit_count) || 0,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  }))
}

function normalizeLandmarkType(value: unknown): LandmarkType {
  const s = String(value ?? 'other') as LandmarkType
  return LANDMARK_TYPES.includes(s) ? s : 'other'
}

export function pickBestGeoLandmark(
  rows: GeoLandmarkRow[],
  userLat: number,
  userLng: number,
  heading: number | null,
  helpers: GeoBearingHelpers,
): GeoLandmarkRow | null {
  if (!rows.length) return null
  const hasHeading = heading != null && Number.isFinite(heading)
  const scored = [...rows].sort((a, b) => {
    if (!hasHeading) return a.distance_m - b.distance_m
    const aBearing = helpers.bearingTo(userLat, userLng, a.lat, a.lng)
    const bBearing = helpers.bearingTo(userLat, userLng, b.lat, b.lng)
    const aForward = helpers.bearingLabel(aBearing, heading).includes('前') ? 0 : 1
    const bForward = helpers.bearingLabel(bBearing, heading).includes('前') ? 0 : 1
    if (aForward !== bForward) return aForward - bForward
    return a.distance_m - b.distance_m
  })
  return scored[0] ?? null
}

export function geoLandmarkToMapHit(
  row: GeoLandmarkRow,
  userLat: number,
  userLng: number,
  heading: number | null,
  helpers: GeoBearingHelpers,
): LandmarkMapHit {
  const distance_m = Math.round(
    row.distance_m > 0
      ? row.distance_m
      : helpers.haversineM(userLat, userLng, row.lat, row.lng),
  )
  const bearing = helpers.bearingTo(userLat, userLng, row.lat, row.lng)
  return {
    name: row.landmark_name,
    category: LANDMARK_TYPE_LABELS[row.landmark_type],
    distance_m,
    direction: helpers.bearingLabel(bearing, heading),
    lat: row.lat,
    lng: row.lng,
    source: 'cache',
    amap_poi_id: row.amap_poi_id,
    cache_id: row.id,
    cached_story: row.ai_formatted_story || undefined,
    tags: {
      landmark_type: row.landmark_type,
      cache_hits: String(row.hit_count),
      ...(row.metadata as Record<string, string>),
    },
  }
}

export type LandmarkSignalResult = {
  candidate_id: string
  cache_id: string | null
  promoted: boolean
  ask_users: number
  favorite_users: number
  promotion_score: number
  promotion_pending: boolean
}

export async function recordGeoLandmarkSignal(
  supabase: SupabaseClient,
  params: {
    user_id: string | null
    signal_type: 'ask' | 'favorite'
    landmark_name: string
    landmark_type: LandmarkType
    lat: number
    lng: number
    ai_story?: string
    amap_poi_id?: string | null
    metadata?: Record<string, unknown>
  },
): Promise<LandmarkSignalResult | null> {
  if (!params.user_id) return null

  const { data, error } = await supabase.rpc('record_geo_landmark_signal', {
    p_user_id: params.user_id,
    p_signal_type: params.signal_type,
    p_landmark_name: params.landmark_name,
    p_landmark_type: params.landmark_type,
    p_lat: params.lat,
    p_lng: params.lng,
    p_ai_story: params.ai_story ?? '',
    p_amap_poi_id: params.amap_poi_id ?? null,
    p_metadata: params.metadata ?? {},
  })
  if (error) {
    console.warn('record_geo_landmark_signal failed:', error.message)
    return null
  }
  if (!data || typeof data !== 'object') return null
  const row = data as Record<string, unknown>
  return {
    candidate_id: String(row.candidate_id ?? ''),
    cache_id: row.cache_id != null ? String(row.cache_id) : null,
    promoted: Boolean(row.promoted),
    ask_users: Number(row.ask_users) || 0,
    favorite_users: Number(row.favorite_users) || 0,
    promotion_score: Number(row.promotion_score) || 0,
    promotion_pending: Boolean(row.promotion_pending),
  }
}

/** @deprecated internal promotion only — use recordGeoLandmarkSignal from edge */
export async function upsertGeoLandmarkFromAmap(
  supabase: SupabaseClient,
  params: {
    amap_poi_id: string
    landmark_name: string
    landmark_type: LandmarkType
    lat: number
    lng: number
    ai_story: string
    metadata?: Record<string, unknown>
  },
): Promise<string | null> {
  const { data, error } = await supabase.rpc('upsert_geo_landmark_amap', {
    p_amap_poi_id: params.amap_poi_id,
    p_landmark_name: params.landmark_name,
    p_landmark_type: params.landmark_type,
    p_lat: params.lat,
    p_lng: params.lng,
    p_ai_story: params.ai_story,
    p_metadata: params.metadata ?? {},
  })
  if (error) {
    console.warn('upsert_geo_landmark_amap failed:', error.message)
    return null
  }
  return typeof data === 'string' ? data : null
}
