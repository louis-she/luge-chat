import { useCallback, useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { DevLocationPanel } from '../../components/DevLocationPanel'
import { DevAskBar, LugeCompanion } from '../../components/LugeCompanion'
import { RadarMap } from '../../components/RadarMap'
import { StartLugeButton } from '../../components/StartLugeButton'
import { isDevSimulator } from '../../lib/isDevSimulator'
import { useLuge } from '../../lib/LugeContext'
import { useUserLocation } from '../../lib/LocationContext'
import { useQuota } from '../../lib/QuotaContext'
import { formatQuotaLabel } from '../../lib/quota'
import { useAutoVoiceConversation } from '../../lib/useAutoVoiceConversation'
import { useProactiveGuide } from '../../lib/useProactiveGuide'
import { useProactiveGuideSettings } from '../../lib/ProactiveGuideContext'
import { useVoiceInput } from '../../lib/useVoiceInput'
import { LugeChatQuotaError } from '../../lib/lugeChat'

const DEMO_RIVER_QUESTION =
  '我前面的河是什么河，有什么典故，上下游是哪'

export default function RadarScreen() {
  const deviceMode = !isDevSimulator()
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
  } = useLuge()
  const { coords } = useUserLocation()
  const { settings: proactiveSettings, ready: proactiveReady } = useProactiveGuideSettings()
  const { quota, refreshQuota, showExhausted } = useQuota()
  const [voiceBlocked, setVoiceBlocked] = useState(false)
  const [companionMenuOpen, setCompanionMenuOpen] = useState(false)
  const [micMuted, setMicMuted] = useState(false)

  const onVoiceError = useCallback(
    (msg: string) => {
      if (__DEV__) console.warn('[voice ui]', msg)
    },
    [],
  )

  const voice = useVoiceInput(ask, {
    onError: onVoiceError,
    onPermissionDenied: () => setVoiceBlocked(true),
    canListen: () => !isThinking && !isSpeaking && !micMuted,
  })

  const voiceBusy = isThinking || isSpeaking

  useAutoVoiceConversation({
    enabled: deviceMode && isActive && voice.available,
    ready: conversationReady,
    busy: voiceBusy,
    blocked: voiceBlocked || micMuted,
    isListening: voice.isListening,
    startListening: voice.startListening,
  })

  useEffect(() => {
    if (!deviceMode || !isActive) return
    if (voiceBusy && voice.isListening) {
      voice.abortListening()
    }
  }, [deviceMode, isActive, voiceBusy, voice.isListening, voice.abortListening])

  useEffect(() => {
    if (isActive) return
    setMicMuted(false)
    setCompanionMenuOpen(false)
  }, [isActive])

  const handleStopLuge = useCallback(() => {
    voice.abortListening()
    setVoiceBlocked(false)
    setMicMuted(false)
    setCompanionMenuOpen(false)
    stopLuge()
  }, [voice.abortListening, stopLuge])

  const handleAvatarPress = useCallback(() => {
    if (!deviceMode) return
    setCompanionMenuOpen((open) => !open)
  }, [deviceMode])

  const handleToggleMic = useCallback(() => {
    setMicMuted((muted) => {
      if (!muted) voice.abortListening()
      return !muted
    })
  }, [voice.abortListening])

  const handleProactiveSpeak = useCallback(
    async (text: string, accessToken: string | null) => {
      await say(text, accessToken, { recordProactive: true })
    },
    [say],
  )

  const handleProactiveQuotaExhausted = useCallback(
    (e: LugeChatQuotaError) => {
      showExhausted(e.payload)
    },
    [showExhausted],
  )

  useProactiveGuide({
    enabled:
      deviceMode &&
      isActive &&
      conversationReady &&
      proactiveReady &&
      proactiveSettings.enabled,
    coords,
    minRating: proactiveSettings.minRating,
    busy: voiceBusy || voice.isListening,
    runWhileThinking,
    onSpeak: handleProactiveSpeak,
    onQuotaRefresh: refreshQuota,
    onQuotaExhausted: handleProactiveQuotaExhausted,
  })

  return (
    <View style={styles.root}>
      <RadarMap />
      {isDevSimulator() ? <DevLocationPanel /> : null}

      {isActive && quota ? (
        <View style={styles.quotaChip}>
          <Text style={styles.quotaChipText}>{formatQuotaLabel(quota)}</Text>
        </View>
      ) : null}

      {!isActive ? (
        <View style={styles.startLayer}>
          <StartLugeButton active={false} onPress={startLuge} />
        </View>
      ) : (
        <>
          <DevAskBar
            onSubmit={(t) => ask(t)}
            disabled={isThinking || voice.isListening}
          />
          <LugeCompanion
            deviceMode={deviceMode}
            speech={speech}
            thinking={isThinking}
            listening={voice.isListening && !micMuted}
            speaking={isSpeaking}
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
})
