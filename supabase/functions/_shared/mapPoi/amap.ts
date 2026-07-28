import type {
  MapAroundQuery,
  MapPoi,
  MapPoiCategory,
  MapPoiProvider,
  MapRegeoResult,
} from './types.ts'

type AmapPoi = {
  id?: string
  name?: string
  type?: string
  address?: string
  location?: string
  distance?: string
  rating?: string
  biz_ext?: string
  pname?: string
  cityname?: string
  adname?: string
  tel?: string
}

const CATEGORY_TYPES: Record<MapPoiCategory, string> = {
  scenic: '风景名胜',
  geo_landmark: '风景名胜|地名地址信息',
  ask_nearby: '风景名胜|地名地址信息|交通设施服务|道路附属设施',
}

function parseLngLat(location: string | undefined): { lat: number; lng: number } | null {
  if (!location) return null
  const [lng, lat] = location.split(',').map(Number)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { lat, lng }
}

function parseRating(poi: AmapPoi): number | null {
  if (poi.rating != null && poi.rating !== '') {
    const r = Number(poi.rating)
    if (Number.isFinite(r) && r > 0) return r
  }
  if (poi.biz_ext) {
    try {
      const ext = JSON.parse(poi.biz_ext) as { rating?: string | number }
      const r = Number(ext.rating)
      if (Number.isFinite(r) && r > 0) return r
    } catch {
      /* ignore */
    }
  }
  return null
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

function toMapPoi(poi: AmapPoi, userLat: number, userLng: number): MapPoi | null {
  const pos = parseLngLat(poi.location)
  if (!pos) return null
  const distance_m = poi.distance
    ? Math.round(Number(poi.distance))
    : Math.round(haversineM(userLat, userLng, pos.lat, pos.lng))
  if (!Number.isFinite(distance_m)) return null
  return {
    id: poi.id ?? null,
    name: poi.name ?? '未命名',
    type: poi.type ?? '',
    address: poi.address ?? '',
    lat: pos.lat,
    lng: pos.lng,
    distance_m,
    rating: parseRating(poi),
  }
}

async function amapGet<T>(
  key: string,
  path: string,
  params: Record<string, string>,
): Promise<T | null> {
  const qs = new URLSearchParams({ ...params, key })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const res = await fetch(`https://restapi.amap.com${path}?${qs}`, {
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) return null
    const data = await res.json()
    if (data.status !== '1' && data.status !== 1) {
      console.warn('[mapPoi:amap]', data.info ?? data)
      return null
    }
    return data as T
  } catch (e) {
    clearTimeout(timer)
    console.warn('[mapPoi:amap] fetch failed:', e)
    return null
  }
}

export function createAmapProvider(apiKey?: string | null): MapPoiProvider | null {
  const key = (apiKey ?? Deno.env.get('AMAP_WEB_KEY') ?? '').trim()
  if (!key) return null

  return {
    id: 'amap',

    async around(query: MapAroundQuery): Promise<MapPoi[]> {
      const limit = Math.min(Math.max(query.limit ?? 20, 1), 50)
      const radius = Math.min(Math.max(Math.round(query.radiusM), 100), 50000)
      const params: Record<string, string> = {
        location: `${query.lng.toFixed(6)},${query.lat.toFixed(6)}`,
        types: CATEGORY_TYPES[query.category],
        radius: String(radius),
        offset: String(limit),
        extensions: query.category === 'ask_nearby' ? 'base' : 'all',
        sortrule: query.category === 'scenic' ? 'weight' : 'distance',
      }
      if (query.keyword?.trim()) params.keywords = query.keyword.trim()

      const data = await amapGet<{ pois?: AmapPoi[] }>(key, '/v3/place/around', params)
      return (data?.pois ?? [])
        .map((p) => toMapPoi(p, query.lat, query.lng))
        .filter((p): p is MapPoi => p != null)
        .slice(0, limit)
    },

    async regeo(lat: number, lng: number): Promise<MapRegeoResult> {
      const data = await amapGet<{
        regeocode?: {
          formatted_address?: string
          addressComponent?: Record<string, unknown>
          pois?: AmapPoi[]
        }
      }>(key, '/v3/geocode/regeo', {
        location: `${lng.toFixed(6)},${lat.toFixed(6)}`,
        extensions: 'all',
        radius: '1000',
        poitype: CATEGORY_TYPES.geo_landmark,
      })

      const rg = data?.regeocode
      if (!rg) {
        return { text: null, formatted_address: null, pois: [] }
      }

      const lines: string[] = []
      if (rg.formatted_address) lines.push(`格式化地址：${rg.formatted_address}`)
      const ac = rg.addressComponent
      if (ac) {
        lines.push(
          `行政区：${[ac.province, ac.city, ac.district, ac.township].filter(Boolean).join('')}`,
        )
        const sn = ac.streetNumber as { street?: string; number?: string } | undefined
        if (sn?.street) {
          lines.push(`街道：${sn.street}${sn.number ?? ''}`)
        }
      }

      const pois = (rg.pois ?? [])
        .map((p) => toMapPoi(p, lat, lng))
        .filter((p): p is MapPoi => p != null)

      if (pois.length) {
        lines.push(
          '附近地理 POI：' +
            pois
              .slice(0, 8)
              .map((p) => `${p.name}（${p.address || p.type || ''}）`)
              .join('；'),
        )
      }

      return {
        text: lines.length ? lines.join('\n') : null,
        formatted_address: rg.formatted_address ?? null,
        pois,
      }
    },
  }
}
