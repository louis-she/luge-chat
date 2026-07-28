import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { DevLocationPanel } from '../../components/DevLocationPanel'
import { DevAskBar, LugeCompanion } from '../../components/LugeCompanion'
import { RadarMap } from '../../components/RadarMap'
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
import { settingsToSpanConfig } from '../../lib/proactiveSettings'
import { useLuge } from '../../lib/LugeContext'
import { useUserLocation } from '../../lib/LocationContext'
import { useQuota } from '../../lib/QuotaContext'
import { formatQuotaLabel } from '../../lib/quota'
import { useAutoVoiceConversation } from '../../lib/useAutoVoiceConversation'
import { useProactiveGuide } from '../../lib/useProactiveGuide'
import { useProactiveGuideSettings } from '../../lib/ProactiveGuideContext'
import { useVoiceInput } from '../../lib/useVoiceInput'
import { LugeChatQuotaError } from '../../lib/lugeChat'
import { isDevSimulator } from '../../lib/isDevSimulator'
import { isRtcVoicePath } from '../../lib/voicePath'
import { useVolcVoiceSession } from '../../lib/useVolcVoiceSession'

const DEMO_RIVER_QUESTION =
  '我前面的河是什么河，有什么典故，上下游是哪'

export default function RadarScreen() {
  const deviceMode = !isDevSimulator()
  const rtcPath = isRtcVoicePath()
  const volc = useVolcVoiceSession()
  const [startError, setStartError] = useState<string | null>(null)

  const {
    isActive,
    speech,
    isThinking,
    isSpeaking,
    conversationReady,
    startLuge,
    stopLuge,
    ask,
    say,
    runWhileThinking,
    recordProactiveSpeech,
  } = useLuge()
  const { coords } = useUserLocation()
  const { settings: proactiveSettings, ready: proactiveReady } = useProactiveGuideSettings()
  const proactiveSpan = settingsToSpanConfig(proactiveSettings)
  const { quota, refreshQuota, showExhausted } = useQuota()
  const [voiceBlocked, setVoiceBlocked] = useState(false)
  const [companionMenuOpen, setCompanionMenuOpen] = useState(false)
  const [micMuted, setMicMuted] = useState(false)
  const [proactiveMapOverlay, setProactiveMapOverlay] = useState<ProactiveMapOverlay>(
    () => ({
      ...EMPTY_PROACTIVE_MAP_OVERLAY,
      spanRadiusKm: 20,
    }),
  )
  const proactiveCandidatesRef = useRef<ProactiveMapMarker[]>([])

  const legacyVoice = !rtcPath

  const onVoiceError = useCallback(
    (msg: string) => {
      if (__DEV__) console.warn('[voice ui]', msg)
      setStartError(msg)
    },
    [],
  )

  const voice = useVoiceInput(ask, {
    onError: onVoiceError,
    onPermissionDenied: () => setVoiceBlocked(true),
    canListen: () =>
      legacyVoice && !isThinking && !isSpeaking && !micMuted,
  })

  const voiceBusy = isThinking || isSpeaking

  useAutoVoiceConversation({
    enabled: legacyVoice && deviceMode && isActive && voice.available,
    ready: conversationReady,
    busy: voiceBusy,
    blocked: voiceBlocked || micMuted,
    isListening: voice.isListening,
    startListening: voice.startListening,
  })

  useEffect(() => {
    if (!legacyVoice || !deviceMode || !isActive) return
    if (voiceBusy && voice.isListening) {
      voice.abortListening()
    }
  }, [legacyVoice, deviceMode, isActive, voiceBusy, voice.isListening, voice.abortListening])

  useEffect(() => {
    if (isActive) return
    setMicMuted(false)
    setCompanionMenuOpen(false)
    setStartError(null)
  }, [isActive])

  useEffect(() => {
    if (!rtcPath || !isActive) return
    volc.setMicEnabled(!micMuted)
  }, [rtcPath, isActive, micMuted, volc.setMicEnabled])

  const handleStartLuge = useCallback(async () => {
    setStartError(null)
    if (rtcPath) {
      if (quota && !quota.can_ask) {
        showExhausted({
          code: 'QUOTA_EXHAUSTED',
          tier: quota.tier,
          register_bonus: quota.register_bonus,
        })
        return
      }
      const result = await volc.join()
      if (!result.ok) {
        if ('quota' in result) {
          showExhausted(result.quota)
          return
        }
        setStartError(result.message)
        return
      }
      void refreshQuota()
      startLuge({ skipGreeting: true })
      return
    }
    startLuge()
  }, [rtcPath, volc.join, startLuge, quota, showExhausted, refreshQuota])

  const handleStopLuge = useCallback(() => {
    voice.abortListening()
    setVoiceBlocked(false)
    setMicMuted(false)
    setCompanionMenuOpen(false)
    if (rtcPath && volc.inCall) {
      void volc.leave().then(() => refreshQuota())
    } else if (rtcPath) {
      void refreshQuota()
    }
    stopLuge()
  }, [voice.abortListening, rtcPath, volc.inCall, volc.leave, stopLuge, refreshQuota])

  const handleAvatarPress = useCallback(() => {
    if (!deviceMode) return
    setCompanionMenuOpen((open) => !open)
  }, [deviceMode])

  const handleToggleMic = useCallback(() => {
    setMicMuted((muted) => {
      const next = !muted
      if (rtcPath) {
        volc.setMicEnabled(!next)
      } else if (next) {
        voice.abortListening()
      }
      return next
    })
  }, [rtcPath, volc.setMicEnabled, voice.abortListening])

  const handleProactiveSpeak = useCallback(
    async (text: string, accessToken: string | null) => {
      if (rtcPath && volc.inCall) {
        const ok = await volc.speakExternal(text)
        if (ok) recordProactiveSpeech(text)
        else await say(text, accessToken, { recordProactive: true })
        return
      }
      await say(text, accessToken, { recordProactive: true })
    },
    [rtcPath, volc.inCall, volc.speakExternal, say, recordProactiveSpeech],
  )

  const handleProactiveDevOverlay = useCallback((patch: ProactiveDevOverlay) => {
    if (!__DEV__) return
    setProactiveMapOverlay((prev) =>
      mergeProactiveDevOverlay(prev, patch, proactiveCandidatesRef.current),
    )
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
          scenicRadiusKm: proactiveSettings.scenicRadiusKm,
        })
        if (cancelled) return
        const cands: ProactiveMapMarker[] = data.candidates.map((c, i) => ({
          id: `cand-${i}-${c.name.slice(0, 8)}`,
          lat: c.lat,
          lng: c.lng,
          name: c.name,
          kind: 'candidate' as const,
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
  ])

  const handleProactiveQuotaExhausted = useCallback(
    (e: LugeChatQuotaError) => {
      showExhausted(e.payload)
    },
    [showExhausted],
  )

  useProactiveGuide({
    enabled:
      (deviceMode || __DEV__) &&
      isActive &&
      conversationReady &&
      proactiveReady &&
      proactiveSettings.enabled &&
      (legacyVoice || (rtcPath && volc.inCall)),
    coords,
    settings: proactiveSettings,
    busy:
      isThinking ||
      (legacyVoice && (voiceBusy || voice.isListening)),
    runWhileThinking,
    onSpeak: handleProactiveSpeak,
    onQuotaRefresh: refreshQuota,
    onQuotaExhausted: handleProactiveQuotaExhausted,
    onDevOverlay: __DEV__ ? handleProactiveDevOverlay : undefined,
  })

  const rtcLive = rtcPath && isActive && volc.inCall

  useEffect(() => {
    if (!rtcLive) return
    const timer = setInterval(() => {
      void refreshQuota()
    }, 12_000)
    return () => clearInterval(timer)
  }, [rtcLive, refreshQuota])

  const companionSpeaking = rtcLive ? true : isSpeaking
  const companionThinking = rtcPath && isActive ? volc.busy && !volc.inCall : isThinking

  return (
    <View style={styles.root}>
      <RadarMap proactiveOverlay={__DEV__ ? proactiveMapOverlay : null} />
      {isDevSimulator() ? <DevLocationPanel /> : null}

      {__DEV__ && isActive && proactiveSettings.enabled ? (
        <View style={styles.devProactiveLegend}>
          <Text style={styles.devProactiveLegendText}>
            主动讲解 Dev · 黄=候选景点 · 紫=当前前方 POI · 蓝圈=位移门槛 · 绿/灰=上次开口/跳过
          </Text>
        </View>
      ) : null}

      {isActive && quota ? (
        <View style={styles.quotaChip}>
          <Text style={styles.quotaChipText}>{formatQuotaLabel(quota)}</Text>
        </View>
      ) : null}

      {startError && !isActive ? (
        <View style={styles.errorChip}>
          <Text style={styles.errorChipText}>{startError}</Text>
        </View>
      ) : null}

      {!isActive ? (
        <View style={styles.startLayer}>
          {volc.busy ? (
            <ActivityIndicator size="large" color="#38bdf8" />
          ) : (
            <StartLugeButton active={false} onPress={() => void handleStartLuge()} />
          )}
        </View>
      ) : (
        <>
          <DevAskBar
            onSubmit={(t) => ask(t)}
            disabled={isThinking || voice.isListening || rtcPath}
          />
          <LugeCompanion
            deviceMode={deviceMode}
            speech={rtcPath ? null : speech}
            thinking={companionThinking}
            listening={legacyVoice && voice.isListening && !micMuted}
            speaking={companionSpeaking}
            micMuted={micMuted}
            menuOpen={companionMenuOpen}
            onToggleMic={handleToggleMic}
            onPress={
              deviceMode
                ? handleAvatarPress
                : () => ask(DEMO_RIVER_QUESTION)
            }
            onLongPress={handleStopLuge}
          />
        </>
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
    bottom: 100,
    backgroundColor: 'rgba(15, 23, 42, 0.78)',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    zIndex: 15,
  },
  devProactiveLegendText: {
    color: '#cbd5e1',
    fontSize: 10,
    lineHeight: 14,
  },
})
