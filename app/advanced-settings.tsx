import { useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useProactiveGuideSettings } from '../lib/ProactiveGuideContext'
import {
  SPAN_PRESETS,
  SPEAK_LENGTH_OPTIONS,
  type ProactiveSpeakLength,
} from '../lib/proactiveSettings'
import { clearProactiveSpokenToday, loadSpokenPoiKeysToday } from '../lib/proactiveSpoken'
import { colors, spacing } from '../lib/theme'

function NumField({
  label,
  hint,
  value,
  onCommit,
  suffix,
}: {
  label: string
  hint?: string
  value: number
  onCommit: (n: number) => void
  suffix: string
}) {
  const [text, setText] = useState(String(value))
  useEffect(() => {
    setText(String(value))
  }, [value])
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
      <View style={styles.fieldRow}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          keyboardType="decimal-pad"
          onBlur={() => {
            const n = Number(text)
            if (Number.isFinite(n)) onCommit(n)
            else setText(String(value))
          }}
        />
        <Text style={styles.suffix}>{suffix}</Text>
      </View>
    </View>
  )
}

export default function AdvancedSettingsScreen() {
  const router = useRouter()
  const { settings, updateSettings, bumpAnchorNonce } = useProactiveGuideSettings()
  const [spokenCount, setSpokenCount] = useState<number | null>(null)

  const refreshSpoken = useCallback(async () => {
    const keys = await loadSpokenPoiKeysToday()
    setSpokenCount(keys.length)
  }, [])

  useEffect(() => {
    void refreshSpoken()
  }, [refreshSpoken])

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.back}>← 返回</Text>
        </Pressable>
        <Text style={styles.headerTitle}>高级设置</Text>
        <View style={{ width: 48 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.banner}>
          路测 / 调试用。改完立即生效（无需重编译）。正式默认仍是 20km / 10 分 / 15 分 / 短口播。
        </Text>

        <Text style={styles.section}>门槛快捷预设</Text>
        <View style={styles.presetRow}>
          {SPAN_PRESETS.map((p) => (
            <Pressable
              key={p.id}
              style={styles.presetBtn}
              onPress={() =>
                void updateSettings({
                  minDistanceKm: p.minDistanceKm,
                  minCheckIntervalMin: p.minCheckIntervalMin,
                  minSpeakIntervalMin: p.minSpeakIntervalMin,
                })
              }
            >
              <Text style={styles.presetLabel}>{p.label}</Text>
              <Text style={styles.presetDesc}>{p.desc}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.section}>主动讲解触发门槛</Text>
        <NumField
          label="位移门槛"
          hint="距上次查询锚点至少移动这么远才允许再查"
          value={settings.minDistanceKm}
          suffix="km"
          onCommit={(n) => void updateSettings({ minDistanceKm: n })}
        />
        <NumField
          label="查询间隔"
          hint="两次地理查询之间至少隔这么久"
          value={settings.minCheckIntervalMin}
          suffix="分钟"
          onCommit={(n) => void updateSettings({ minCheckIntervalMin: n })}
        />
        <NumField
          label="开口间隔"
          hint="两次真正播报之间至少隔这么久"
          value={settings.minSpeakIntervalMin}
          suffix="分钟"
          onCommit={(n) => void updateSettings({ minSpeakIntervalMin: n })}
        />

        <Text style={styles.section}>口播篇幅</Text>
        <Text style={styles.sectionHint}>对应主动讲解 system 里的字数要求</Text>
        <View style={styles.lengthRow}>
          {SPEAK_LENGTH_OPTIONS.map((opt) => {
            const selected = settings.speakLength === opt.value
            return (
              <Pressable
                key={opt.value}
                style={[styles.lengthBtn, selected && styles.lengthBtnOn]}
                onPress={() => void updateSettings({ speakLength: opt.value as ProactiveSpeakLength })}
              >
                <Text style={[styles.lengthLabel, selected && styles.lengthLabelOn]}>
                  {opt.label}
                </Text>
                <Text style={styles.lengthDesc}>{opt.desc}</Text>
              </Pressable>
            )
          })}
        </View>

        <Text style={styles.section}>风景名胜搜索半径</Text>
        <NumField
          label="周边半径"
          hint="主动讲解 / 预览地图拉候选 POI 的范围"
          value={settings.scenicRadiusKm}
          suffix="km"
          onCommit={(n) => void updateSettings({ scenicRadiusKm: n })}
        />

        <Text style={styles.section}>路测工具</Text>
        <Pressable
          style={styles.toolBtn}
          onPress={() => {
            void bumpAnchorNonce().then(() => {
              Alert.alert('已重置', '下次 GPS 更新会重新建立查询锚点')
            })
          }}
        >
          <Text style={styles.toolTitle}>重置查询锚点</Text>
          <Text style={styles.toolDesc}>不改门槛，只把「上次查过的位置」清掉</Text>
        </Pressable>

        <Pressable
          style={styles.toolBtn}
          onPress={() => {
            void (async () => {
              await clearProactiveSpokenToday()
              await refreshSpoken()
              Alert.alert('已清空', '今天已讲过的景点可以再讲')
            })()
          }}
        >
          <Text style={styles.toolTitle}>清空「今天已讲」</Text>
          <Text style={styles.toolDesc}>
            当天去重列表
            {spokenCount != null ? `（当前 ${spokenCount} 个键）` : ''}
          </Text>
        </Pressable>

        <Pressable style={styles.linkBtn} onPress={() => void refreshSpoken()}>
          <Text style={styles.linkText}>刷新已讲计数</Text>
        </Pressable>
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
  scroll: { padding: spacing.screen, paddingBottom: 40 },
  banner: {
    backgroundColor: '#fff7ed',
    borderColor: '#fed7aa',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 13,
    lineHeight: 19,
    color: '#9a3412',
    marginBottom: 18,
  },
  section: {
    marginTop: 8,
    marginBottom: 8,
    fontSize: 15,
    fontWeight: '700',
    color: colors.lightText,
  },
  sectionHint: {
    marginTop: -4,
    marginBottom: 8,
    fontSize: 12,
    color: colors.lightMuted,
  },
  presetRow: { gap: 8, marginBottom: 12 },
  presetBtn: {
    backgroundColor: colors.lightCard,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e8edf4',
    padding: 12,
  },
  presetLabel: { fontSize: 15, fontWeight: '700', color: colors.lightText },
  presetDesc: { marginTop: 4, fontSize: 12, color: colors.lightMuted },
  field: { marginBottom: 14 },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: colors.lightText },
  fieldHint: { marginTop: 4, fontSize: 12, color: colors.lightMuted, lineHeight: 17 },
  fieldRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 8 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.lightText,
    backgroundColor: '#fff',
  },
  suffix: { width: 44, fontSize: 14, color: colors.lightMuted },
  lengthRow: { gap: 8, marginBottom: 8 },
  lengthBtn: {
    borderWidth: 1,
    borderColor: '#e8edf4',
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#f8fafc',
  },
  lengthBtnOn: {
    borderColor: 'rgba(96, 165, 250, 0.55)',
    backgroundColor: 'rgba(96, 165, 250, 0.1)',
  },
  lengthLabel: { fontSize: 15, fontWeight: '700', color: colors.lightText },
  lengthLabelOn: { color: '#1d4ed8' },
  lengthDesc: { marginTop: 4, fontSize: 12, color: colors.lightMuted },
  toolBtn: {
    backgroundColor: colors.lightCard,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e8edf4',
    padding: 14,
    marginBottom: 10,
  },
  toolTitle: { fontSize: 15, fontWeight: '700', color: colors.lightText },
  toolDesc: { marginTop: 4, fontSize: 12, color: colors.lightMuted },
  linkBtn: { paddingVertical: 10, alignItems: 'center' },
  linkText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
})
