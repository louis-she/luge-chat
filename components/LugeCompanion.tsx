import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import { useEffect, useState } from 'react'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { VoiceWaveform } from './VoiceWaveform'
import { BUBBLE_FADE_MS } from '../lib/bubbleTiming'
import { colors } from '../lib/theme'

type Props = {
  speech: string | null
  thinking?: boolean
  listening?: boolean
  speaking?: boolean
  /** 真机：仅图标状态，无气泡、无需点击说话 */
  deviceMode?: boolean
  sleeping?: boolean
  onPress?: () => void
  onLongPress?: () => void
}

type DeviceAvatarProps = {
  thinking?: boolean
  listening?: boolean
  speaking?: boolean
  sleeping?: boolean
  onPress?: () => void
  onLongPress?: () => void
}

const pigeonImage = require('../assets/luge-pigeon.png')
const thinkingCloudImage = require('../assets/think-cloud.png')

function ThinkingBadge() {
  return (
    <Image source={thinkingCloudImage} style={styles.thinkingBadgeImage} resizeMode="contain" />
  )
}

function SleepingBadge() {
  const progress = useSharedValue(0)

  useEffect(() => {
    progress.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1100 }),
        withTiming(0, { duration: 0 }),
      ),
      -1,
      false,
    )
  }, [progress])

  const style = useAnimatedStyle(() => ({
    opacity: 0.5 + progress.value * 0.5,
    transform: [
      { translateY: -progress.value * 8 },
      { scale: 0.92 + progress.value * 0.08 },
    ],
  }))

  return (
    <Animated.View style={[styles.sleepingBadge, style]}>
      <Text style={styles.sleepingZSmall}>z</Text>
      <Text style={styles.sleepingZLarge}>Z</Text>
    </Animated.View>
  )
}

function ListeningBadge() {
  return (
    <View style={[styles.statusBadge, styles.statusBadgeListening]}>
      <Ionicons name="mic" size={16} color="#0c4a6e" />
    </View>
  )
}

function SpeakingBadge() {
  return (
    <View style={[styles.statusBadge, styles.statusBadgeSpeaking]}>
      <Ionicons name="volume-high" size={16} color="#064e3b" />
    </View>
  )
}

