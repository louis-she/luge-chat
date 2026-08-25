/** 开发者雷达地图 overlay（仅 __DEV__ 渲染） */

export type ProactiveMapMarkerKind =
  | 'anchor'
  | 'candidate'
  | 'forward_hit'
  | 'last_spoken'
  | 'last_skipped'

export type ProactiveMapMarker = {
  id: string
  lat: number
  lng: number
  name: string
  kind: ProactiveMapMarkerKind
  type?: string
}

export type ProactiveMapOverlay = {
  anchor: { lat: number; lng: number } | null
  /** 位移门槛（km），用于画锚点参考圆 */
  spanRadiusKm: number
  markers: ProactiveMapMarker[]
}

export const EMPTY_PROACTIVE_MAP_OVERLAY: ProactiveMapOverlay = {
  anchor: null,
  spanRadiusKm: 20,
  markers: [],
}

/** useProactiveGuide 推送给地图的增量状态 */
export type ProactiveDevOverlay = {
  anchor: { lat: number; lng: number } | null
  spanRadiusKm: number
  lastEvent: {
    lat: number
    lng: number
    name: string
    status: 'spoken' | 'skipped'
    reason?: string
  } | null
}

export function mergeProactiveDevOverlay(
  prev: ProactiveMapOverlay,
  patch: ProactiveDevOverlay,
  candidateMarkers: ProactiveMapMarker[],
): ProactiveMapOverlay {
  const markers: ProactiveMapMarker[] = [...candidateMarkers]

  if (patch.anchor) {
    markers.push({
      id: 'anchor',
      lat: patch.anchor.lat,
      lng: patch.anchor.lng,
      name: '查询锚点',
      kind: 'anchor',
    })
  }

  if (patch.lastEvent) {
    markers.push({
      id: `last-${patch.lastEvent.status}`,
      lat: patch.lastEvent.lat,
      lng: patch.lastEvent.lng,
      name: patch.lastEvent.name,
      kind: patch.lastEvent.status === 'spoken' ? 'last_spoken' : 'last_skipped',
    })
  }

  return {
    anchor: patch.anchor ?? prev.anchor,
    spanRadiusKm: patch.spanRadiusKm,
    markers,
  }
}
