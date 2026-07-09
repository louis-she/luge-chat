/** 主动讲解：距离 + 时间双门槛，避免频繁打高德 & 城里 POI 刷屏 */

export type ProactiveSpanConfig = {
  /** 距上次 check 锚点至少多少公里才允许新一轮地理查询 */
  minDistanceKm: number
  /** 两次 check 之间至少间隔（毫秒） */
  minCheckIntervalMs: number
  /** 两次开口之间至少间隔（毫秒） */
  minSpeakIntervalMs: number
}

export const DEFAULT_PROACTIVE_SPAN: ProactiveSpanConfig = {
  minDistanceKm: Number(process.env.EXPO_PUBLIC_PROACTIVE_MIN_DISTANCE_KM ?? '20'),
  minCheckIntervalMs: Number(
    process.env.EXPO_PUBLIC_PROACTIVE_MIN_CHECK_MINUTES ?? '10',
  ) * 60_000,
  minSpeakIntervalMs: Number(
    process.env.EXPO_PUBLIC_PROACTIVE_MIN_SPEAK_MINUTES ?? '15',
  ) * 60_000,
}

export type ProactiveCheckAnchor = {
  lat: number
  lng: number
  checkedAt: number
}

export type ProactiveSpanSnapshot = {
  anchor: ProactiveCheckAnchor | null
  lastSpeakAt: number | null
}

export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export type ProactiveGateResult =
  | { action: 'wait'; reason: string }
  | { action: 'check'; reason: string }

/**
 * 是否允许发起新一轮地理查询（打高德 regeo 等）。
 * 距离与时间须同时满足——只满足其一则继续等待。
 */
export function evaluateProactiveCheck(
  now: number,
  lat: number,
  lng: number,
  snapshot: ProactiveSpanSnapshot,
  config: ProactiveSpanConfig = DEFAULT_PROACTIVE_SPAN,
): ProactiveGateResult {
  const { anchor } = snapshot

  if (!anchor) {
    return { action: 'wait', reason: '尚未建立位移锚点' }
  }

  const elapsedMs = now - anchor.checkedAt
  if (elapsedMs < config.minCheckIntervalMs) {
    const remainMin = Math.ceil((config.minCheckIntervalMs - elapsedMs) / 60_000)
    return { action: 'wait', reason: `距上次查询不足 ${remainMin} 分钟` }
  }

  const movedKm = haversineKm(anchor.lat, anchor.lng, lat, lng)
  if (movedKm < config.minDistanceKm) {
    return {
      action: 'wait',
      reason: `距上次查询仅 ${movedKm.toFixed(1)} km（需 ${config.minDistanceKm} km）`,
    }
  }

  return {
    action: 'check',
    reason: `已移动 ${movedKm.toFixed(1)} km，距上次查询 ${Math.round(elapsedMs / 60_000)} 分钟`,
  }
}

/** 服务端返回可讲内容后，是否允许真的开口 */
export function canProactiveSpeak(
  now: number,
  snapshot: ProactiveSpanSnapshot,
  config: ProactiveSpanConfig = DEFAULT_PROACTIVE_SPAN,
): boolean {
  if (snapshot.lastSpeakAt == null) return true
  return now - snapshot.lastSpeakAt >= config.minSpeakIntervalMs
}

export function anchorAfterCheck(
  lat: number,
  lng: number,
  now: number,
): ProactiveCheckAnchor {
  return { lat, lng, checkedAt: now }
}