function DeviceAvatar({
  thinking,
  listening,
  speaking,
  sleeping,
  onPress,
  onLongPress,
}: DeviceAvatarProps) {
  const insets = useSafeAreaInsets()
  const ripple = useSharedValue(0)
  const ripple2 = useSharedValue(0)

  useEffect(() => {
    if (speaking) {
      ripple.value = 0
      ripple2.value = 0
      ripple.value = withRepeat(withTiming(1, { duration: 1300 }), -1, false)
      ripple2.value = withDelay(
        420,
        withRepeat(withTiming(1, { duration: 1300 }), -1, false),
      )
      return
    }

    ripple.value = withTiming(0, { duration: 180 })
    ripple2.value = withTiming(0, { duration: 180 })
  }, [speaking, ripple, ripple2])

  const rippleStyle = useAnimatedStyle(() => ({
    opacity: speaking ? 0.32 * (1 - ripple.value) : 0,
    transform: [{ scale: 1 + ripple.value * 0.55 }],
  }))

  const rippleStyle2 = useAnimatedStyle(() => ({
    opacity: speaking ? 0.24 * (1 - ripple2.value) : 0,
    transform: [{ scale: 1 + ripple2.value * 0.68 }],
  }))

  return (
    <View style={[styles.deviceRoot, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={500}
        style={({ pressed }) => [styles.avatarWrap, pressed && styles.avatarPressed]}
      >
        <Animated.View style={styles.avatarStage}>
          <Animated.View style={[styles.avatarRipple, styles.avatarRipplePrimary, rippleStyle]} />
          <Animated.View style={[styles.avatarRipple, styles.avatarRippleSecondary, rippleStyle2]} />
          <View
            style={[
              styles.avatarShell,
              sleeping
                ? styles.avatarShellSleeping
                : thinking
                  ? styles.avatarShellThinking
                  : speaking
                    ? styles.avatarShellSpeaking
                    : listening
                      ? styles.avatarShellListening
                      : null,
            ]}
          >
            <Image source={pigeonImage} style={styles.avatarImageLarge} resizeMode="contain" />
          </View>
          {thinking ? (
            <View style={styles.thinkingBadgeWrap}>
              <ThinkingBadge />
            </View>
          ) : sleeping ? (
            <SleepingBadge />
          ) : speaking ? (
            <SpeakingBadge />
          ) : listening ? (
            <ListeningBadge />
          ) : null}
        </Animated.View>
      </Pressable>
    </View>
  )
}

/** 路鸽形象占位，后续替换为精细卡通素材 */
export function LugeCompanion({
  speech,
  thinking,
  listening,
  speaking,
  deviceMode,
  sleeping,
  onPress,
  onLongPress,
}: Props) {
  if (deviceMode) {
    return (
      <DeviceAvatar
        thinking={thinking}
        listening={listening}
        speaking={speaking}
        sleeping={sleeping}
        onPress={onPress}
        onLongPress={onLongPress}
      />
    )
  }

  const insets = useSafeAreaInsets()
  const [line, setLine] = useState<string | null>(null)
  const opacity = useSharedValue(0)
  const translateX = useSharedValue(-12)

  useEffect(() => {
    if (speech) {
      setLine(speech)
      opacity.value = 0
      translateX.value = -12
      opacity.value = withTiming(1, { duration: 220 })
      translateX.value = withTiming(0, { duration: 220 })
      return
    }

    opacity.value = withTiming(0, { duration: BUBBLE_FADE_MS })
    translateX.value = withTiming(-10, { duration: BUBBLE_FADE_MS }, (done) => {
      if (done) runOnJS(setLine)(null)
    })
  }, [speech, opacity, translateX])

  const bubbleStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: translateX.value }],
  }))

  const showBubble = !!line || thinking || listening || sleeping

  return (
    <View style={[styles.root, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={500}
        style={({ pressed }) => [styles.avatarWrap, pressed && styles.avatarPressed]}
      >
        <View style={styles.avatarStage}>
          <View
            style={[
              styles.avatarShell,
              sleeping
                ? styles.avatarShellSleeping
                : thinking
                  ? styles.avatarShellThinking
                  : speaking
                    ? styles.avatarShellSpeaking
                    : listening
                      ? styles.avatarShellListening
                      : null,
            ]}
          >
            <Image source={pigeonImage} style={styles.avatarImageLarge} resizeMode="contain" />
          </View>
          {thinking ? (
            <View style={styles.thinkingBadgeWrap}>
              <ThinkingBadge />
            </View>
          ) : sleeping ? (
            <SleepingBadge />
          ) : speaking ? (
            <SpeakingBadge />
          ) : listening ? (
            <ListeningBadge />
          ) : null}
        </View>
      </Pressable>

      {showBubble ? (
        <Animated.View style={[styles.bubble, bubbleStyle]}>
          <View style={styles.bubbleTail} />
          {sleeping ? (
            <Text style={styles.bubbleText}>点击路鸽开始说话</Text>
          ) : listening ? (
            <View style={styles.listeningCol}>
              <Text style={styles.bubbleText}>{line || '请说话…'}</Text>
              <VoiceWaveform active />
            </View>
          ) : thinking ? (
            <View style={styles.thinkingRow}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={styles.bubbleText}>{line ?? '路鸽在想…'}</Text>
            </View>
          ) : (
            <Text style={styles.bubbleText}>{line}</Text>
          )}
        </Animated.View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    pointerEvents: 'box-none',
  },
  deviceRoot: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    pointerEvents: 'box-none',
  },
  avatarWrap: {
    flexShrink: 0,
  },
  avatarPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.97 }],
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#dbeafe',
    borderWidth: 2,
    borderColor: 'rgba(96, 165, 250, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.radarGlow,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  avatarStage: {
    width: 92,
    height: 92,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarShell: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: '#dbeafe',
    borderWidth: 2,
    borderColor: 'rgba(96, 165, 250, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.radarGlow,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  avatarShellListening: {
    borderColor: colors.accent,
    shadowOpacity: 0.55,
    shadowRadius: 16,
  },
  avatarShellSpeaking: {
    borderColor: '#34d399',
    shadowColor: '#10b981',
    shadowOpacity: 0.5,
    shadowRadius: 16,
  },
  avatarShellThinking: {
    borderColor: 'rgba(96, 165, 250, 0.45)',
    backgroundColor: '#e0e7ff',
  },
  avatarShellSleeping: {
    borderColor: 'rgba(248, 113, 113, 0.55)',
    backgroundColor: '#fef2f2',
  },
  avatarRipple: {
    position: 'absolute',
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 2,
  },
  avatarRipplePrimary: {
    borderColor: 'rgba(16, 185, 129, 0.36)',
  },
  avatarRippleSecondary: {
    borderColor: 'rgba(52, 211, 153, 0.24)',
  },
  avatarListening: {
    borderColor: colors.accent,
    shadowOpacity: 0.55,
    shadowRadius: 16,
  },
  avatarSpeaking: {
    borderColor: '#34d399',
    backgroundColor: '#d1fae5',
    shadowColor: '#10b981',
    shadowOpacity: 0.5,
    shadowRadius: 16,
  },
  avatarThinking: {
    borderColor: 'rgba(96, 165, 250, 0.45)',
    backgroundColor: '#e0e7ff',
  },
  avatarMuted: {
    borderColor: 'rgba(248, 113, 113, 0.55)',
    backgroundColor: '#fef2f2',
  },
  avatarEmoji: {
    fontSize: 36,
  },
  avatarImage: {
    width: 62,
    height: 62,
  },
  avatarImageLarge: {
    width: 60,
    height: 60,
  },
  statusBadge: {
    position: 'absolute',
    top: 4,
    right: 2,
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    borderWidth: 1,
    borderColor: 'rgba(96, 165, 250, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0f172a',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  statusBadgeListening: {
    backgroundColor: '#bae6fd',
    borderColor: '#38bdf8',
  },
  statusBadgeSpeaking: {
    backgroundColor: '#bbf7d0',
    borderColor: '#34d399',
  },
  sleepingBadge: {
    position: 'absolute',
    top: -10,
    right: -8,
    width: 34,
    height: 42,
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
  },
  sleepingZSmall: {
    position: 'absolute',
    top: 12,
    right: 14,
    color: '#64748b',
    fontSize: 13,
    fontWeight: '700',
  },
  sleepingZLarge: {
    position: 'absolute',
    top: 0,
    right: 0,
    color: '#475569',
    fontSize: 22,
    fontWeight: '800',
  },
  thinkingBadgeWrap: {
    position: 'absolute',
    top: -14,
    right: -10,
    shadowColor: '#0f172a',
    shadowOpacity: 0.22,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  thinkingBadgeImage: {
    width: 32,
    height: 32,
  },
  bubble: {
    flex: 1,
    maxWidth: '78%',
    backgroundColor: 'rgba(17, 24, 39, 0.94)',
    borderRadius: 18,
    borderTopLeftRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(96, 165, 250, 0.28)',
  },
  bubbleTail: {
    position: 'absolute',
    left: -6,
    bottom: 18,
    width: 12,
    height: 12,
    backgroundColor: 'rgba(17, 24, 39, 0.94)',
    borderLeftWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(96, 165, 250, 0.28)',
    transform: [{ rotate: '45deg' }],
  },
  thinkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  listeningCol: {
    gap: 8,
  },
  bubbleText: {
    flex: 1,
    color: colors.radarText,
    fontSize: 15,
    lineHeight: 22,
  },
})
