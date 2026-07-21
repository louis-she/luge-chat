import { StyleSheet, Switch, Text, View } from 'react-native'
import { useProactiveGuideSettings } from '../lib/ProactiveGuideContext'
import { colors } from '../lib/theme'

export function ProactiveGuideSettings() {
  const { settings, setEnabled } = useProactiveGuideSettings()

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text style={styles.title}>主动讲解</Text>
          <Text style={styles.desc}>
            开车时路鸽偶尔主动开口；每次检查消耗 1 次问路额度。同一景点当天只讲一次。
          </Text>
        </View>
        <Switch
          value={settings.enabled}
          onValueChange={(v) => void setEnabled(v)}
          trackColor={{ false: '#cbd5e1', true: '#93c5fd' }}
          thumbColor={settings.enabled ? colors.accent : '#f8fafc'}
        />
      </View>
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
})
