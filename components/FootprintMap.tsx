import { Platform, StyleSheet, Text, View } from 'react-native'
import MapView, { Marker } from 'react-native-maps'
import { colors } from '../lib/theme'

type Props = {
  latitude: number
  longitude: number
  label?: string
}

function FootprintPin() {
  return (
    <View style={styles.pinOuter} pointerEvents="none">
      <View style={styles.pinHalo} />
      <View style={styles.pinCore} />
    </View>
  )
}

export function FootprintMap({ latitude, longitude, label }: Props) {
  return (
    <View style={styles.wrap}>
      <MapView
        style={styles.map}
        initialRegion={{
          latitude,
          longitude,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        }}
        scrollEnabled
        zoomEnabled
        rotateEnabled={false}
        pitchEnabled={false}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass={false}
        showsScale={false}
        mapType={Platform.OS === 'ios' ? 'mutedStandard' : 'standard'}
        userInterfaceStyle="light"
      >
        <Marker
          coordinate={{ latitude, longitude }}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={false}
        >
          <FootprintPin />
        </Marker>
      </MapView>
      {label ? (
        <View style={styles.coordBar}>
          <Text style={styles.coordText}>{label}</Text>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e8edf4',
    backgroundColor: '#e2e8f0',
  },
  map: {
    width: '100%',
    height: 200,
  },
  coordBar: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.lightCard,
    borderTopWidth: 1,
    borderTopColor: '#e8edf4',
  },
  coordText: {
    fontSize: 12,
    color: colors.lightMuted,
    fontVariant: ['tabular-nums'],
  },
  pinOuter: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinHalo: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(59, 130, 246, 0.22)',
  },
  pinCore: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: '#fff',
  },
})
