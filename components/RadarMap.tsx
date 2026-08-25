import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import MapView, { Circle, Marker } from 'react-native-maps'
import { useUserLocation } from '../lib/LocationContext'
import { DEV_DEFAULT_LOCATION } from '../lib/location'
import type { ProactiveMapOverlay } from '../lib/proactiveMapDev'
import { colors } from '../lib/theme'

export const MAP_FOLLOW_RESUME_MS = 8_000

/** 讲解中高亮：与「已讲」绿点同色系 */
const SPEAK_ACTIVE_GREEN = '#4ade80'
const SPEAK_ACTIVE_CORE = '#22c55e'

export type SpeakFocusPoi = {
  lat: number
  lng: number
  name: string
  at: number
}

const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#0b1220' }] },
  { elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.stroke', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1e293b' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#0f172a' }] },
  { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#060a12' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative', elementType: 'labels', stylers: [{ visibility: 'off' }] },
]

function UserLocationDot() {
  return (
    <View style={styles.dotOuter} pointerEvents="none">
      <View style={styles.dotHalo} />
      <View style={styles.dotCore} />
    </View>
  )
}

/** 讲解中动态绿点：双涟漪 + 内核呼吸 */
function SpeakFocusPin() {
  const ring1 = useRef(new Animated.Value(0)).current
  const ring2 = useRef(new Animated.Value(0)).current
  const breath = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const loopRing = (value: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(value, {
            toValue: 1,
            duration: 1600,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(value, {
            toValue: 0,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
      )
    const breathLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(breath, {
          toValue: 0,
          duration: 700,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    )
    const a1 = loopRing(ring1, 0)
    const a2 = loopRing(ring2, 550)
    a1.start()
    a2.start()
    breathLoop.start()
    return () => {
      a1.stop()
      a2.stop()
      breathLoop.stop()
    }
  }, [ring1, ring2, breath])

  const ringStyle = (value: Animated.Value) => ({
    opacity: value.interpolate({
      inputRange: [0, 0.15, 1],
      outputRange: [0.65, 0.45, 0],
    }),
    transform: [
      {
        scale: value.interpolate({
          inputRange: [0, 1],
          outputRange: [0.35, 1.55],
        }),
      },
    ],
  })

  const coreScale = {
    transform: [
      {
        scale: breath.interpolate({
          inputRange: [0, 1],
          outputRange: [1, 1.18],
        }),
      },
    ],
  }

  return (
    <View style={styles.speakOuter} pointerEvents="none">
      <Animated.View style={[styles.speakRing, ringStyle(ring1)]} />
      <Animated.View style={[styles.speakRing, ringStyle(ring2)]} />
      <Animated.View style={[styles.speakHalo, coreScale]}>
        <View style={styles.speakCore} />
      </Animated.View>
    </View>
  )
}

function markerColor(kind: ProactiveMapOverlay['markers'][0]['kind']) {
  switch (kind) {
    case 'anchor':
      return '#38bdf8'
    case 'candidate':
      return '#fbbf24'
    case 'forward_hit':
      return '#a78bfa'
    case 'last_spoken':
      return SPEAK_ACTIVE_GREEN
    case 'last_skipped':
      return '#94a3b8'
    default:
      return '#fbbf24'
  }
}

function DevMapPin({ color }: { color: string }) {
  return (
    <View style={styles.devPinHit} pointerEvents="none">
      <View style={[styles.devPin, { borderColor: color }]}>
        <View style={[styles.devPinCore, { backgroundColor: color }]} />
      </View>
    </View>
  )
}

function isValidLatLng(lat: number, lng: number) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  )
}

function samePoiName(a: string, b: string) {
  const n = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '')
  return n(a) === n(b) && n(a).length > 0
}

function nearEnough(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
) {
  return Math.abs(a.lat - b.lat) < 0.00035 && Math.abs(a.lng - b.lng) < 0.00035
}

function markersSignature(
  markers: ProactiveMapOverlay['markers'] | undefined,
): string {
  if (!markers?.length) return ''
  return markers
    .map((m) => `${m.kind}:${m.name}:${m.lat.toFixed(4)},${m.lng.toFixed(4)}`)
    .join('|')
}

export function RadarMap({
  proactiveOverlay,
  speakFocus = null,
  onDevCandidatePress,
  onDevLongPressMap,
}: {
  proactiveOverlay?: ProactiveMapOverlay | null
  speakFocus?: SpeakFocusPoi | null
  onDevCandidatePress?: (marker: ProactiveMapOverlay['markers'][0]) => void
  /** __DEV__：长按地图设测试位置 */
  onDevLongPressMap?: (lat: number, lng: number) => void
}) {
  const { coords, loading, manualLocation, mapAutoRecenter } = useUserLocation()
  /** 手动测试位：勿用 iOS 原生跟车（会跟回真实 GPS）；跟回时用 React 坐标=测试点 */
  const pinToManual = Boolean(manualLocation)
  const useNativeUserLocation = Platform.OS === 'ios' && !pinToManual
  const mapRef = useRef<MapView>(null)
  const [paused, setPaused] = useState(false)
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSpeakAtRef = useRef<number | null>(null)
  const [trackPins, setTrackPins] = useState(true)
  const pinTrackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mapAutoRecenterRef = useRef(mapAutoRecenter)
  mapAutoRecenterRef.current = mapAutoRecenter

  // 自定义 Marker + tracksViewChanges=false 时，新增黄点常不绘制；变更后短暂 true 再关掉
  const markerSig = markersSignature(proactiveOverlay?.markers)
  useEffect(() => {
    setTrackPins(true)
    if (pinTrackTimerRef.current) clearTimeout(pinTrackTimerRef.current)
    pinTrackTimerRef.current = setTimeout(() => {
      pinTrackTimerRef.current = null
      setTrackPins(false)
    }, 900)
    return () => {
      if (pinTrackTimerRef.current) clearTimeout(pinTrackTimerRef.current)
    }
  }, [markerSig])

  const clearResume = useCallback(() => {
    if (resumeTimerRef.current) {
      clearTimeout(resumeTimerRef.current)
      resumeTimerRef.current = null
    }
  }, [])

  const resumeFollow = useCallback(() => {
    clearResume()
    setPaused(false)
  }, [clearResume])

  /** 由 Dev 面板开关控制；关则拖动/讲解后不自动切回 */
  const scheduleResumeFollow = useCallback(
    (ms: number) => {
      clearResume()
      if (!mapAutoRecenterRef.current) return
      resumeTimerRef.current = setTimeout(() => {
        resumeTimerRef.current = null
        setPaused(false)
      }, ms)
    },
    [clearResume],
  )

  const pauseFollow = useCallback(() => {
    setPaused(true)
    scheduleResumeFollow(MAP_FOLLOW_RESUME_MS)
  }, [scheduleResumeFollow])

  const handleLongPress = useCallback(
    (e: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) => {
      if (!__DEV__ || !onDevLongPressMap) return
      const { latitude, longitude } = e.nativeEvent.coordinate
      if (!isValidLatLng(latitude, longitude)) return
      clearResume()
      setPaused(true)
      scheduleResumeFollow(20_000)
      mapRef.current?.animateToRegion(
        {
          latitude,
          longitude,
          latitudeDelta: 0.04,
          longitudeDelta: 0.04,
        },
        400,
      )
      onDevLongPressMap(latitude, longitude)
    },
    [onDevLongPressMap, clearResume, scheduleResumeFollow],
  )

  useEffect(() => () => clearResume(), [clearResume])

  // 关掉自动切回时：取消已排队的恢复
  useEffect(() => {
    if (mapAutoRecenter) return
    clearResume()
  }, [mapAutoRecenter, clearResume])

  // 主动讲解跟镜：只在 at 变化时动一次
  useEffect(() => {
    if (!speakFocus || !isValidLatLng(speakFocus.lat, speakFocus.lng)) return
    if (lastSpeakAtRef.current === speakFocus.at) return
    lastSpeakAtRef.current = speakFocus.at
    clearResume()
    setPaused(true)
    const region = {
      latitude: speakFocus.lat,
      longitude: speakFocus.lng,
      latitudeDelta: 0.02,
      longitudeDelta: 0.02,
    }
    const t = setTimeout(() => mapRef.current?.animateToRegion(region, 450), 80)
    scheduleResumeFollow(20_000)
    return () => clearTimeout(t)
  }, [speakFocus?.at, speakFocus?.lat, speakFocus?.lng, clearResume, scheduleResumeFollow])

  // hooks 必须全部在任何 early return 之前（曾因此把雷达页弄挂成空白）
  if (loading && !coords) {
    return <View style={styles.fallback} />
  }

  const latitude = coords?.latitude ?? DEV_DEFAULT_LOCATION.latitude
  const longitude = coords?.longitude ?? DEV_DEFAULT_LOCATION.longitude
  const lat = isValidLatLng(latitude, longitude)
    ? latitude
    : DEV_DEFAULT_LOCATION.latitude
  const lng = isValidLatLng(latitude, longitude)
    ? longitude
    : DEV_DEFAULT_LOCATION.longitude
  const overlay = proactiveOverlay ?? null

  const following = !paused
  const speakOk =
    speakFocus && isValidLatLng(speakFocus.lat, speakFocus.lng) ? speakFocus : null
  // 讲解中：藏掉同名黄/紫点，只留动态绿点，避免叠两层看不出 Activate
  const markers =
    overlay?.markers.filter((m) => {
      if (!isValidLatLng(m.lat, m.lng)) return false
      if (!speakOk) return true
      if (m.kind !== 'candidate' && m.kind !== 'forward_hit') return true
      if (samePoiName(m.name, speakOk.name)) return false
      if (nearEnough(m, speakOk)) return false
      return true
    }) ?? []

  return (
    <>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={{
          latitude: lat,
          longitude: lng,
          latitudeDelta: 0.015,
          longitudeDelta: 0.015,
        }}
        region={
          useNativeUserLocation || !following
            ? undefined
            : {
                latitude: lat,
                longitude: lng,
                latitudeDelta: 0.015,
                longitudeDelta: 0.015,
              }
        }
        showsUserLocation={useNativeUserLocation}
        followsUserLocation={useNativeUserLocation && following}
        showsMyLocationButton={false}
        showsCompass={false}
        showsScale={false}
        showsTraffic={false}
        showsIndoors={false}
        showsBuildings={false}
        showsPointsOfInterests={false}
        rotateEnabled={useNativeUserLocation}
        pitchEnabled={false}
        mapType={Platform.OS === 'ios' ? 'mutedStandard' : 'standard'}
        customMapStyle={Platform.OS === 'android' ? DARK_MAP_STYLE : undefined}
        userInterfaceStyle="dark"
        onPanDrag={pauseFollow}
        onLongPress={__DEV__ && onDevLongPressMap ? handleLongPress : undefined}
      >
        {!useNativeUserLocation ? (
          <Marker
            key="user-location-dot"
            coordinate={{ latitude: lat, longitude: lng }}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={false}
          >
            <UserLocationDot />
          </Marker>
        ) : null}

        {speakOk ? (
          <Marker
            key={`speak-${speakOk.at}`}
            coordinate={{ latitude: speakOk.lat, longitude: speakOk.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
            /** 动画自定义 View 必须持续重绘，否则涟漪不更新 */
            tracksViewChanges
            zIndex={100}
            title={speakOk.name}
            description="正在讲解"
          >
            <SpeakFocusPin />
          </Marker>
        ) : null}

        {overlay?.anchor &&
        isValidLatLng(overlay.anchor.lat, overlay.anchor.lng) &&
        overlay.spanRadiusKm > 0 ? (
          <Circle
            center={overlay.anchor}
            radius={Math.min(overlay.spanRadiusKm, 50) * 1000}
            strokeColor="rgba(56, 189, 248, 0.55)"
            fillColor="rgba(56, 189, 248, 0.08)"
            strokeWidth={1}
          />
        ) : null}

        {markers.map((m) => {
          const tappable =
            __DEV__ &&
            onDevCandidatePress &&
            (m.kind === 'candidate' || m.kind === 'forward_hit')
          return (
            <Marker
              key={m.id}
              coordinate={{ latitude: m.lat, longitude: m.lng }}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={trackPins}
              zIndex={tappable ? 40 : 10}
              title={__DEV__ ? m.name : undefined}
              description={__DEV__ ? m.kind : undefined}
              onPress={
                tappable
                  ? (e) => {
                      e.stopPropagation?.()
                      onDevCandidatePress(m)
                    }
                  : undefined
              }
            >
              <DevMapPin color={markerColor(m.kind)} />
            </Marker>
          )
        })}
      </MapView>

      {paused ? (
        <Pressable style={styles.recenterBtn} onPress={resumeFollow}>
          <Text style={styles.recenterBtnText}>回位</Text>
        </Pressable>
      ) : null}
    </>
  )
}

const styles = StyleSheet.create({
  fallback: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0b1220',
  },
  recenterBtn: {
    position: 'absolute',
    right: 16,
    bottom: 120,
    zIndex: 20,
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    borderWidth: 1,
    borderColor: 'rgba(96, 165, 250, 0.45)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
  },
  recenterBtnText: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '700',
  },
  dotOuter: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotHalo: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(56, 189, 248, 0.25)',
  },
  dotCore: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: '#0b1220',
  },
  speakOuter: {
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speakRing: {
    position: 'absolute',
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2.5,
    borderColor: SPEAK_ACTIVE_GREEN,
    backgroundColor: 'rgba(74, 222, 128, 0.18)',
  },
  speakHalo: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 3,
    borderColor: SPEAK_ACTIVE_GREEN,
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  speakCore: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: SPEAK_ACTIVE_CORE,
  },
  devPinHit: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  devPin: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
  },
  devPinCore: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
})
