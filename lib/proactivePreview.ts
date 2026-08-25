import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config'
import { getDeviceId } from './deviceId'
import type { UserCoords } from './location'
import { haversineKm } from './proactiveSpan'
import {
  getOrReplaceScenicLibrary,
  type ScenicLibraryPoi,
} from './scenicAroundCache'

export type ProactivePreviewCandidate = {
  name: string
  lat: number
  lng: number
  rating: number | null
  distance_m: number | null
  type?: string
  amap_poi_id?: string | null
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
  /** true = 未打高德，直接读本地风景库 */
  from_cache?: boolean
}

function withDistanceFrom(
  pois: ScenicLibraryPoi[],
  lat: number,
  lng: number,
): ScenicLibraryPoi[] {
  return pois.map((p) => ({
    ...p,
    distance_m: Math.round(haversineKm(lat, lng, p.lat, p.lng) * 1000),
  }))
}

async function fetchScenicAroundFromServer(
  coords: UserCoords,
  opts: {
    accessToken?: string | null
    scenicRadiusKm: number
  },
): Promise<ScenicLibraryPoi[]> {
  const deviceId = await getDeviceId()
  const token = opts.accessToken?.trim() || SUPABASE_ANON_KEY
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
      spoken_poi_keys: [],
      scenic_radius_km: opts.scenicRadiusKm,
      /** 服务端返回未过滤「已讲」的完整库，客户端自己滤；便于缓存复用 */
      return_raw_library: true,
    }),
  })
  const data = (await res.json().catch(() => ({}))) as ProactivePreviewResponse & {
    error?: string
    library?: ScenicLibraryPoi[]
  }
  if (!res.ok) {
    throw new Error(data.error ?? '预览 POI 加载失败')
  }
  if (Array.isArray(data.library)) {
    return data.library
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.name)
      .map((p) => ({
        name: p.name,
        lat: p.lat,
        lng: p.lng,
        distance_m: p.distance_m ?? null,
        type: p.type,
        amap_poi_id: p.amap_poi_id ?? null,
        rating: p.rating ?? null,
      }))
  }
  // 旧服务端：用 candidates 顶上
  return (data.candidates ?? []).map((c) => ({
    name: c.name,
    lat: c.lat,
    lng: c.lng,
    distance_m: c.distance_m,
    type: c.type,
    amap_poi_id: c.amap_poi_id ?? null,
    rating: c.rating,
  }))
}

function filterSpoken(
  pois: ScenicLibraryPoi[],
  spokenPoiKeys?: string[],
): ScenicLibraryPoi[] {
  if (!spokenPoiKeys?.length) return pois
  const spoken = new Set(
    spokenPoiKeys.map((k) => k.trim().toLowerCase()).filter(Boolean),
  )
  return pois.filter((p) => {
    const nameKey = p.name
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '')
    const idKey = p.amap_poi_id?.trim() ? `id:${p.amap_poi_id.trim()}` : null
    if (nameKey && spoken.has(nameKey)) return false
    if (idKey && spoken.has(idKey.toLowerCase())) return false
    return true
  })
}

/**
 * 共享风景库：圈内命中直接返回；走出半径×50% 才打高德，并用新结果整库替换。
 * 返回未做「当日已讲」过滤的完整库（距离按当前位置重算）。
 */
export async function ensureScenicAroundLibrary(
  coords: UserCoords,
  opts?: {
    accessToken?: string | null
    scenicRadiusKm?: number
  },
): Promise<{ pois: ScenicLibraryPoi[]; fromCache: boolean }> {
  const radiusKm = opts?.scenicRadiusKm ?? 8
  const { pois, fromCache } = await getOrReplaceScenicLibrary(
    coords.latitude,
    coords.longitude,
    radiusKm,
    () =>
      fetchScenicAroundFromServer(coords, {
        accessToken: opts?.accessToken,
        scenicRadiusKm: radiusKm,
      }),
  )
  return {
    pois: withDistanceFrom(pois, coords.latitude, coords.longitude),
    fromCache,
  }
}

/** 仅 __DEV__ + X-Luge-Debug：地图展示候选（读共享库，尽量不重搜） */
export async function fetchProactivePreviewPois(
  coords: UserCoords,
  opts?: {
    accessToken?: string | null
    spokenPoiKeys?: string[]
    scenicRadiusKm?: number
  },
): Promise<ProactivePreviewResponse> {
  const { pois: raw, fromCache } = await ensureScenicAroundLibrary(coords, {
    accessToken: opts?.accessToken,
    scenicRadiusKm: opts?.scenicRadiusKm,
  })
  const pois = filterSpoken(raw, opts?.spokenPoiKeys)
  if (__DEV__ && fromCache) {
    console.log('[scenic library] cache hit', { count: pois.length })
  } else if (__DEV__) {
    console.log('[scenic library] replaced', { count: raw.length })
  }
  return {
    preview: true,
    from_cache: fromCache,
    candidates: pois.slice(0, 40).map((p) => ({
      name: p.name,
      lat: p.lat,
      lng: p.lng,
      rating: p.rating ?? null,
      distance_m: p.distance_m,
      type: p.type,
      amap_poi_id: p.amap_poi_id ?? null,
    })),
    forward_map_hit: null,
  }
}
