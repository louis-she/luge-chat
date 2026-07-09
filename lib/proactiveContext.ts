/** 最近一次主动讲解的 POI，供后续用户提问时判断是否「延续深聊」 */
export type ProactivePoiContext = {
  poi_name: string
  amap_poi_id?: string | null
  lat: number
  lng: number
  category?: string
  spoken_at: number
}

const TTL_MS = 15 * 60 * 1000

let recent: ProactivePoiContext | null = null

export function setProactivePoiContext(
  ctx: Omit<ProactivePoiContext, 'spoken_at'> & { spoken_at?: number },
) {
  recent = { ...ctx, spoken_at: ctx.spoken_at ?? Date.now() }
}

export function getProactivePoiContext(): ProactivePoiContext | null {
  if (!recent) return null
  if (Date.now() - recent.spoken_at > TTL_MS) {
    recent = null
    return null
  }
  return recent
}

export function clearProactivePoiContext() {
  recent = null
}
