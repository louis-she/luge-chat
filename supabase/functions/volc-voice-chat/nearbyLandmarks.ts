import {
  getMapPoiProvider,
  type MapPoi,
} from '../_shared/mapPoi/mod.ts'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { adminClient } from './sessionLoc.ts'

export type NearbyLandmark = {
  name: string
  type: string
  distance_m: number
  direction: string
  lat: number
  lng: number
  story?: string
  source: 'cache' | 'amap' | 'tianditu'
}

function toRad(d: number) {
  return (d * Math.PI) / 180
}

function toDeg(r: number) {
  return (r * 180) / Math.PI
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

function bearingTo(lat1: number, lng1: number, lat2: number, lng2: number) {
  const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2))
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1))
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

function bearingLabel(bearing: number, reference: number | null) {
  if (reference == null || !Number.isFinite(reference)) return '附近'
  let diff = bearing - reference
  while (diff > 180) diff -= 360
  while (diff < -180) diff += 360
  const abs = Math.abs(diff)
  if (abs <= 25) return '正前方'
  if (abs >= 155) return '后方'
  if (diff > 0) return '右前方'
  return '左前方'
}

const TYPE_LABEL: Record<string, string> = {
  town: '城镇',
  river: '河流',
  scenery: '风景名胜',
  bridge: '桥梁',
  mountain: '山脉',
  other: '地标',
}

async function fromCache(
  db: SupabaseClient,
  lat: number,
  lng: number,
  radiusM: number,
  heading: number | null,
  focus?: string,
): Promise<NearbyLandmark[]> {
  const { data, error } = await db.rpc('nearby_geo_landmarks', {
    p_lat: lat,
    p_lng: lng,
    p_radius_m: radiusM,
  })
  if (error) {
    console.warn('[nearby] cache rpc failed:', error.message)
    return []
  }
  const focusLc = focus?.trim().toLowerCase() ?? ''
  const rows = (data ?? []) as Array<Record<string, unknown>>
  return rows
    .map((row) => {
      const plat = Number(row.lat)
      const plng = Number(row.lng)
      const bearing = bearingTo(lat, lng, plat, plng)
      const type = String(row.landmark_type ?? 'other')
      return {
        name: String(row.landmark_name ?? ''),
        type: TYPE_LABEL[type] ?? type,
        distance_m: Math.round(Number(row.distance_m) || 0),
        direction: bearingLabel(bearing, heading),
        lat: plat,
        lng: plng,
        story: String(row.ai_formatted_story ?? '').slice(0, 400) || undefined,
        source: 'cache' as const,
      }
    })
    .filter((r) => r.name)
    .filter((r) => {
      if (!focusLc) return true
      return (
        r.name.toLowerCase().includes(focusLc) ||
        r.type.toLowerCase().includes(focusLc) ||
        (r.story ?? '').toLowerCase().includes(focusLc)
      )
    })
    .slice(0, 8)
}

function fromMapPoi(
  poi: MapPoi,
  lat: number,
  lng: number,
  heading: number | null,
  providerId: 'amap' | 'tianditu',
): NearbyLandmark {
  const dist =
    poi.distance_m != null
      ? poi.distance_m
      : Math.round(haversineM(lat, lng, poi.lat, poi.lng))
  return {
    name: poi.name,
    type: poi.type.split(';')[0] || '地标',
    distance_m: dist,
    direction: bearingLabel(bearingTo(lat, lng, poi.lat, poi.lng), heading),
    lat: poi.lat,
    lng: poi.lng,
    source: providerId,
  }
}

async function fromExternalMap(
  lat: number,
  lng: number,
  radiusM: number,
  heading: number | null,
  focus?: string,
): Promise<{ landmarks: NearbyLandmark[]; providerNote: string }> {
  const provider = getMapPoiProvider()
  if (!provider) {
    return { landmarks: [], providerNote: '未配置地图 POI Key' }
  }

  const pois = await provider.around({
    lat,
    lng,
    radiusM: Math.min(Math.max(radiusM, 500), 8000),
    category: 'ask_nearby',
    keyword: focus?.trim() || undefined,
    limit: 12,
  })

  const landmarks = pois
    .map((p) => fromMapPoi(p, lat, lng, heading, provider.id))
    .slice(0, 8)

  return {
    landmarks,
    providerNote: `${provider.id} 兜底 ${landmarks.length} 条`,
  }
}

/** 查周边：优先缓存，空则外部地图 POI（当前默认高德） */
export async function lookupNearbyLandmarks(opts: {
  lat: number
  lng: number
  heading?: number | null
  radiusM?: number
  focus?: string
}): Promise<{ landmarks: NearbyLandmark[]; note: string }> {
  if (
    !Number.isFinite(opts.lat) ||
    !Number.isFinite(opts.lng) ||
    (opts.lat === 0 && opts.lng === 0)
  ) {
    return {
      landmarks: [],
      note: '暂无有效 GPS，无法查周边。请客户端先上报位置。',
    }
  }

  const radiusM =
    typeof opts.radiusM === 'number' && opts.radiusM > 0
      ? Math.min(Math.round(opts.radiusM), 8000)
      : 3000
  const heading =
    opts.heading != null && Number.isFinite(opts.heading) ? opts.heading : null
  const db = adminClient()

  let landmarks = await fromCache(
    db,
    opts.lat,
    opts.lng,
    radiusM,
    heading,
    opts.focus,
  )
  let note = landmarks.length
    ? `缓存命中 ${landmarks.length} 条（半径 ${radiusM}m）`
    : ''

  if (landmarks.length === 0) {
    const ext = await fromExternalMap(
      opts.lat,
      opts.lng,
      radiusM,
      heading,
      opts.focus,
    )
    landmarks = ext.landmarks
    note = landmarks.length
      ? `${ext.providerNote}（半径 ${radiusM}m）`
      : `缓存与外部地图均无结果（半径 ${radiusM}m）`
  }

  return { landmarks, note }
}
