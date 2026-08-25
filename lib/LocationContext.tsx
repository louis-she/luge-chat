import * as Location from 'expo-location'
import { Accelerometer } from 'expo-sensors'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  clearDevLocationOverride,
  loadDevLocationOverride,
  overrideToCoords,
  saveDevLocationOverride,
  type DevLocationOverride,
} from './devLocation'
import {
  loadMapAutoRecenter,
  saveMapAutoRecenter,
} from './devMapPrefs'
import { isDevSimulator } from './isDevSimulator'
import { HeadingFusion, isValidHeadingDeg } from './heading'
import {
  buildCoordsFromPosition,
  buildCoordsWithFusion,
  devMockCoords,
  ensureLocationPermission,
  publishUserCoords,
  type UserCoords,
} from './location'

type LocationContextValue = {
  coords: UserCoords | null
  loading: boolean
  refresh: () => Promise<UserCoords>
  manualLocation: DevLocationOverride | null
  setManualLocation: (
    input: Omit<DevLocationOverride, 'enabled'> & { enabled?: boolean },
  ) => Promise<void>
  clearManualLocation: () => Promise<void>
  /** Dev：拖动/讲解后是否自动切回「当前位置」（手动位时切回测试点，非系统 GPS） */
  mapAutoRecenter: boolean
  setMapAutoRecenter: (on: boolean) => Promise<void>
}

const LocationContext = createContext<LocationContextValue | null>(null)

export function LocationProvider({ children }: { children: ReactNode }) {
  const [coords, setCoordsState] = useState<UserCoords | null>(null)
  const [loading, setLoading] = useState(true)
  const [manualLocation, setManualLocationState] = useState<DevLocationOverride | null>(
    null,
  )
  const [mapAutoRecenter, setMapAutoRecenterState] = useState(true)
  const watchPosRef = useRef<Location.LocationSubscription | null>(null)
  const watchHeadRef = useRef<Location.LocationSubscription | null>(null)
  const accelRef = useRef<{ remove: () => void } | null>(null)
  const fusionRef = useRef(new HeadingFusion())
  const lastLatLngRef = useRef<{
    latitude: number
    longitude: number
    accuracy: number | null
  } | null>(null)
  const cacheTickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const setCoords = useCallback((next: UserCoords) => {
    publishUserCoords(next)
    setCoordsState(next)
  }, [])

  const emitFusion = useCallback(() => {
    const last = lastLatLngRef.current
    if (!last) return
    const next = buildCoordsWithFusion(
      last.latitude,
      last.longitude,
      last.accuracy,
      'gps',
      fusionRef.current,
    )
    setCoords(next)
  }, [setCoords])

  const stopSensors = useCallback(() => {
    watchPosRef.current?.remove()
    watchPosRef.current = null
    watchHeadRef.current?.remove()
    watchHeadRef.current = null
    accelRef.current?.remove()
    accelRef.current = null
    if (cacheTickRef.current) {
      clearInterval(cacheTickRef.current)
      cacheTickRef.current = null
    }
  }, [])

  const startWatch = useCallback(async () => {
    stopSensors()
    fusionRef.current = new HeadingFusion()

    const granted = await ensureLocationPermission()
    if (!granted) {
      if (isDevSimulator()) setCoords(devMockCoords())
      return
    }

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.BestForNavigation,
    })
    lastLatLngRef.current = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy ?? null,
    }
    setCoords(buildCoordsFromPosition(position, fusionRef.current))

    watchPosRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        distanceInterval: 3,
        timeInterval: 1000,
      },
      (p) => {
        lastLatLngRef.current = {
          latitude: p.coords.latitude,
          longitude: p.coords.longitude,
          accuracy: p.coords.accuracy ?? null,
        }
        const next = buildCoordsFromPosition(p, fusionRef.current)
        setCoords(next)
      },
    )

    try {
      watchHeadRef.current = await Location.watchHeadingAsync((h) => {
        const mag = h.trueHeading >= 0 ? h.trueHeading : h.magHeading
        fusionRef.current.pushCompass(isValidHeadingDeg(mag) ? mag : null)
        emitFusion()
      })
    } catch {
      /* 模拟器等可能无罗盘 */
    }

    try {
      Accelerometer.setUpdateInterval(200)
      accelRef.current = Accelerometer.addListener(({ x, y, z }) => {
        fusionRef.current.pushAccel(x, y, z)
        emitFusion()
      })
    } catch {
      /* web / 无传感器 */
    }

    // 缓存航向会随时间衰减，定时刷新箭头/蓝点
    cacheTickRef.current = setInterval(() => emitFusion(), 500)
  }, [stopSensors, setCoords, emitFusion])

  const applyManual = useCallback(
    (override: DevLocationOverride) => {
      stopSensors()
      setManualLocationState(override)
      setCoords(overrideToCoords(override))
    },
    [stopSensors, setCoords],
  )

  const setManualLocation = useCallback(
    async (input: Omit<DevLocationOverride, 'enabled'> & { enabled?: boolean }) => {
      const saved = await saveDevLocationOverride(input)
      applyManual(saved)
    },
    [applyManual],
  )

  const clearManualLocation = useCallback(async () => {
    await clearDevLocationOverride()
    setManualLocationState(null)
    await startWatch()
  }, [startWatch])

  const setMapAutoRecenter = useCallback(async (on: boolean) => {
    setMapAutoRecenterState(on)
    await saveMapAutoRecenter(on)
  }, [])

  const refresh = useCallback(async () => {
    if (isDevSimulator()) {
      const override = await loadDevLocationOverride()
      if (override) {
        applyManual(override)
        return overrideToCoords(override)
      }
    }

    const granted = await ensureLocationPermission()
    if (!granted) {
      const mock = isDevSimulator() ? devMockCoords() : null
      if (mock) setCoords(mock)
      else throw new Error('需要定位权限')
      return mock!
    }

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.BestForNavigation,
    })
    lastLatLngRef.current = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy ?? null,
    }
    const next = buildCoordsFromPosition(position, fusionRef.current)
    setCoords(next)
    return next
  }, [applyManual, setCoords])

  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      try {
        if (__DEV__) {
          const auto = await loadMapAutoRecenter()
          if (!cancelled) setMapAutoRecenterState(auto)
          const override = await loadDevLocationOverride()
          if (cancelled) return
          if (override) {
            applyManual(override)
            return
          }
        }

        if (!cancelled) await startWatch()
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    bootstrap()
    return () => {
      cancelled = true
      stopSensors()
    }
  }, [applyManual, startWatch, stopSensors])

  const value = useMemo(
    () => ({
      coords,
      loading,
      refresh,
      manualLocation,
      setManualLocation,
      clearManualLocation,
      mapAutoRecenter,
      setMapAutoRecenter,
    }),
    [
      coords,
      loading,
      refresh,
      manualLocation,
      setManualLocation,
      clearManualLocation,
      mapAutoRecenter,
      setMapAutoRecenter,
    ],
  )

  return (
    <LocationContext.Provider value={value}>{children}</LocationContext.Provider>
  )
}

export function useUserLocation() {
  const ctx = useContext(LocationContext)
  if (!ctx) throw new Error('useUserLocation must be used within LocationProvider')
  return ctx
}
