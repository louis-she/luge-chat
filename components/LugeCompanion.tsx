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
  Easing,
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
  /** 真机：路鸽与等待气泡组合 */
  deviceMode?: boolean
  inputLevel?: number
  sleeping?: boolean
  onPress?: () => void
  onLongPress?: () => void
}

type DeviceAvatarProps = {
  thinking?: boolean
  listening?: boolean
  speaking?: boolean
  inputLevel?: number
  sleeping?: boolean
  onPress?: () => void
  onLongPress?: () => void
}

const pigeonImage = require('../assets/luge-pigeon.png')
const sleepingPigeonImage = require('../assets/luge-pigeon-sleeping.png')
const thinkingCloudImage = require('../assets/think-cloud.png')

function ThinkingBadge() {
  return (
    <Image source={thinkingCloudImage} style={styles.thinkingBadgeImage} resizeMode="contain" />
  )
}

function SleepingBadge() {
  const firstProgress = useSharedValue(0)
  const secondProgress = useSharedValue(0)

  useEffect(() => {
    const createZCycle = () =>
      withRepeat(
        withSequence(
          withTiming(1, { duration: 1500, easing: Easing.out(Easing.cubic) }),
          withDelay(220, withTiming(0, { duration: 0 })),
        ),
        -1,
        false,
      )

    firstProgress.value = createZCycle()
    secondProgress.value = withDelay(820, createZCycle())
  }, [firstProgress, secondProgress])

  const firstStyle = useAnimatedStyle(() => {
    const progress = firstProgress.value
    const fadeIn = Math.min(1, progress / 0.16)
    const fadeOut = Math.min(1, Math.max(0, (1 - progress) / 0.14))

    return {
      opacity: Math.min(fadeIn, fadeOut) * 0.92,
      transform: [
        { translateX: progress * 8 },
        { translateY: -progress * 34 },
        { scale: 0.58 + progress * 0.72 },
      ],
    }
  })

  const secondStyle = useAnimatedStyle(() => {
    const progress = secondProgress.value
    const fadeIn = Math.min(1, progress / 0.16)
    const fadeOut = Math.min(1, Math.max(0, (1 - progress) / 0.14))

    return {
      opacity: Math.min(fadeIn, fadeOut) * 0.92,
      transform: [
        { translateX: progress * 8 },
        { translateY: -progress * 34 },
        { scale: 0.58 + progress * 0.72 },
      ],
    }
  })

  return (
    <View style={styles.sleepingBadge} pointerEvents="none">
      <Animated.View style={[styles.sleepingZ, firstStyle]}>
        <Text style={styles.sleepingZText}>z</Text>
      </Animated.View>
      <Animated.View style={[styles.sleepingZ, styles.sleepingZSecond, secondStyle]}>
        <Text style={styles.sleepingZText}>z</Text>
      </Animated.View>
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
  inputLevel,
  onPress,
  onLongPress,
}: DeviceAvatarProps) {
  const insets = useSafeAreaInsets()

  return (
    <View style={[styles.deviceRoot, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={500}
        style={({ pressed }) => [styles.avatarWrap, pressed && styles.avatarPressed]}
      >
        <Animated.View style={styles.avatarStage}>
          <View style={styles.avatarShell}>
            <Image
              source={sleeping ? sleepingPigeonImage : pigeonImage}
              style={styles.avatarImageLarge}
              resizeMode="contain"
            />
          </View>
          {thinking ? (
            <View style={styles.thinkingBadgeWrap}>
              <ThinkingBadge />
            </View>
          ) : sleeping ? (
            <SleepingBadge />
          ) : speaking ? (
            <SpeakingBadge />
          ) : null}
        </Animated.View>
      </Pressable>
      {listening ? (
        <View style={[styles.bubble, styles.deviceListeningBubble]}>
          <View style={styles.listeningCol}>
            <Text style={styles.bubbleText}>请说话…</Text>
            <VoiceWaveform active compact level={inputLevel} />
          </View>
        </View>
      ) : null}
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
  inputLevel,
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
        inputLevel={inputLevel}
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
          <View style={styles.avatarShell}>
            <Image
              source={sleeping ? sleepingPigeonImage : pigeonImage}
              style={styles.avatarImageLarge}
              resizeMode="contain"
            />
          </View>
          {thinking ? (
            <View style={styles.thinkingBadgeWrap}>
              <ThinkingBadge />
            </View>
          ) : sleeping ? (
            <SleepingBadge />
          ) : speaking ? (
            <SpeakingBadge />
          ) : null}
        </View>
      </Pressable>

      {showBubble ? (
        <Animated.View style={[styles.bubble, bubbleStyle]}>
          {sleeping ? (
            <Text style={styles.bubbleText}>点击路鸽开始说话</Text>
          ) : listening ? (
            <View style={styles.listeningCol}>
              <Text style={styles.bubbleText}>{line || '请说话…'}</Text>
              <VoiceWaveform active compact level={inputLevel} />
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
    alignItems: 'center',
    justifyContent: 'center',
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
  statusBadgeSpeaking: {
    backgroundColor: '#bbf7d0',
    borderColor: '#34d399',
  },
  sleepingBadge: {
    position: 'absolute',
    top: -22,
    right: -18,
    width: 52,
    height: 62,
  },
  sleepingZ: {
    position: 'absolute',
    left: 1,
    top: 29,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sleepingZSecond: {
    left: 10,
    top: 29,
  },
  sleepingZText: {
    backgroundColor: 'transparent',
    color: '#5d94e5',
    fontSize: 20,
    fontWeight: '800',
    includeFontPadding: false,
    lineHeight: 24,
    textShadowColor: 'rgba(59, 130, 246, 0.18)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
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
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(96, 165, 250, 0.28)',
  },
  deviceListeningBubble: {
    flex: 0,
    width: 150,
    maxWidth: 150,
    paddingHorizontal: 8,
    paddingVertical: 8,
    marginBottom: 8,
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
