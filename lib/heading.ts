/** GPS 航向：低于此速度（m/s）不可靠。移动中优先用它，静止后改走缓存/罗盘。 */
export const GPS_MIN_SPEED_MS = 2
/** 达到此速度时 GPS 航向置信度拉满 */
export const GPS_FULL_SPEED_MS = 7
/** 从移动过渡到静止时，保留最近有效 GPS 航向一段时间，再切到罗盘 */
export const HEADING_CACHE_TTL_MS = 8_000
/** 罗盘偶发无效回调时，短暂保留最近有效朝向，避免点/箭头闪烁 */
export const COMPASS_CACHE_TTL_MS = 3_000
/** 置信度 ≥ 此值时地图显示箭头，否则蓝点 */
export const ARROW_CONFIDENCE_THRESHOLD = 0.55
/**
 * 加速度计 |z|/|a|：接近 1 表示屏幕近似水平（平放）。
 * 这里只把它当作“置信度加成”，不再作为是否启用罗盘的硬门槛。
 */
export const FLAT_Z_RATIO = 0.82

export type HeadingSource = 'gps' | 'compass' | 'cache' | 'manual' | null

export type HeadingSnapshot = {
  heading: number | null
  confidence: number
  source: HeadingSource
  showArrow: boolean
  speed: number | null
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n))
}

export function normalizeHeadingDeg(deg: number): number {
  let h = deg % 360
  if (h < 0) h += 360
  return h
}

/** GPS / 系统返回的 heading：无效时常为 -1 或 NaN */
export function isValidHeadingDeg(heading: number | null | undefined): heading is number {
  return (
    typeof heading === 'number' &&
    Number.isFinite(heading) &&
    heading >= 0 &&
    heading <= 360
  )
}

export function gpsHeadingConfidence(speedMs: number | null | undefined): number {
  if (speedMs == null || !Number.isFinite(speedMs) || speedMs < GPS_MIN_SPEED_MS) {
    return 0
  }
  if (speedMs >= GPS_FULL_SPEED_MS) return 1
  return clamp01(
    (speedMs - GPS_MIN_SPEED_MS) / (GPS_FULL_SPEED_MS - GPS_MIN_SPEED_MS),
  )
}

/** 由加速度计判断手机是否近似水平平放（可信任罗盘指向） */
export function flatnessFromAccel(x: number, y: number, z: number): number {
  const mag = Math.hypot(x, y, z)
  if (mag < 0.3) return 0
  return clamp01(Math.abs(z) / mag)
}

export function compassConfidence(flatness: number, hasCompass: boolean): number {
  if (!hasCompass) return 0
  // 罗盘用于静止态兜底。越平越稳，但不把姿态作为硬门槛。
  const boost = flatness >= FLAT_Z_RATIO ? (flatness - FLAT_Z_RATIO) * 0.5 : 0
  return clamp01(0.58 + boost)
}

type CacheEntry = {
  heading: number
  confidence: number
  at: number
}

/**
 * 融合 GPS course、短时缓存、水平罗盘。
 * 规则：
 * 1) 移动中优先 GPS 航向
 * 2) 刚停下先沿用最近一段 GPS 航向缓存
 * 3) 缓存过期后再回退到罗盘
 */
export class HeadingFusion {
  private cache: CacheEntry | null = null
  private lastGpsHeading: number | null = null
  private lastSpeed: number | null = null
  private compassHeading: number | null = null
  private compassAt = 0
  private flatness = 0

  pushGps(heading: number | null | undefined, speedMs: number | null | undefined) {
    this.lastSpeed =
      speedMs != null && Number.isFinite(speedMs) ? Math.max(0, speedMs) : null

    const conf = gpsHeadingConfidence(this.lastSpeed)
    if (isValidHeadingDeg(heading) && conf > 0) {
      const h = normalizeHeadingDeg(heading)
      this.lastGpsHeading = h
      this.cache = { heading: h, confidence: conf, at: Date.now() }
    }
  }

  pushCompass(heading: number | null | undefined) {
    if (isValidHeadingDeg(heading)) {
      this.compassHeading = normalizeHeadingDeg(heading)
      this.compassAt = Date.now()
    }
  }

  pushAccel(x: number, y: number, z: number) {
    this.flatness = flatnessFromAccel(x, y, z)
  }

  debugState() {
    return {
      lastGpsHeading: this.lastGpsHeading,
      lastSpeed: this.lastSpeed,
      compassHeading: this.compassHeading,
      compassAt: this.compassAt,
      flatness: this.flatness,
      cache: this.cache,
    }
  }

  /** 开发手动坐标：始终高置信箭头 */
  static manual(heading: number): HeadingSnapshot {
    const h = normalizeHeadingDeg(heading)
    return {
      heading: h,
      confidence: 1,
      source: 'manual',
      showArrow: true,
      speed: null,
    }
  }

  snapshot(now = Date.now()): HeadingSnapshot {
    const speed = this.lastSpeed
    const gpsConf = gpsHeadingConfidence(speed)
    const hasFreshCompass =
      this.compassHeading != null && now - this.compassAt <= COMPASS_CACHE_TTL_MS
    const compassConf = compassConfidence(
      this.flatness,
      hasFreshCompass,
    )
    // 正在移动：优先用 GPS / 位移航向
    if (gpsConf > 0 && this.lastGpsHeading != null) {
      return {
        heading: this.lastGpsHeading,
        confidence: gpsConf,
        source: 'gps',
        showArrow: gpsConf >= ARROW_CONFIDENCE_THRESHOLD,
        speed,
      }
    }

    if (this.cache) {
      const age = now - this.cache.at
      if (age <= HEADING_CACHE_TTL_MS) {
        const decay = 1 - age / HEADING_CACHE_TTL_MS
        const confidence = this.cache.confidence * decay
        if (confidence > 0.05) {
          return {
            heading: this.cache.heading,
            confidence,
            source: 'cache',
            showArrow: confidence >= 0.2,
            speed,
          }
        }
      }
    }

    // 静止一段时间后，再回退到罗盘
    if (compassConf > 0 && hasFreshCompass) {
      return {
        heading: this.compassHeading,
        confidence: compassConf,
        source: 'compass',
        showArrow: compassConf >= ARROW_CONFIDENCE_THRESHOLD,
        speed,
      }
    }

    return {
      heading: null,
      confidence: 0,
      source: null,
      showArrow: false,
      speed,
    }
  }
}
