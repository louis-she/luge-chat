import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { DevLocationPanel } from '../../components/DevLocationPanel'
import { LugeCompanion } from '../../components/LugeCompanion'
import { RadarMap, type SpeakFocusPoi } from '../../components/RadarMap'
import { StartLugeButton } from '../../components/StartLugeButton'
import { loadSession } from '../../lib/auth'
import {
  EMPTY_PROACTIVE_MAP_OVERLAY,
  mergeProactiveDevOverlay,
  type ProactiveDevOverlay,
  type ProactiveMapMarker,
  type ProactiveMapOverlay,
} from '../../lib/proactiveMapDev'
import { fetchProactivePreviewPois } from '../../lib/proactivePreview'
import { peekScenicLibrary, clearScenicLibrary } from '../../lib/scenicAroundCache'
import { settingsToSpanConfig, scenicLibraryRadiusKm } from '../../lib/proactiveSettings'
import { haversineKm } from '../../lib/proactiveSpan'
import { useLuge } from '../../lib/LugeContext'
import { useUserLocation } from '../../lib/LocationContext'
import { useQuota } from '../../lib/QuotaContext'
import { formatQuotaLabel } from '../../lib/quota'
import { useProactiveGuide } from '../../lib/useProactiveGuide'
import { useProactiveGuideSettings } from '../../lib/ProactiveGuideContext'
import { LugeChatQuotaError } from '../../lib/lugeChat'
import { isDevSimulator } from '../../lib/isDevSimulator'
import { useVoiceInteraction } from '../../lib/useVoiceInteraction'

