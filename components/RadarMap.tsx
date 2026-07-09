import { Platform, StyleSheet, View } from 'react-native'
import MapView, { Marker } from 'react-native-maps'
import { useUserLocation } from '../lib/LocationContext'
import { DEV_DEFAULT_LOCATION } from '../lib/location'
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

export function RadarMap() {
  const { coords, loading } = useUserLocation()
  const useNativeUserLocation = Platform.OS === 'ios'

  if (loading && !coords) {
    return <View style={styles.fallback} />
  }

  const latitude = coords?.latitude ?? DEV_DEFAULT_LOCATION.latitude
  const longitude = coords?.longitude ?? DEV_DEFAULT_LOCATION.longitude
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
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(59, 130, 246, 0.22)',
  },
  dotCore: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.radarGlow,
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
})
