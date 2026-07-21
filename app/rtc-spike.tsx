import { useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { SUPABASE_URL } from '../lib/config'
import {
  ensureLocationPermission,
  peekUserCoords,
  readUserCoords,
} from '../lib/location'
import { getSpeechRecognitionModule } from '../lib/speechRecognition'
import { colors, spacing } from '../lib/theme'
import { volcRtcClient } from '../lib/volcRtcClient'
import {
  createVolcRtcSession,
  reportVolcVoiceLocation,
  startVolcVoiceChat,
  stopVolcVoiceChat,
  type VolcRtcSession,
} from '../lib/volcVoiceChat'

/** 通话中向路鸽后端同步 GPS 的间隔（FC 查周边读会话最新坐标） */
const GPS_REPORT_INTERVAL_MS = 3_000

/**
 * 方案甲 V3 spike：RTC + StartVoiceChat + GPS 上报 + get_nearby_landmarks FC
 */
export default function RtcSpikeScreen() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [inRoom, setInRoom] = useState(false)
  const [session, setSession] = useState<VolcRtcSession | null>(null)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [gpsLine, setGpsLine] = useState<string>('—')
  const [logs, setLogs] = useState<string[]>([])
  const taskIdRef = useRef<string | null>(null)
  const sessionRef = useRef<VolcRtcSession | null>(null)
  const locTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const locLoggedOnceRef = useRef(false)
  const lastLoggedGpsRef = useRef<{ lat: number; lng: number } | null>(null)

  const pushLog = (line: string) => {
    const stamp = new Date().toLocaleTimeString('zh-CN', { hour12: false })
    setLogs((prev) => [`${stamp} ${line}`, ...prev].slice(0, 80))
  }

  const stopLocLoop = () => {
    if (locTimerRef.current) {
      clearInterval(locTimerRef.current)
      locTimerRef.current = null
    }
  }

  const pushLocationOnce = async (
    s: VolcRtcSession,
    t: string,
    opts?: { announce?: boolean },
  ) => {
    const ok = await ensureLocationPermission()
    if (!ok) {
      if (opts?.announce !== false && !locLoggedOnceRef.current) {
        pushLog('无定位权限，FC 查周边会失败')
        locLoggedOnceRef.current = true
      }
      return
    }
    const coords = peekUserCoords() ?? (await readUserCoords())
    setGpsLine(
      `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}` +
        (coords.heading != null ? ` h=${Math.round(coords.heading)}°` : '') +
        ` (${coords.source})`,
    )
    await reportVolcVoiceLocation({
      roomId: s.room_id,
      taskId: t,
      userId: s.user_id,
      lat: coords.latitude,
      lng: coords.longitude,
      heading: coords.heading,
    })

    const prev = lastLoggedGpsRef.current
    const moved =
      !prev ||
      Math.abs(prev.lat - coords.latitude) > 0.0003 ||
      Math.abs(prev.lng - coords.longitude) > 0.0003
    if (opts?.announce || !locLoggedOnceRef.current || moved) {
      pushLog(
        `GPS 已上报 ${coords.latitude.toFixed(5)},${coords.longitude.toFixed(5)}`,
      )
      locLoggedOnceRef.current = true
      lastLoggedGpsRef.current = {
        lat: coords.latitude,
        lng: coords.longitude,
      }
    }
  }

  const startLocLoop = (s: VolcRtcSession, t: string) => {
    stopLocLoop()
    locLoggedOnceRef.current = false
    lastLoggedGpsRef.current = null
    void pushLocationOnce(s, t, { announce: true }).catch((e) => {
      pushLog(`GPS 上报失败: ${e instanceof Error ? e.message : String(e)}`)
    })
    // 后台续报位置，成功时默认不刷日志（坐标明显变化除外）
    locTimerRef.current = setInterval(() => {
      void pushLocationOnce(s, t, { announce: false }).catch(() => {
        /* 周期性失败不刷屏 */
      })
    }, GPS_REPORT_INTERVAL_MS)
  }

  useEffect(() => {
    const off = volcRtcClient.onStatus(pushLog)
    return () => {
      off()
      stopLocLoop()
      void (async () => {
        const t = taskIdRef.current
        const s = sessionRef.current
        if (t && s) await stopVolcVoiceChat({ roomId: s.room_id, taskId: t })
        await volcRtcClient.leave()
      })()
    }
  }, [])

  const join = async () => {
    if (busy) return
    setBusy(true)
    try {
      const mod = getSpeechRecognitionModule()
      if (mod?.requestPermissionsAsync) {
        const perm = await mod.requestPermissionsAsync()
        if (!perm.granted) {
          throw new Error('需要麦克风权限才能进 RTC 房')
        }
      }

      pushLog(`请求 session… → ${SUPABASE_URL}`)
      const s = await createVolcRtcSession()
      setSession(s)
      sessionRef.current = s
      pushLog(`session OK room=${s.room_id}`)

      pushLog('开始 joinRoom…')
      await volcRtcClient.joinAudioOnly(s)
      setInRoom(true)
      pushLog('RTC 进房成功，启动 VoiceChat…')

      const task = await startVolcVoiceChat({
        roomId: s.room_id,
        userId: s.user_id,
      })
      setTaskId(task.task_id)
      taskIdRef.current = task.task_id
      pushLog(`VoiceChat 已启动 task=${task.task_id}`)
      startLocLoop(s, task.task_id)
      pushLog('可问「我旁边有什么」测 FC。说完停约 1 秒等回复。')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      pushLog(`失败: ${msg}`)
      stopLocLoop()
      try {
        await volcRtcClient.leave()
      } catch {
        /* ignore */
      }
      setInRoom(false)
      setTaskId(null)
      taskIdRef.current = null
    } finally {
      setBusy(false)
    }
  }

  const leave = async () => {
    if (busy) return
    setBusy(true)
    try {
      stopLocLoop()
      const t = taskIdRef.current
      const s = sessionRef.current
      if (t && s) {
        pushLog('StopVoiceChat…')
        await stopVolcVoiceChat({ roomId: s.room_id, taskId: t })
      }
      await volcRtcClient.leave()
      setInRoom(false)
      setTaskId(null)
      taskIdRef.current = null
      setGpsLine('—')
      locLoggedOnceRef.current = false
      lastLoggedGpsRef.current = null
      pushLog('已离房')
    } finally {
      setBusy(false)
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.back}>← 返回</Text>
        </Pressable>
        <Text style={styles.title}>RTC 语音通话测试</Text>
        <Text style={styles.hint}>
          V3 调试页（雷达真机已默认走 RTC）。此处仍可单独验收 FC / GPS。
        </Text>
      </View>

      <View style={styles.actions}>
        <Pressable
          style={[styles.btn, styles.btnPrimary, (busy || inRoom) && styles.btnDisabled]}
          disabled={busy || inRoom}
          onPress={() => void join()}
        >
          {busy && !inRoom ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.btnText}>开始通话</Text>
          )}
        </Pressable>
        <Pressable
          style={[styles.btn, styles.btnDanger, (busy || !inRoom) && styles.btnDisabled]}
          disabled={busy || !inRoom}
          onPress={() => void leave()}
        >
          <Text style={styles.btnText}>结束</Text>
        </Pressable>
      </View>

      {session ? (
        <View style={styles.meta}>
          <Text style={styles.metaLine}>room: {session.room_id}</Text>
          <Text style={styles.metaLine}>user: {session.user_id}</Text>
          <Text style={styles.metaLine}>task: {taskId ?? '—'}</Text>
          <Text style={styles.metaLine}>gps: {gpsLine}</Text>
          <Text style={styles.metaLine}>
            状态: {inRoom ? (taskId ? '通话中（AI 已接入）' : '在房，AI 启动中') : '未进房'}
          </Text>
        </View>
      ) : null}

      <ScrollView style={styles.logBox} contentContainerStyle={styles.logInner}>
        {logs.length === 0 ? (
          <Text style={styles.logEmpty}>日志为空</Text>
        ) : (
          logs.map((line, i) => (
            <Text key={`${i}-${line.slice(0, 24)}`} style={styles.logLine}>
              {line}
            </Text>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.lightBg },
  header: { paddingHorizontal: spacing.screen, paddingTop: 8, paddingBottom: 12 },
  back: { color: colors.accent, fontSize: 16, fontWeight: '600', marginBottom: 8 },
  title: { fontSize: 24, fontWeight: '700', color: colors.lightText },
  hint: { marginTop: 8, color: colors.lightMuted, fontSize: 13, lineHeight: 18 },
  actions: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: spacing.screen,
    marginBottom: 12,
  },
  btn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnPrimary: { backgroundColor: colors.accent },
  btnDanger: { backgroundColor: '#111827' },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  meta: {
    marginHorizontal: spacing.screen,
    marginBottom: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.lightCard,
    borderWidth: 1,
    borderColor: '#e8edf4',
  },
  metaLine: {
    fontSize: 12,
    color: colors.lightMuted,
    fontFamily: 'Menlo',
    marginBottom: 4,
  },
  logBox: { flex: 1, marginHorizontal: spacing.screen, marginBottom: 12 },
  logInner: { padding: 12, backgroundColor: '#0f172a', borderRadius: 12 },
  logEmpty: { color: '#64748b', fontSize: 12 },
  logLine: {
    color: '#e2e8f0',
    fontSize: 11,
    fontFamily: 'Menlo',
    marginBottom: 6,
    lineHeight: 16,
  },
})
