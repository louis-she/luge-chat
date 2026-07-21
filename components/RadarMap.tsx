import { Platform, StyleSheet, View } from 'react-native'
import MapView, { Circle, Marker } from 'react-native-maps'
import { useUserLocation } from '../lib/LocationContext'
import { DEV_DEFAULT_LOCATION } from '../lib/location'
import type { ProactiveMapOverlay } from '../lib/proactiveMapDev'
import { colors } from '../lib/theme'

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

function markerColor(kind: ProactiveMapOverlay['markers'][0]['kind']) {
  switch (kind) {
    case 'anchor':
      return '#38bdf8'
    case 'candidate':
      return '#fbbf24'
    case 'forward_hit':
      return '#a78bfa'
    case 'last_spoken':
      return '#4ade80'
    case 'last_skipped':
      return '#94a3b8'
    default:
      return '#fbbf24'
  }
}

function DevMapPin({ color }: { color: string }) {
  return (
    <View style={[styles.devPin, { borderColor: color }]}>
      <View style={[styles.devPinCore, { backgroundColor: color }]} />
    </View>
  )
}

export function RadarMap({
  proactiveOverlay,
}: {
  proactiveOverlay?: ProactiveMapOverlay | null
}) {
  const { coords, loading } = useUserLocation()
  const useNativeUserLocation = Platform.OS === 'ios'

  if (loading && !coords) {
    return <View style={styles.fallback} />
  }

  const latitude = coords?.latitude ?? DEV_DEFAULT_LOCATION.latitude
  const longitude = coords?.longitude ?? DEV_DEFAULT_LOCATION.longitude
  const overlay = proactiveOverlay ?? null

  return (
    <MapView
      style={StyleSheet.absoluteFill}
      initialRegion={{
        latitude,
        longitude,
        latitudeDelta: 0.015,
        longitudeDelta: 0.015,
      }}
      region={
        useNativeUserLocation
          ? undefined
          : {
              latitude,
              longitude,
              latitudeDelta: 0.015,
              longitudeDelta: 0.015,
            }
      }
      showsUserLocation={useNativeUserLocation}
      followsUserLocation={useNativeUserLocation}
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
    >
      {!useNativeUserLocation ? (
        <Marker
          key="user-location-dot"
          coordinate={{ latitude, longitude }}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={false}
        >
          <UserLocationDot />
        </Marker>
      ) : null}

      {overlay?.anchor && overlay.spanRadiusKm > 0 ? (
        <Circle
          center={overlay.anchor}
          radius={overlay.spanRadiusKm * 1000}
          strokeColor="rgba(56, 189, 248, 0.55)"
          fillColor="rgba(56, 189, 248, 0.08)"
          strokeWidth={1}
        />
      ) : null}

      {overlay?.markers.map((m) => (
        <Marker
          key={m.id}
          coordinate={{ latitude: m.lat, longitude: m.lng }}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={false}
          title={__DEV__ ? m.name : undefined}
          description={__DEV__ ? m.kind : undefined}
        >
          <DevMapPin color={markerColor(m.kind)} />
        </Marker>
      ))}
    </MapView>
  )
}

const styles = StyleSheet.create({
  fallback: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#0b1220',
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
  devPin: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
  },
  devPinCore: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
})
