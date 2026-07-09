import * as Location from 'expo-location'
import { loadDevLocationOverride, overrideToCoords } from './devLocation'
import { isDevSimulator } from './isDevSimulator'
import {
  HeadingFusion,
  type HeadingSource,
  isValidHeadingDeg,
} from './heading'

/** 成都锦江附近，开发默认坐标（近 OSM 河道，便于测「前方的河」） */
export const DEV_DEFAULT_LOCATION = {
  latitude: Number(process.env.EXPO_PUBLIC_DEV_LAT ?? '30.6568'),
  longitude: Number(process.env.EXPO_PUBLIC_DEV_LNG ?? '104.0652'),
  heading: Number(process.env.EXPO_PUBLIC_DEV_HEADING ?? '70'),
}

export type UserCoords = {
  latitude: number
  longitude: number
  /** 可信航向（度，正北为 0）；无可靠朝向时为 null */
  heading: number | null
  /** 0～1，用于箭头展示与是否把朝向交给后端 */
  headingConfidence: number
  headingSource: HeadingSource
  /** 置信度足够时地图画箭头，否则蓝点 */
  showArrow: boolean
  speed: number | null
  accuracy: number | null
  source: 'gps' | 'dev_mock'
}

/** LocationProvider 持续写入，问路时优先读这里 */
let publishedCoords: UserCoords | null = null

export function publishUserCoords(coords: UserCoords) {
  publishedCoords = coords
}

export function peekUserCoords(): UserCoords | null {
  return publishedCoords
}

/** iOS 模拟器默认坐标（旧金山 Apple Park 一带） */
function isSimulatorSanFrancisco(lat: number, lng: number) {
  return lat > 37.2 && lat < 38.2 && lng < -121.5 && lng > -123
}

/** 开发环境：模拟器假定位时自动切到国内测试点 */
export function shouldUseDevMockLocation(coords: { latitude: number; longitude: number }) {
  if (!isDevSimulator()) return false
  if (process.env.EXPO_PUBLIC_DEV_USE_REAL_GPS === '1') return false
  if (process.env.EXPO_PUBLIC_DEV_USE_MOCK_LOCATION === '1') return true
  return isSimulatorSanFrancisco(coords.latitude, coords.longitude)
}

export function devMockCoords(): UserCoords {
  const snap = HeadingFusion.manual(DEV_DEFAULT_LOCATION.heading)
  return {
    latitude: DEV_DEFAULT_LOCATION.latitude,
    longitude: DEV_DEFAULT_LOCATION.longitude,
    heading: snap.heading,
    headingConfidence: snap.confidence,
    headingSource: snap.source,
    showArrow: snap.showArrow,
    speed: null,
    accuracy: 10,
    source: 'dev_mock',
  }
}

export function ensureLocationPermission() {
  return Location.requestForegroundPermissionsAsync().then((r) => r.status === 'granted')
}

function attachHeading(
  base: Omit<
    UserCoords,
    'heading' | 'headingConfidence' | 'headingSource' | 'showArrow' | 'speed'
  >,
  snap: ReturnType<HeadingFusion['snapshot']>,
): UserCoords {
  return {
    ...base,
    heading: snap.heading,
    headingConfidence: snap.confidence,
    headingSource: snap.source,
    showArrow: snap.showArrow,
    speed: snap.speed,
  }
}

/** 单次定位兜底（无 Provider 发布时）；正常路径用 peekUserCoords */
export async function readUserCoords(): Promise<UserCoords> {
  if (publishedCoords) return publishedCoords

  if (isDevSimulator()) {
    const override = await loadDevLocationOverride()
    if (override) {
      const coords = overrideToCoords(override)
      publishUserCoords(coords)
      return coords
    }
  }

  const granted = await ensureLocationPermission()
  if (!granted) {
    if (isDevSimulator()) {
      const mock = devMockCoords()
      publishUserCoords(mock)
      return mock
    }
    throw new Error('需要定位权限才能回答地理问题')
  }

  let position: Location.LocationObject
  try {
    position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.BestForNavigation,
    })
  } catch {
    if (isDevSimulator()) {
      const mock = devMockCoords()
      publishUserCoords(mock)
      return mock
    }
    throw new Error('无法获取当前位置')
  }

  const { latitude, longitude, heading, accuracy, speed } = position.coords

  if (shouldUseDevMockLocation({ latitude, longitude })) {
    const mock = devMockCoords()
    publishUserCoords(mock)
    return mock
  }

  const fusion = new HeadingFusion()
  fusion.pushGps(
    isValidHeadingDeg(heading) ? heading : null,
    speed ?? null,
  )
  const coords = attachHeading(
    {
      latitude,
      longitude,
      accuracy: accuracy ?? null,
      source: 'gps',
    },
    fusion.snapshot(),
  )
  publishUserCoords(coords)
  return coords
}

export function buildCoordsFromPosition(
  position: Location.LocationObject,
  fusion: HeadingFusion,
): UserCoords {
  const { latitude, longitude, heading, accuracy, speed } = position.coords

  if (shouldUseDevMockLocation({ latitude, longitude })) {
    return devMockCoords()
  }

  fusion.pushGps(
    isValidHeadingDeg(heading) ? heading : null,
    speed ?? null,
  )

  return attachHeading(
    {
      latitude,
      longitude,
      accuracy: accuracy ?? null,
      source: 'gps',
    },
    fusion.snapshot(),
  )
}

export function buildCoordsWithFusion(
  latitude: number,
  longitude: number,
  accuracy: number | null,
  source: 'gps' | 'dev_mock',
  fusion: HeadingFusion,
): UserCoords {
  return attachHeading(
    { latitude, longitude, accuracy, source },
    fusion.snapshot(),
  )
}
