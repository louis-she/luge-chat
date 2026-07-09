import { Platform, StyleSheet, Text, View } from 'react-native'
import MapView, { Marker } from 'react-native-maps'
import type { UserFootprint } from '../lib/footprints'
import { colors } from '../lib/theme'

type Props = {
  items: UserFootprint[]
  onSelect: (item: UserFootprint) => void
}

type MappableFootprint = UserFootprint & { lat: number; lng: number }

function FootprintDot({ active }: { active: boolean }) {
  return (
    <View style={styles.dotOuter} pointerEvents="none">
      <View style={[styles.dotHalo, active && styles.dotHaloActive]} />
      <View style={[styles.dotCore, active && styles.dotCoreActive]} />
    </View>
  )
}

function getMappableItems(items: UserFootprint[]): MappableFootprint[] {
  return items.filter(
    (item): item is MappableFootprint => item.lat != null && item.lng != null,
  )
}

function buildRegion(points: MappableFootprint[]) {
  if (!points.length) {
    return {
      latitude: 30.5728,
      longitude: 104.0668,
      latitudeDelta: 8,
      longitudeDelta: 8,
    }
  }

  const latest = points[0]
  if (latest) {
    return {
      latitude: latest.lat,
      longitude: latest.lng,
      latitudeDelta: 0.18,
      longitudeDelta: 0.18,
    }
  }

  const lats = points.map((p) => p.lat)
  const lngs = points.map((p) => p.lng)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)

  const latitude = (minLat + maxLat) / 2
  const longitude = (minLng + maxLng) / 2
  const latitudeDelta = Math.max((maxLat - minLat) * 1.6, 0.08)
  const longitudeDelta = Math.max((maxLng - minLng) * 1.6, 0.08)

  return {
    latitude,
    longitude,
    latitudeDelta,
    longitudeDelta,
  }
}

export function FootprintsOverviewMap({ items, onSelect }: Props) {
  const points = getMappableItems(items)
  const region = buildRegion(points)

  return (
    <View style={styles.wrap}>
      <View style={styles.mapClip}>
        <MapView
          style={styles.map}
          initialRegion={region}
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
          {points.map((item, index) => (
            <Marker
              key={item.id}
              coordinate={{ latitude: item.lat, longitude: item.lng }}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
              onPress={() => onSelect(item)}
            >
              <FootprintDot active={index === 0} />
            </Marker>
          ))}
        </MapView>
      </View>

      <View style={styles.footer}>
        {points.length > 0 ? (
          <Text style={styles.footerTitle}>地图上共 {points.length} 个可定位足迹，可手动拖动查看</Text>
        ) : (
          <Text style={styles.empty}>已有足迹还没拿到坐标，继续问路后会慢慢点亮地图</Text>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#d9e3f0',
    marginTop: 16,
    backgroundColor: colors.lightCard,
  },
  mapClip: {
    overflow: 'hidden',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    backgroundColor: '#dbeafe',
  },
  map: {
    width: '100%',
    height: 220,
  },
  footer: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(148, 163, 184, 0.16)',
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
  },
  footerTitle: {
    color: '#dbeafe',
    fontSize: 13,
    fontWeight: '600',
  },
  empty: {
    color: '#94a3b8',
    fontSize: 12,
    lineHeight: 18,
  },
  dotOuter: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotHalo: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(59, 130, 246, 0.24)',
  },
  dotHaloActive: {
    backgroundColor: 'rgba(248, 250, 252, 0.34)',
  },
  dotCore: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: '#fff',
  },
  dotCoreActive: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#f8fafc',
    borderColor: colors.accent,
  },
})
