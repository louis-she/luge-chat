import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import { useEffect, useRef } from 'react'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors } from '../lib/theme'

type Props = {
  thinking?: boolean
  listening?: boolean
  speaking?: boolean
  /** 真机：路鸽与等待气泡组合 */
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

const pigeonBodyImage = require('../assets/luge-pigeon-body.png')
const pigeonHeadImage = require('../assets/luge-pigeon-head.png')
const pigeonWingImage = require('../assets/luge-pigeon-wing.png')
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

type PigeonCharacterProps = {
  sleeping?: boolean
  listening?: boolean
  thinking?: boolean
  speaking?: boolean
}

function AnimatedPigeon({
  sleeping,
  listening,
  thinking,
  speaking,
}: PigeonCharacterProps) {
  const headRotation = useSharedValue(0)
  const wingRotation = useSharedValue(0)
  const previousSleeping = useRef(Boolean(sleeping))
  const previousListening = useRef(Boolean(listening))
  const previousThinking = useRef(Boolean(thinking))
  const previousSpeaking = useRef(Boolean(speaking))

  useEffect(() => {
    const becameListening = Boolean(listening) && !previousListening.current
    const becameThinking = Boolean(thinking) && !previousThinking.current
    const becameAwake = previousSleeping.current && !sleeping

    if (speaking && !previousSpeaking.current) {
      headRotation.value = withRepeat(
        withSequence(
          withTiming(-2, { duration: 620, easing: Easing.inOut(Easing.ease) }),
          withTiming(2, { duration: 900, easing: Easing.inOut(Easing.ease) }),
          withTiming(0, { duration: 420, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        false,
      )
    } else if (!speaking && previousSpeaking.current) {
      headRotation.value = withTiming(0, { duration: 180 })
    } else if (becameListening) {
      headRotation.value = withSequence(
        withTiming(-4, { duration: 180, easing: Easing.inOut(Easing.ease) }),
        withTiming(4, { duration: 220, easing: Easing.inOut(Easing.ease) }),
        withTiming(-3, { duration: 180, easing: Easing.inOut(Easing.ease) }),
        withTiming(3, { duration: 220, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 220, easing: Easing.inOut(Easing.ease) }),
      )
      wingRotation.value = withSequence(
        withTiming(3, { duration: 180, easing: Easing.inOut(Easing.ease) }),
        withTiming(-3, { duration: 220, easing: Easing.inOut(Easing.ease) }),
        withTiming(2, { duration: 180, easing: Easing.inOut(Easing.ease) }),
        withTiming(-2, { duration: 220, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 220, easing: Easing.inOut(Easing.ease) }),
      )
    } else if (becameThinking || becameAwake) {
      headRotation.value = withSequence(
        withTiming(-5, { duration: 260, easing: Easing.inOut(Easing.ease) }),
        withTiming(4, { duration: 300, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 260, easing: Easing.inOut(Easing.ease) }),
      )
      wingRotation.value = withSequence(
        withTiming(4, { duration: 260, easing: Easing.inOut(Easing.ease) }),
        withTiming(-2, { duration: 300, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 260, easing: Easing.inOut(Easing.ease) }),
      )
    }

    previousSleeping.current = Boolean(sleeping)
    previousListening.current = Boolean(listening)
    previousThinking.current = Boolean(thinking)
    previousSpeaking.current = Boolean(speaking)
  }, [headRotation, listening, sleeping, speaking, thinking, wingRotation])

  const headStyle = useAnimatedStyle(() => ({
    transform: [{ rotateZ: `${headRotation.value}deg` }],
  }))
  const wingStyle = useAnimatedStyle(() => ({
    transform: [{ rotateZ: `${wingRotation.value}deg` }],
  }))

  return (
    <View style={styles.pigeonLayers} pointerEvents="none">
      {sleeping ? (
        <Image
          source={sleepingPigeonImage}
          style={styles.avatarImageLarge}
          resizeMode="contain"
        />
      ) : (
        <>
          <Image
            source={pigeonBodyImage}
            style={styles.avatarImageLarge}
            resizeMode="contain"
          />
          <Animated.View style={[styles.pigeonPivot, styles.pigeonHeadPivot, headStyle]}>
            <Image
              source={pigeonHeadImage}
              style={[styles.pigeonPartImage, styles.pigeonHeadImage]}
              resizeMode="contain"
            />
          </Animated.View>
          <Animated.View style={[styles.pigeonPivot, styles.pigeonWingPivot, wingStyle]}>
            <Image
              source={pigeonWingImage}
              style={[styles.pigeonPartImage, styles.pigeonWingImage]}
              resizeMode="contain"
            />
          </Animated.View>
        </>
      )}
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
            <AnimatedPigeon
              sleeping={sleeping}
              listening={listening}
              thinking={thinking}
              speaking={speaking}
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
    </View>
  )
}

/** 路鸽形象占位，后续替换为精细卡通素材 */
export function LugeCompanion({
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
            <AnimatedPigeon
              sleeping={sleeping}
              listening={listening}
              thinking={thinking}
              speaking={speaking}
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
  pigeonLayers: {
    width: 60,
    height: 60,
    position: 'relative',
  },
  pigeonPivot: {
    position: 'absolute',
    width: 0,
    height: 0,
    overflow: 'visible',
  },
  pigeonHeadPivot: {
    left: 43,
    top: 24,
  },
  pigeonWingPivot: {
    left: 40,
    top: 20,
  },
  pigeonPartImage: {
    position: 'absolute',
    width: 60,
    height: 60,
  },
  pigeonHeadImage: {
    left: -43,
    top: -24,
  },
  pigeonWingImage: {
    left: -40,
    top: -20,
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
})
