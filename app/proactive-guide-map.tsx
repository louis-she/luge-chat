import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import MapView, { Marker, type MapPressEvent } from 'react-native-maps'
import { SafeAreaView } from 'react-native-safe-area-context'
import { loadSession } from '../lib/auth'
import { DEV_LOCATION_PRESETS } from '../lib/devLocation'
import { ensureLocationPermission, readUserCoords, type UserCoords } from '../lib/location'
import { useUserLocation } from '../lib/LocationContext'
import { useProactiveGuideSettings } from '../lib/ProactiveGuideContext'
import {
  fetchProactivePreviewPois,
  type ProactivePreviewCandidate,
} from '../lib/proactivePreview'
import { loadSpokenPoiKeysToday } from '../lib/proactiveSpoken'
import { colors, spacing } from '../lib/theme'

type MapPin = ProactivePreviewCandidate & {
  id: string
  kind: 'candidate' | 'forward'
}

function MapDot({ color }: { color: string }) {
  return (
    <View style={[styles.pin, { borderColor: color }]}>
      <View style={[styles.pinCore, { backgroundColor: color }]} />
    </View>
  )
}

function QueryPin() {
  return (
    <View style={styles.queryPin}>
      <View style={styles.queryPinCore} />
    </View>
  )
}

function coordsAt(lat: number, lng: number, heading: number | null): UserCoords {
  return {
    latitude: lat,
    longitude: lng,
    heading,
    headingConfidence: heading != null ? 1 : 0,
    headingSource: 'manual',
    showArrow: heading != null,
    speed: null,
    accuracy: 10,
    source: 'dev_mock',
  }
}

