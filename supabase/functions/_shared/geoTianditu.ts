/**
 * 天地图逆地理 —— 只用来回答「我在哪」。
 *
 * 为什么只用逆地理、不用它的 POI 检索：实测同一位置（康定城区）天地图周边检索
 * 只返回 1 条「靓点坊」美容店，本地 PostGIS 有 12 条（跑马山 96m、折多河 239m、
 * 安觉寺 300m…）；专名搜「折多山」它给的第一条在 30 公里外的塔公镇。
 * POI 撞库继续走本地库，天地图只补我们缺的三样：省份、乡镇街道、道路。
 *
 * 坐标系用 CGCS2000，与 WGS84 实用等价（差异 < 1m），可以直接送原始 GPS。
 * 这点跟高德不同 —— 高德要 GCJ-02，我们一直送 WGS84，境内偏了 300～500 米。
 *
 * Key 必须是**服务端**类型。浏览器端 key 从机房 IP 调会 403（code 301012）。
 */

const ENDPOINT = 'https://api.tianditu.gov.cn/geocoder'
/** 问路 FC 在语音critical path 上，宁可退回本地也不能让用户干等 */
const TIMEOUT_MS = 1200

export type TiandituPlace = {
  province: string | null
  city: string | null
  county: string | null
  town: string | null
  road: string | null
  roadDistanceM: number | null
  /** 离最近兴趣点的距离：实测是很干净的人烟密度信号，用来判城/镇/野 */
  poiDistanceM: number | null
  formattedAddress: string | null
}

function str(v: unknown): string | null {
  const s = String(v ?? '').trim()
  return s || null
}

function num(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export async function tiandituRegeo(
  lat: number,
  lng: number,
): Promise<TiandituPlace | null> {
  const key = Deno.env.get('TIANDITU_KEY')?.trim()
  if (!key) return null

  const qs = new URLSearchParams({
    postStr: JSON.stringify({
      lon: Number(lng.toFixed(6)),
      lat: Number(lat.toFixed(6)),
      ver: 1,
    }),
    type: 'geocode',
    tk: key,
  })

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${ENDPOINT}?${qs}`, { signal: ctrl.signal })
    if (!res.ok) {
      console.warn('[tianditu] HTTP', res.status)
      return null
    }
    const data = await res.json()
    if (String(data?.status ?? '') !== '0') {
      console.warn('[tianditu]', data?.msg ?? data?.resolve ?? data)
      return null
    }
    const result = (data.result ?? {}) as Record<string, unknown>
    const ac = (result.addressComponent ?? {}) as Record<string, unknown>
    return {
      province: str(ac.province),
      city: str(ac.city),
      county: str(ac.county),
      town: str(ac.town),
      road: str(ac.road),
      roadDistanceM: num(ac.road_distance),
      poiDistanceM: num(ac.poi_distance),
      formattedAddress: str(result.formatted_address),
    }
  } catch (e) {
    console.warn('[tianditu] regeo failed:', e instanceof Error ? e.message : e)
    return null
  } finally {
    clearTimeout(timer)
  }
}
