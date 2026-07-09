import { Ionicons } from '@expo/vector-icons'
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native'
import { useProactiveGuideSettings } from '../lib/ProactiveGuideContext'
import { PROACTIVE_RATING_OPTIONS } from '../lib/proactiveSettings'
import { colors } from '../lib/theme'

export function ProactiveGuideSettings() {
  const { settings, setEnabled, setMinRating } = useProactiveGuideSettings()

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text style={styles.title}>主动讲解</Text>
          <Text style={styles.desc}>
            开车时路鸽偶尔主动开口；每次检查消耗 1 次问路额度
          </Text>
        </View>
        <Switch
          value={settings.enabled}
          onValueChange={(v) => void setEnabled(v)}
          trackColor={{ false: '#cbd5e1', true: '#93c5fd' }}
          thumbColor={settings.enabled ? colors.accent : '#f8fafc'}
        />
      </View>

      {settings.enabled ? (
        <>
          <Text style={styles.sectionLabel}>景点评分门槛</Text>
          <Text style={styles.sectionHint}>
            仅对高德返回了评分的景点类 POI 生效；河流、山川等通常无评分，不受此限制
          </Text>
          <View style={styles.list}>
            {PROACTIVE_RATING_OPTIONS.map((opt) => {
              const selected = settings.minRating === opt.value
              return (
                <Pressable
                  key={String(opt.value)}
                  onPress={() => void setMinRating(opt.value)}
                  style={({ pressed }) => [
                    styles.row,
                    selected && styles.rowSelected,
                    pressed && styles.rowPressed,
                  ]}
                >
                  <View style={styles.rowText}>
                    <Text style={[styles.rowLabel, selected && styles.rowLabelSelected]}>
                      {opt.label}
                    </Text>
                    <Text style={styles.rowDesc}>{opt.desc}</Text>
                  </View>
                  {selected ? (
                    <Ionicons name="checkmark-circle" size={22} color={colors.accent} />
                  ) : (
                    <View style={styles.radio} />
                  )}
                </Pressable>
              )
            })}
          </View>
        </>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.lightCard,
    borderRadius: 18,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e8edf4',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.lightText,
  },
  desc: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 19,
    color: colors.lightMuted,
  },
  sectionLabel: {
    marginTop: 18,
    fontSize: 14,
    fontWeight: '700',
    color: colors.lightText,
  },
  sectionHint: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 18,
    color: colors.lightMuted,
  },
  list: {
    marginTop: 10,
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e8edf4',
    backgroundColor: '#f8fafc',
  },
  rowSelected: {
    borderColor: 'rgba(96, 165, 250, 0.45)',
    backgroundColor: 'rgba(96, 165, 250, 0.08)',
  },
  rowPressed: {
    opacity: 0.9,
  },
  rowText: {
    flex: 1,
    paddingRight: 8,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.lightText,
  },
  rowLabelSelected: {
    color: '#1d4ed8',
  },
  rowDesc: {
    marginTop: 3,
    fontSize: 12,
    lineHeight: 17,
    color: colors.lightMuted,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#cbd5e1',
  },
})