export default function ProactiveGuideMapScreen() {
  const router = useRouter()
  const { coords: liveCoords } = useUserLocation()
  const { settings } = useProactiveGuideSettings()
  const scenicRadiusRef = useRef(settings.scenicRadiusKm)
  scenicRadiusRef.current = settings.scenicRadiusKm
  const [pins, setPins] = useState<MapPin[]>([])
  const [forwardName, setForwardName] = useState<string | null>(null)
  const [queryLat, setQueryLat] = useState<number | null>(null)
  const [queryLng, setQueryLng] = useState<number | null>(null)
  const [queryHeading, setQueryHeading] = useState<number | null>(null)
  const [followGps, setFollowGps] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const loadGenRef = useRef(0)
  const mapRef = useRef<MapView>(null)
  const liveCoordsRef = useRef(liveCoords)
  const followGpsRef = useRef(followGps)
  const queryRef = useRef({ lat: queryLat, lng: queryLng, heading: queryHeading })

  liveCoordsRef.current = liveCoords
  followGpsRef.current = followGps
  queryRef.current = { lat: queryLat, lng: queryLng, heading: queryHeading }

  const animateTo = useCallback((lat: number, lng: number) => {
    mapRef.current?.animateToRegion(
      {
        latitude: lat,
        longitude: lng,
        latitudeDelta: 0.12,
        longitudeDelta: 0.12,
      },
      350,
    )
  }, [])

  const load = useCallback(async (at?: { lat: number; lng: number; heading?: number | null }) => {
    const gen = ++loadGenRef.current
    setError(null)
    setLoading(true)
    try {
      let coords: UserCoords
      if (at) {
        coords = coordsAt(at.lat, at.lng, at.heading ?? queryRef.current.heading)
      } else if (
        !followGpsRef.current &&
        queryRef.current.lat != null &&
        queryRef.current.lng != null
      ) {
        coords = coordsAt(
          queryRef.current.lat,
          queryRef.current.lng,
          queryRef.current.heading,
        )
      } else {
        const ok = await ensureLocationPermission()
        if (!ok) {
          setError('需要定位权限才能加载周边讲解点')
          setPins([])
          return
        }
        coords = liveCoordsRef.current ?? (await readUserCoords())
      }
      if (gen !== loadGenRef.current) return

      setQueryLat(coords.latitude)
      setQueryLng(coords.longitude)
      if (coords.heading != null) setQueryHeading(coords.heading)
      animateTo(coords.latitude, coords.longitude)

      const session = await loadSession()
      const spokenPoiKeys = await loadSpokenPoiKeysToday()
      const data = await fetchProactivePreviewPois(coords, {
        accessToken: session?.access_token,
        spokenPoiKeys,
        scenicRadiusKm: scenicRadiusRef.current,
      })
      if (gen !== loadGenRef.current) return

      const list: MapPin[] = data.candidates.map((c, i) => ({
        ...c,
        id: `c-${i}-${c.name.slice(0, 6)}`,
        kind: 'candidate' as const,
      }))
      const fwd = data.forward_map_hit
      if (fwd?.lat != null && fwd.lng != null) {
        list.unshift({
          id: 'forward',
          name: fwd.name,
          lat: fwd.lat,
          lng: fwd.lng,
          rating: null,
          distance_m: fwd.distance_m ?? null,
          type: fwd.category,
          kind: 'forward',
        })
        setForwardName(fwd.name)
      } else {
        setForwardName(null)
      }
      setPins(list)
      setUpdatedAt(Date.now())
    } catch (e) {
      if (gen !== loadGenRef.current) return
      setError(e instanceof Error ? e.message : '加载失败')
      setPins([])
    } finally {
      if (gen === loadGenRef.current) setLoading(false)
    }
  }, [animateTo])

  // 只在进入页面时拉一次；不要跟着 GPS 心跳重刷
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  const moveQueryTo = useCallback(
    (lat: number, lng: number, opts?: { heading?: number; follow?: boolean }) => {
      const follow = opts?.follow === true
      setFollowGps(follow)
      const heading = opts?.heading ?? queryRef.current.heading
      if (opts?.heading != null) setQueryHeading(opts.heading)
      setQueryLat(lat)
      setQueryLng(lng)
      animateTo(lat, lng)
      void load({ lat, lng, heading })
    },
    [animateTo, load],
  )

  const onMapPress = useCallback(
    (e: MapPressEvent) => {
      const { latitude, longitude } = e.nativeEvent.coordinate
      moveQueryTo(latitude, longitude)
    },
    [moveQueryTo],
  )

  const initialRegion = {
    latitude: 30.67,
    longitude: 104.06,
    latitudeDelta: 0.12,
    longitudeDelta: 0.12,
  }

  const queryLabel = followGps ? '跟随 GPS' : '手动选点'

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.back}>← 返回</Text>
        </Pressable>
        <Text style={styles.headerTitle}>主动讲解地图</Text>
        <Pressable onPress={() => void load()} hitSlop={12}>
          <Text style={styles.refresh}>刷新</Text>
        </Pressable>
      </View>

      <Text style={styles.hint}>
        点击地图或拖动蓝色「查询位置」针，按该点拉取周边「风景名胜」候选（半径见高级设置；已去重；当天讲过的会隐藏）。
      </Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.presetScroll}
        contentContainerStyle={styles.presetContent}
      >
        <Pressable
          style={[styles.presetChip, followGps && styles.presetChipActive]}
          onPress={() => {
            if (liveCoords) {
              moveQueryTo(liveCoords.latitude, liveCoords.longitude, {
                follow: true,
                heading: liveCoords.heading,
              })
            } else {
              setFollowGps(true)
              void load()
            }
          }}
        >
          <Text style={[styles.presetChipText, followGps && styles.presetChipTextActive]}>
            跟随 GPS
          </Text>
        </Pressable>
        {DEV_LOCATION_PRESETS.map((p) => (
          <Pressable
            key={p.id}
            style={styles.presetChip}
            onPress={() =>
              moveQueryTo(p.latitude, p.longitude, { heading: p.heading, follow: false })
            }
          >
            <Text style={styles.presetChipText}>{p.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.mapWrap}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          initialRegion={initialRegion}
          showsUserLocation={followGps}
          showsMyLocationButton={false}
          mapType={Platform.OS === 'ios' ? 'mutedStandard' : 'standard'}
          userInterfaceStyle="dark"
          onPress={onMapPress}
        >
          {queryLat != null && queryLng != null ? (
            <Marker
              coordinate={{ latitude: queryLat, longitude: queryLng }}
              title="查询位置"
              description={queryLabel}
              draggable
              anchor={{ x: 0.5, y: 0.5 }}
              onDragEnd={(e) => {
                const { latitude, longitude } = e.nativeEvent.coordinate
                moveQueryTo(latitude, longitude)
              }}
              tracksViewChanges={false}
            >
              <QueryPin />
            </Marker>
          ) : null}
          {pins.map((p) => (
            <Marker
              key={p.id}
              coordinate={{ latitude: p.lat, longitude: p.lng }}
              title={p.name}
              description={
                p.kind === 'forward'
                  ? '当前前方优先'
                  : p.distance_m != null
                    ? `${Math.round(p.distance_m)}m`
                    : '候选'
              }
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
            >
              <MapDot color={p.kind === 'forward' ? '#a78bfa' : '#fbbf24'} />
            </Marker>
          ))}
        </MapView>
        {loading ? (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : null}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        <Text style={styles.listTitle}>
          {queryLat != null && queryLng != null
            ? `${queryLabel} · ${queryLat.toFixed(4)}, ${queryLng.toFixed(4)} · `
            : ''}
          共 {pins.length} 处
          {forwardName ? ` · 前方优先：${forwardName}` : ''}
          {updatedAt
            ? ` · 更新 ${new Date(updatedAt).toLocaleTimeString('zh-CN', { hour12: false })}`
            : ''}
        </Text>
        {pins.length === 0 && !loading && !error ? (
          <Text style={styles.empty}>
            附近没有符合条件的景点 POI（可能已被当天去重过滤）。换个位置再刷新看看。
          </Text>
        ) : null}
        {pins.map((p) => (
          <View key={p.id} style={styles.row}>
            <View
              style={[
                styles.rowDot,
                { backgroundColor: p.kind === 'forward' ? '#a78bfa' : '#fbbf24' },
              ]}
            />
            <View style={styles.rowBody}>
              <Text style={styles.rowName}>{p.name}</Text>
              <Text style={styles.rowMeta}>
                {p.kind === 'forward' ? '前方优先 · ' : ''}
                {p.distance_m != null ? `${Math.round(p.distance_m)}m` : ''}
                {p.type ? ` · ${p.type.split(';')[0]}` : ''}
              </Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.lightBg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.screen,
    paddingVertical: 10,
  },
  back: { color: colors.accent, fontSize: 16, fontWeight: '600' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: colors.lightText },
  refresh: { color: colors.accent, fontSize: 15, fontWeight: '600' },
  hint: {
    marginHorizontal: spacing.screen,
    marginBottom: 8,
    fontSize: 12,
    lineHeight: 18,
    color: colors.lightMuted,
  },
  presetScroll: {
    maxHeight: 40,
    marginBottom: 8,
  },
  presetContent: {
    paddingHorizontal: spacing.screen,
    alignItems: 'center',
  },
  presetChip: {
    backgroundColor: '#f1f5f9',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginRight: 8,
  },
  presetChipActive: {
    backgroundColor: '#eff6ff',
    borderColor: colors.accent,
  },
  presetChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.lightMuted,
  },
  presetChipTextActive: {
    color: colors.accent,
  },
  mapWrap: {
    height: '42%',
    marginHorizontal: spacing.screen,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: {
    color: '#dc2626',
    marginHorizontal: spacing.screen,
    marginTop: 8,
    fontSize: 13,
  },
  list: { flex: 1, marginTop: 12 },
  listContent: { paddingHorizontal: spacing.screen, paddingBottom: 24 },
  listTitle: {
    fontSize: 13,
    color: colors.lightMuted,
    marginBottom: 10,
  },
  empty: { color: colors.lightMuted, lineHeight: 22, marginBottom: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e8edf4',
  },
  rowDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 5,
    marginRight: 10,
  },
  rowBody: { flex: 1 },
  rowName: { fontSize: 16, fontWeight: '600', color: colors.lightText },
  rowMeta: { marginTop: 4, fontSize: 13, color: colors.lightMuted },
  pin: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
  },
  pinCore: { width: 7, height: 7, borderRadius: 4 },
  queryPin: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 3,
    borderColor: '#fff',
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  queryPinCore: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#fff',
  },
})
