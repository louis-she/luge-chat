import { haversineKm } from './proactiveSpan'

/** 内存里只有「当前一份」周边风景库；新搜索整库替换，不追加。 */

export type ScenicLibraryPoi = {
  name: string
  lat: number
  lng: number
  distance_m: number | null
  type?: string
  amap_poi_id?: string | null
  rating?: number | null
}

type ScenicLibrary = {
  centerLat: number
  centerLng: number
  radiusKm: number
  pois: ScenicLibraryPoi[]
  fetchedAt: number
}

/** 距库中心 ≤ 搜索半径 × 该比例，视为仍在有效圈内，不重搜 */
export const SCENIC_LIBRARY_REFRESH_RATIO = 0.3

let library: ScenicLibrary | null = null

export function peekScenicLibrary(): ScenicLibrary | null {
  return library
}

export function clearScenicLibrary() {
  library = null
}

export function isScenicLibraryValid(
  lat: number,
  lng: number,
  radiusKm: number,
): boolean {
  if (!library) return false
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false
  if (Math.abs(library.radiusKm - radiusKm) > 0.05) return false
  const movedKm = haversineKm(library.centerLat, library.centerLng, lat, lng)
  return movedKm <= library.radiusKm * SCENIC_LIBRARY_REFRESH_RATIO
}

/** 用新结果整份替换当前库 */
export function replaceScenicLibrary(opts: {
  centerLat: number
  centerLng: number
  radiusKm: number
  pois: ScenicLibraryPoi[]
}) {
  library = {
    centerLat: opts.centerLat,
    centerLng: opts.centerLng,
    radiusKm: opts.radiusKm,
    pois: opts.pois,
    fetchedAt: Date.now(),
  }
}

function poiKey(p: { name: string; amap_poi_id?: string | null; lat: number; lng: number }) {
  const id = p.amap_poi_id?.trim()
  if (id) return `id:${id.toLowerCase()}`
  return `n:${p.name.trim().toLowerCase()}@${p.lat.toFixed(5)},${p.lng.toFixed(5)}`
}

/**
 * 把主动讲解补搜/命中的 POI 并进当前库（不整库冲掉），便于黄点跟上「空白」讲解点。
 * 若尚无库，则以当前位置为中心建一份浅库。
 */
export function upsertScenicLibraryPois(
  pois: ScenicLibraryPoi[],
  opts?: { centerLat?: number; centerLng?: number; radiusKm?: number },
): ScenicLibraryPoi[] {
  const incoming = pois.filter(
    (p) =>
      p.name?.trim() &&
      Number.isFinite(p.lat) &&
      Number.isFinite(p.lng),
  )
  if (!incoming.length) return library?.pois ?? []

  if (!library) {
    const lat = opts?.centerLat ?? incoming[0].lat
    const lng = opts?.centerLng ?? incoming[0].lng
    replaceScenicLibrary({
      centerLat: lat,
      centerLng: lng,
      radiusKm: opts?.radiusKm ?? 8,
      pois: incoming,
    })
    return library!.pois
  }

  const map = new Map<string, ScenicLibraryPoi>()
  for (const p of library.pois) map.set(poiKey(p), p)
  for (const p of incoming) map.set(poiKey(p), p)
  library = {
    ...library,
    pois: [...map.values()],
    fetchedAt: Date.now(),
  }
  return library.pois
}

/**
 * 圈内命中 → 直接返回现库；否则执行 fetcher，并用结果替换整库。
 * 若新搜索结果为空：保留旧库（避免野外/短暂无结果把黄点整盘冲掉）。
 */
export async function getOrReplaceScenicLibrary(
  lat: number,
  lng: number,
  radiusKm: number,
  fetcher: () => Promise<ScenicLibraryPoi[]>,
): Promise<{ pois: ScenicLibraryPoi[]; fromCache: boolean }> {
  if (isScenicLibraryValid(lat, lng, radiusKm) && library) {
    return { pois: library.pois, fromCache: true }
  }
  const pois = await fetcher()
  if (pois.length === 0 && library && library.pois.length > 0) {
    // 仍更新中心/半径标记？不——保持旧库有效，下次出圈再试。
    // 但若一直空会永远用旧库；给旧库一个「软过期」：中心仍用旧的，isScenicLibraryValid
    // 在已出圈时每次都会进 fetcher。若连续空，会反复打高德。
    // 折中：空结果时把中心挪到当前位置但保留旧 pois，半径不变 → 视为又进圈，减少刷空。
    replaceScenicLibrary({
      centerLat: lat,
      centerLng: lng,
      radiusKm,
      pois: library.pois,
    })
    return { pois: library.pois, fromCache: true }
  }
  replaceScenicLibrary({ centerLat: lat, centerLng: lng, radiusKm, pois })
  return { pois, fromCache: false }
}
