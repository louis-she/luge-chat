import { useEffect, useState } from 'react'
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { DEV_LOCATION_PRESETS } from '../lib/devLocation'
import { isDevSimulator } from '../lib/isDevSimulator'
import { useUserLocation } from '../lib/LocationContext'
import { DEV_DEFAULT_LOCATION } from '../lib/location'
import { colors, spacing } from '../lib/theme'

function formatCoord(n: number) {
  return n.toFixed(4)
}

export function DevLocationPanel() {
  if (!isDevSimulator()) return null

  const insets = useSafeAreaInsets()
  const { coords, manualLocation, setManualLocation, clearManualLocation } = useUserLocation()
  const [open, setOpen] = useState(false)
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [heading, setHeading] = useState('')

  useEffect(() => {
    if (!open) return
    const base = manualLocation ?? coords ?? DEV_DEFAULT_LOCATION
    setLat(String(base.latitude))
    setLng(String(base.longitude))
    setHeading(String('heading' in base && base.heading != null ? base.heading : 70))
  }, [open, manualLocation, coords])

  const applyCustom = async () => {
    const latitude = Number(lat)
    const longitude = Number(lng)
    const h = Number(heading)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return
    await setManualLocation({
      latitude,
      longitude,
      heading: Number.isFinite(h) ? h : 0,
      label: '自定义',
    })
    setOpen(false)
  }

  const applyPreset = async (preset: (typeof DEV_LOCATION_PRESETS)[number]) => {
    await setManualLocation({
      latitude: preset.latitude,
      longitude: preset.longitude,
      heading: preset.heading,
      label: preset.label,
    })
    setOpen(false)
  }

  const label = manualLocation?.label ?? (manualLocation ? '手动坐标' : 'GPS')

  return (
    <>
      <Pressable
        style={[styles.chip, { top: insets.top + 8 }]}
        onPress={() => setOpen(true)}
      >
        <Text style={styles.chipText}>
          {manualLocation ? '📍' : '🛰'} {label}
        </Text>
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={styles.title}>开发 · 测试位置</Text>
            <Text style={styles.hint}>
              开启手动位置后，地图与问路 API 均使用此处坐标，不再读取 GPS。
            </Text>

            <Text style={styles.section}>快捷地点</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presetRow}>
              {DEV_LOCATION_PRESETS.map((preset) => (
                <Pressable
                  key={preset.id}
                  style={styles.presetBtn}
                  onPress={() => applyPreset(preset)}
                >
                  <Text style={styles.presetText}>{preset.label}</Text>
                </Pressable>
              ))}
            </ScrollView>

            <Text style={styles.section}>自定义坐标</Text>
            <View style={styles.fieldRow}>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>纬度</Text>
                <TextInput
                  style={styles.input}
                  value={lat}
                  onChangeText={setLat}
                  keyboardType="decimal-pad"
                  placeholder="30.6568"
                  placeholderTextColor="#64748b"
                />
              </View>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>经度</Text>
                <TextInput
                  style={styles.input}
                  value={lng}
                  onChangeText={setLng}
                  keyboardType="decimal-pad"
                  placeholder="104.0652"
                  placeholderTextColor="#64748b"
                />
              </View>
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>朝向（度，可选）</Text>
              <TextInput
                style={styles.input}
                value={heading}
                onChangeText={setHeading}
                keyboardType="number-pad"
                placeholder="70"
                placeholderTextColor="#64748b"
              />
            </View>

            {coords ? (
              <Text style={styles.current}>
                当前：{formatCoord(coords.latitude)}, {formatCoord(coords.longitude)}
                {coords.heading != null
                  ? ` · ${Math.round(coords.heading)}° (${coords.headingSource ?? '?'}, ${(coords.headingConfidence * 100).toFixed(0)}%)`
                  : ' · 无朝向'}
                {coords.showArrow ? ' · 箭头' : ' · 蓝点'}
              </Text>
            ) : null}

            <Pressable style={styles.primaryBtn} onPress={applyCustom}>
              <Text style={styles.primaryText}>应用手动位置</Text>
            </Pressable>

            {manualLocation ? (
              <Pressable
                style={styles.secondaryBtn}
                onPress={async () => {
                  await clearManualLocation()
                  setOpen(false)
                }}
              >
                <Text style={styles.secondaryText}>恢复 GPS 定位</Text>
              </Pressable>
            ) : null}

            <Pressable style={styles.closeBtn} onPress={() => setOpen(false)}>
              <Text style={styles.closeText}>关闭</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  chip: {
    position: 'absolute',
    left: 12,
    zIndex: 30,
    backgroundColor: 'rgba(15, 23, 42, 0.82)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(96, 165, 250, 0.35)',
  },
  chipText: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '600',
  },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  sheet: {
    backgroundColor: colors.lightCard,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: spacing.screen,
    paddingTop: 18,
    maxHeight: '88%',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.lightText,
    marginBottom: 6,
  },
  hint: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.lightMuted,
    marginBottom: 14,
  },
  section: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.lightText,
    marginBottom: 8,
    marginTop: 4,
  },
  presetRow: {
    marginBottom: 12,
  },
  presetBtn: {
    backgroundColor: '#eff6ff',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
  },
  presetText: {
    color: '#1d4ed8',
    fontSize: 13,
    fontWeight: '600',
  },
  fieldRow: {
    flexDirection: 'row',
    gap: 10,
  },
  field: {
    flex: 1,
    marginBottom: 10,
  },
  fieldLabel: {
    fontSize: 12,
    color: colors.lightMuted,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.lightText,
    backgroundColor: '#f9fafb',
  },
  current: {
    fontSize: 12,
    color: colors.lightMuted,
    marginBottom: 12,
  },
  primaryBtn: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryBtn: {
    marginTop: 10,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  secondaryText: {
    color: colors.lightText,
    fontSize: 15,
    fontWeight: '600',
  },
  closeBtn: {
    marginTop: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  closeText: {
    color: colors.lightMuted,
    fontSize: 14,
  },
})