export default function RadarScreen() {
  const deviceMode = !isDevSimulator()
  const [startError, setStartError] = useState<string | null>(null)

  const {
    isActive,
    isThinking,
    isSpeaking,
    speechPhase,
    conversationReady,
    startLuge,
    stopLuge,
    say,
    runWhileThinking,
    recordRound,
    getConversation,
  } = useLuge()
  const { coords, setManualLocation } = useUserLocation()
  const { settings: proactiveSettings, ready: proactiveReady } = useProactiveGuideSettings()
  const proactiveSpan = settingsToSpanConfig(proactiveSettings)
  const { quota, refreshQuota, showExhausted } = useQuota()
  const [proactiveMapOverlay, setProactiveMapOverlay] = useState<ProactiveMapOverlay>(
    () => ({
      ...EMPTY_PROACTIVE_MAP_OVERLAY,
      spanRadiusKm: 20,
    }),
  )
  const proactiveCandidatesRef = useRef<ProactiveMapMarker[]>([])
  const [speakFocus, setSpeakFocus] = useState<SpeakFocusPoi | null>(null)

  const activateSpeakFocus = useCallback((poi: SpeakFocusPoi) => {
    setSpeakFocus(poi)
  }, [])

  const deactivateSpeakFocus = useCallback(() => {
    setSpeakFocus(null)
  }, [])

  useEffect(() => {
    if (isActive) return
    setSpeakFocus(null)
  }, [isActive])

  useEffect(() => {
    if (isActive) return
    setStartError(null)
  }, [isActive])

  const handleStartLuge = useCallback(async () => {
    setStartError(null)
    if (quota && !quota.can_ask) {
      showExhausted({
        code: 'QUOTA_EXHAUSTED',
        tier: quota.tier,
        register_bonus: quota.register_bonus,
      })
      return
    }
    startLuge({ skipGreeting: true })
  }, [startLuge, quota, showExhausted])

  const handleStopLuge = useCallback(() => {
    void refreshQuota()
    stopLuge()
  }, [stopLuge, refreshQuota])

  const voice = useVoiceInteraction({
    active: isActive,
    coords,
    say,
    recordRound,
    getConversation,
    onError: (message) => {
      setStartError(message)
      if (__DEV__) console.warn('[voice ask]', message)
    },
    onQuotaExhausted: (e) => {
      setStartError(null)
      showExhausted(e.payload)
    },
  })

  const devVoiceStatus = !isActive
    ? '话筒关闭'
    : isSpeaking
      ? speechPhase === 'preparing'
        ? '准备语音'
        : '正在播报'
      : voice.state === 'listening' || voice.state === 'follow_up'
        ? '等待用户讲话'
        : voice.state === 'thinking' || isThinking
          ? '正在思考'
          : '话筒关闭'

  const handleProactiveSpeak = useCallback(
    async (
      text: string,
      accessToken: string | null,
      meta?: {
        topicPoi?: string | null
        lat?: number | null
        lng?: number | null
      },
    ) => {
      const focusPoi =
        meta?.lat != null &&
        meta?.lng != null &&
        Number.isFinite(meta.lat) &&
        Number.isFinite(meta.lng)
          ? {
              lat: meta.lat,
              lng: meta.lng,
              name: (meta.topicPoi?.trim() || '正在讲解').slice(0, 40),
            }
          : null
      let focusActivated = false
      try {
        await say(text, accessToken, {
          recordProactive: true,
          onPhase: (phase) => {
            if (phase !== 'playing' || focusActivated || !focusPoi) return
            focusActivated = true
            activateSpeakFocus({ ...focusPoi, at: Date.now() })
          },
        })
      } finally {
        if (focusActivated) deactivateSpeakFocus()
      }
      if (isActive) await voice.startFollowUp()
    },
    [say, isActive, voice.startFollowUp, activateSpeakFocus, deactivateSpeakFocus],
  )

  const handleProactiveDevOverlay = useCallback((patch: ProactiveDevOverlay) => {
    if (!__DEV__) return
    setProactiveMapOverlay((prev) =>
      mergeProactiveDevOverlay(prev, patch, proactiveCandidatesRef.current),
    )
  }, [])

  const syncYellowDotsFromLibrary = useCallback(() => {
    if (!__DEV__) return
    const lib = peekScenicLibrary()
    if (!lib?.pois?.length) return
    const cands: ProactiveMapMarker[] = lib.pois.slice(0, 60).map((c, i) => ({
      id: `cand-${c.amap_poi_id ?? i}-${c.name.slice(0, 8)}`,
      lat: c.lat,
      lng: c.lng,
      name: c.name,
      kind: 'candidate' as const,
      type: c.type,
    }))
    proactiveCandidatesRef.current = cands
    setProactiveMapOverlay((prev) => {
      const events = prev.markers.filter(
        (m) =>
          m.kind === 'anchor' ||
          m.kind === 'last_spoken' ||
          m.kind === 'last_skipped',
      )
      return {
        ...prev,
        markers: [...cands, ...events],
      }
    })
  }, [])

  useEffect(() => {
    if (!__DEV__ || !coords || !isActive || !proactiveSettings.enabled) {
      proactiveCandidatesRef.current = []
      if (!isActive) {
        setProactiveMapOverlay({
          ...EMPTY_PROACTIVE_MAP_OVERLAY,
          spanRadiusKm: proactiveSpan.minDistanceKm,
        })
      }
      return
    }

    // 只跟经纬度粗粒度走，避免 GPS/航向融合每 500ms 重建 coords 对象就狂打高德
    let cancelled = false
    const loadPreview = async () => {
      try {
        const session = await loadSession()
        const data = await fetchProactivePreviewPois(coords, {
          accessToken: session?.access_token,
          scenicRadiusKm: scenicLibraryRadiusKm(proactiveSettings),
        })
        if (cancelled) return
        const cands: ProactiveMapMarker[] = data.candidates.map((c, i) => ({
          id: `cand-${c.amap_poi_id ?? i}-${c.name.slice(0, 8)}`,
          lat: c.lat,
          lng: c.lng,
          name: c.name,
          kind: 'candidate' as const,
          type: c.type,
        }))
        if (
          data.forward_map_hit?.lat != null &&
          data.forward_map_hit.lng != null
        ) {
          cands.push({
            id: 'forward-hit',
            lat: data.forward_map_hit.lat,
            lng: data.forward_map_hit.lng,
            name: data.forward_map_hit.name,
            kind: 'forward_hit',
          })
        }
        proactiveCandidatesRef.current = cands
        setProactiveMapOverlay((prev) => {
          const events = prev.markers.filter(
            (m) =>
              m.kind === 'anchor' ||
              m.kind === 'last_spoken' ||
              m.kind === 'last_skipped',
          )
          return {
            ...prev,
            markers: [...cands, ...events],
          }
        })
      } catch (e) {
        if (__DEV__) console.warn('[proactive preview map]', e)
      }
    }

    void loadPreview()
    const timer = setInterval(loadPreview, 45_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [
    coords?.latitude != null ? Math.round(coords.latitude * 1e4) / 1e4 : null,
    coords?.longitude != null ? Math.round(coords.longitude * 1e4) / 1e4 : null,
    isActive,
    proactiveSettings.enabled,
    proactiveSettings.scenicRadiusKm,
    proactiveSettings.geoRadius.baseUrbanKm,
    proactiveSettings.geoRadius.baseTownKm,
    proactiveSettings.geoRadius.baseWildKm,
  ])

  const handleProactiveQuotaExhausted = useCallback(
    (e: LugeChatQuotaError) => {
      setStartError(null)
      showExhausted(e.payload)
    },
    [showExhausted],
  )

  const {
    forceTrigger: forceProactiveGuide,
    forceSpeakPoi,
    gateHint: proactiveGateHint,
  } = useProactiveGuide({
    enabled:
      (deviceMode || __DEV__) &&
      isActive &&
      conversationReady &&
      proactiveReady &&
      proactiveSettings.enabled,
    coords,
    settings: proactiveSettings,
    busy: isThinking,
    runWhileThinking,
    onSpeak: handleProactiveSpeak,
    onQuotaRefresh: refreshQuota,
    onQuotaExhausted: handleProactiveQuotaExhausted,
    onDevOverlay: __DEV__ ? handleProactiveDevOverlay : undefined,
    onScenicLibraryUpdated: __DEV__ ? syncYellowDotsFromLibrary : undefined,
  })

  const [forceProactiveBusy, setForceProactiveBusy] = useState(false)
  const [selectedDevPoi, setSelectedDevPoi] = useState<ProactiveMapMarker | null>(
    null,
  )

  const handleForceProactive = useCallback(() => {
    if (!__DEV__ || forceProactiveBusy) return
    setForceProactiveBusy(true)
    void forceProactiveGuide()
      .then((r) => {
        if (!r.ok) {
          Alert.alert('没法触发', r.reason)
          return
        }
        if (!r.spoken) {
          Alert.alert('跑完了但没开口', r.skipReason ?? '模型跳过')
        }
      })
      .finally(() => setForceProactiveBusy(false))
  }, [forceProactiveBusy, forceProactiveGuide])

  const handleDevCandidatePress = useCallback((m: ProactiveMapMarker) => {
    if (!__DEV__) return
    if (m.kind !== 'candidate' && m.kind !== 'forward_hit') return
    setSelectedDevPoi(m)
  }, [])

  const handleDevLongPressMap = useCallback(
    (lat: number, lng: number) => {
      if (!__DEV__) return
      setSelectedDevPoi(null)
      clearScenicLibrary()
      void setManualLocation({
        latitude: lat,
        longitude: lng,
        heading: coords?.heading ?? 0,
        label: '地图长按',
      }).then(() => {
        if (__DEV__) {
          console.log('[dev map] 测试位置', lat.toFixed(5), lng.toFixed(5))
        }
      })
    },
    [coords?.heading, setManualLocation],
  )

  const handleSpeakSelectedDevPoi = useCallback(() => {
    if (!__DEV__ || forceProactiveBusy || !selectedDevPoi) return
    const m = selectedDevPoi
    setForceProactiveBusy(true)
    void forceSpeakPoi({
      name: m.name,
      lat: m.lat,
      lng: m.lng,
      type: m.type,
    })
      .then((r) => {
        if (!r.ok) {
          Alert.alert('没法讲解', r.reason)
          return
        }
        if (!r.spoken) {
          Alert.alert('跑完了但没开口', r.skipReason ?? '模型跳过')
        }
      })
      .finally(() => setForceProactiveBusy(false))
  }, [forceProactiveBusy, forceSpeakPoi, selectedDevPoi])

  useEffect(() => {
    if (!isActive || !proactiveSettings.enabled) setSelectedDevPoi(null)
  }, [isActive, proactiveSettings.enabled])

  useEffect(() => {
    if (!isActive) return
    const timer = setInterval(() => {
      void refreshQuota()
    }, 12_000)
    return () => clearInterval(timer)
  }, [isActive, refreshQuota])

  const companionSpeaking = isSpeaking
  const companionThinking = isThinking || voice.state === 'thinking'

  return (
    <View style={styles.root}>
      <RadarMap
        proactiveOverlay={__DEV__ ? proactiveMapOverlay : null}
        speakFocus={speakFocus}
        onDevCandidatePress={__DEV__ ? handleDevCandidatePress : undefined}
        onDevLongPressMap={__DEV__ ? handleDevLongPressMap : undefined}
      />
      {__DEV__ ? <DevLocationPanel /> : null}

      {__DEV__ && isActive && proactiveSettings.enabled ? (
        <View style={styles.devProactiveLegend}>
          {selectedDevPoi ? (
            <View style={styles.devPoiCard}>
              <Pressable
                style={[
                  styles.devSpeakBtn,
                  forceProactiveBusy ? styles.devForceBtnDisabled : null,
                ]}
                disabled={forceProactiveBusy}
                onPress={handleSpeakSelectedDevPoi}
              >
                <Text style={styles.devSpeakBtnText}>
                  {forceProactiveBusy ? '讲解中…' : '讲解'}
                </Text>
              </Pressable>
              <Text style={styles.devPoiName} numberOfLines={2}>
                {selectedDevPoi.name}
              </Text>
              <Text style={styles.devPoiType} numberOfLines={2}>
                {selectedDevPoi.type?.trim() || '（无 type）'}
              </Text>
              <Pressable
                hitSlop={10}
                onPress={() => setSelectedDevPoi(null)}
                style={styles.devPoiDismiss}
              >
                <Text style={styles.devPoiDismissText}>关闭</Text>
              </Pressable>
            </View>
          ) : null}
          <Text style={styles.devProactiveLegendText}>
            {(() => {
              const libKm = scenicLibraryRadiusKm(proactiveSettings)
              const needKm = proactiveSettings.minDistanceKm
              const anchor = proactiveMapOverlay.anchor
              let gate = `门槛 ${needKm}km / ${proactiveSettings.minCheckIntervalMin}分`
              if (coords && anchor) {
                const moved = haversineKm(
                  anchor.lat,
                  anchor.lng,
                  coords.latitude,
                  coords.longitude,
                )
                const remain = Math.max(0, needKm - moved)
                gate =
                  remain < 0.05
                    ? `已够位移（${moved.toFixed(1)}/${needKm}km），等时间门槛或下一轮`
                    : `还差约 ${remain.toFixed(1)}km 才查主动讲（已走 ${moved.toFixed(1)}/${needKm}）`
              }
              return `黄点库≈${libKm}km · ${gate}`
            })()}
            {proactiveGateHint ? `\n${proactiveGateHint}` : ''}
            {forceProactiveBusy ? ' · 请求中…' : ''}
          </Text>
          <Pressable
            style={[
              styles.devForceBtn,
              forceProactiveBusy ? styles.devForceBtnDisabled : null,
            ]}
            disabled={forceProactiveBusy}
            onPress={handleForceProactive}
          >
            <Text style={styles.devForceBtnText}>
              {forceProactiveBusy ? '正在触发…' : '立刻主动讲解'}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {isActive && quota ? (
        <View style={styles.quotaChip}>
          <Text style={styles.quotaChipText}>{formatQuotaLabel(quota)}</Text>
        </View>
      ) : null}

      {__DEV__ ? (
        <View
          style={[
            styles.devVoiceStatusChip,
            isActive && quota ? styles.devVoiceStatusBelowQuota : null,
          ]}
        >
          <Text style={styles.devVoiceStatusText}>语音：{devVoiceStatus}</Text>
        </View>
      ) : null}

      {startError ? (
        <View style={styles.errorChip}>
          <Text style={styles.errorChipText}>{startError}</Text>
        </View>
      ) : null}

      {!isActive ? (
        <View style={styles.startLayer}>
          {isThinking ? (
            <ActivityIndicator size="large" color="#38bdf8" />
          ) : (
            <StartLugeButton active={false} onPress={() => void handleStartLuge()} />
          )}
        </View>
      ) : (
        <LugeCompanion
          deviceMode={deviceMode}
          thinking={companionThinking}
          listening={voice.state === 'listening' || voice.state === 'follow_up'}
          speaking={companionSpeaking}
          sleeping={
            voice.state === 'idle' && !isSpeaking && !companionThinking
          }
          onPress={() => void voice.start()}
          onLongPress={handleStopLuge}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  startLayer: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'box-none',
  },
  quotaChip: {
    position: 'absolute',
    top: 56,
    right: 16,
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    zIndex: 20,
  },
  quotaChipText: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '600',
  },
  devVoiceStatusChip: {
    position: 'absolute',
    top: 56,
    right: 16,
    backgroundColor: 'rgba(2, 132, 199, 0.88)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    zIndex: 21,
  },
  devVoiceStatusBelowQuota: {
    top: 88,
  },
  devVoiceStatusText: {
    color: '#f0f9ff',
    fontSize: 12,
    fontWeight: '700',
  },
  errorChip: {
    position: 'absolute',
    top: 56,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(127, 29, 29, 0.88)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    zIndex: 20,
  },
  errorChipText: {
    color: '#fecaca',
    fontSize: 13,
    textAlign: 'center',
  },
  devProactiveLegend: {
    position: 'absolute',
    left: 12,
    right: 12,
    top: 132,
    backgroundColor: 'rgba(15, 23, 42, 0.78)',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    zIndex: 15,
    gap: 8,
  },
  devProactiveLegendText: {
    color: '#cbd5e1',
    fontSize: 10,
    lineHeight: 14,
  },
  devForceBtn: {
    alignSelf: 'flex-start',
    backgroundColor: '#f59e0b',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  devForceBtnDisabled: {
    opacity: 0.55,
  },
  devForceBtnText: {
    color: '#0f172a',
    fontSize: 13,
    fontWeight: '700',
  },
  devPoiCard: {
    backgroundColor: 'rgba(30, 41, 59, 0.95)',
    borderRadius: 10,
    padding: 10,
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.35)',
  },
  devSpeakBtn: {
    alignSelf: 'stretch',
    backgroundColor: '#4ade80',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  devSpeakBtnText: {
    color: '#0f172a',
    fontSize: 15,
    fontWeight: '800',
  },
  devPoiName: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '700',
  },
  devPoiType: {
    color: '#94a3b8',
    fontSize: 12,
    lineHeight: 16,
  },
  devPoiDismiss: {
    alignSelf: 'flex-end',
    paddingVertical: 2,
  },
  devPoiDismissText: {
    color: '#64748b',
    fontSize: 12,
  },
})
