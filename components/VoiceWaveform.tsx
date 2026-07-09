import { useEffect, useRef } from 'react'
import { Animated, StyleSheet, View } from 'react-native'
import { colors } from '../lib/theme'

type Props = {
  active: boolean
  /** 嵌入路鸽头像时使用 */
  compact?: boolean
  color?: string
}

export function VoiceWaveform({
  active,
  compact = false,
  color = colors.accent,
}: Props) {
  const barCount = compact ? 7 : 12
  const bars = useRef(
    Array.from({ length: barCount }, () => new Animated.Value(0.3)),
  ).current

  useEffect(() => {
    if (!active) {
      bars.forEach((b) => b.setValue(0.2))
      return
    }

    const animations = bars.map((bar, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(bar, {
            toValue: 0.35 + Math.random() * 0.65,
            duration: 280 + index * 30,
            useNativeDriver: false,
          }),
          Animated.timing(bar, {
            toValue: 0.15 + Math.random() * 0.25,
            duration: 280 + index * 20,
            useNativeDriver: false,
          }),
        ]),
      ),
    )

    animations.forEach((a) => a.start())
    return () => animations.forEach((a) => a.stop())
  }, [active, bars])

  const minH = compact ? 6 : 8
  const maxH = compact ? 28 : 44

  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]}>
      {bars.map((bar, i) => (
        <Animated.View
          key={i}
          style={[
            styles.bar,
            compact && styles.barCompact,
            {
              backgroundColor: color,
              height: bar.interpolate({
                inputRange: [0, 1],
                outputRange: [minH, maxH],
              }),
            },
          ]}
        />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 4,
    height: 48,
  },
  wrapCompact: {
    gap: 2,
    height: 32,
  },
  bar: {
    width: 4,
    borderRadius: 2,
  },
  barCompact: {
    width: 3,
    borderRadius: 1.5,
  },
})
