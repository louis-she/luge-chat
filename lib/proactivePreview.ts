import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config'
import { getDeviceId } from './deviceId'
import type { UserCoords } from './location'

export type ProactivePreviewCandidate = {
  name: string
  lat: number
  lng: number
  rating: number | null
  distance_m: number | null
  type?: string
}

export type ProactivePreviewResponse = {
  preview: boolean
  candidates: ProactivePreviewCandidate[]
  forward_map_hit: {
    name: string
    lat?: number
    lng?: number
    category?: string
    distance_m?: number
  } | null
}

/** 仅 __DEV__ + X-Luge-Debug：地图展示可能触发主动讲解的候选 POI */
export async function fetchProactivePreviewPois(
  coords: UserCoords,
  opts?: {
    accessToken?: string | null
    spokenPoiKeys?: string[]
    scenicRadiusKm?: number
  },
): Promise<ProactivePreviewResponse> {
  const deviceId = await getDeviceId()
  const token = opts?.accessToken?.trim() || SUPABASE_ANON_KEY
  const res = await fetch(`${SUPABASE_URL}/functions/v1/luge-chat`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Luge-Device-Id': deviceId,
      'X-Luge-Debug': '1',
    },
    body: JSON.stringify({
      mode: 'proactive_preview',
      latitude: coords.latitude,
      longitude: coords.longitude,
      heading: coords.heading,
      device_id: deviceId,
      spoken_poi_keys: opts?.spokenPoiKeys ?? [],
      scenic_radius_km: opts?.scenicRadiusKm ?? 8,
    }),
  })
  const data = (await res.json().catch(() => ({}))) as ProactivePreviewResponse & {
    error?: string
  }
  if (!res.ok) {
    throw new Error(data.error ?? '预览 POI 加载失败')
  }
  return data
}
