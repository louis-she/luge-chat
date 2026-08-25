/** 相对车头方位 / 口语距离（H1/H2） */

export function toRad(d: number) {
  return (d * Math.PI) / 180
}

export function toDeg(r: number) {
  return (r * 180) / Math.PI
}

export function bearingTo(lat1: number, lng1: number, lat2: number, lng2: number) {
  const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2))
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1))
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

/**
 * 相对车头（或行进方向）的口语方位。
 * reference 为朝向角（正北 0°，顺时针）；未知时返回「附近」。
 */
export function bearingLabel(bearing: number, reference: number | null): string {
  if (reference == null || !Number.isFinite(reference)) return '附近'
  let diff = bearing - reference
  while (diff > 180) diff -= 360
  while (diff < -180) diff += 360
  const abs = Math.abs(diff)
  if (abs <= 22) return '正前方'
  if (abs >= 158) return '正后方'
  if (diff > 0) {
    if (diff <= 67) return '右前方'
    if (diff <= 112) return '右侧'
    return '右后方'
  }
  if (diff >= -67) return '左前方'
  if (diff >= -112) return '左侧'
  return '左后方'
}

/** 口播用大约距离：约 80 米 / 约 800 米 / 约 1.2 公里 / 约 3 公里 */
export function formatDistanceSpoken(m: number): string {
  const n = Math.max(0, Math.round(Number(m) || 0))
  if (n < 1000) {
    const rounded = n < 100 ? Math.round(n / 10) * 10 : Math.round(n / 50) * 50
    return `约 ${Math.max(rounded, 10)} 米`
  }
  const km = n / 1000
  if (km < 10) {
    const one = Math.round(km * 10) / 10
    return `约 ${one} 公里`
  }
  return `约 ${Math.round(km)} 公里`
}

/** 排序：前方优先，再按距离 */
export function directionPriority(direction: string): number {
  if (direction.includes('正前')) return 0
  if (direction.includes('前')) return 1
  if (direction === '右侧' || direction === '左侧') return 2
  if (direction === '附近') return 3
  if (direction.includes('后')) return 4
  return 3
}

/** 超过该距离口播时必须带上大约距离（米） */
export const DISTANCE_MUST_SAY_M = 150
