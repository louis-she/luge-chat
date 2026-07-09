import { useEffect, useRef } from 'react'
import { Animated, Easing, StyleSheet, View } from 'react-native'
import { colors } from '../lib/theme'

type Props = {
  active: boolean
  size?: number
}

export function RadarPulse({ active, size = 220 }: Props) {
  const ring1 = useRef(new Animated.Value(0)).current
  const ring2 = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!active) {
      ring1.setValue(0)
      ring2.setValue(0)
      return
    }

    const loop = (value: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(value, {
            toValue: 1,
            duration: 2200,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(value, {
            toValue: 0,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
      )

    const a1 = loop(ring1, 0)
    const a2 = loop(ring2, 700)
    a1.start()
    a2.start()
    return () => {
      a1.stop()
      a2.stop()
    }
  }, [active, ring1, ring2])

  const makeStyle = (value: Animated.Value) => ({
    opacity: value.interpolate({
      inputRange: [0, 1],
      outputRange: [0.55, 0],
    }),
    transform: [
      {
        scale: value.interpolate({
          inputRange: [0, 1],
          outputRange: [0.75, 1.45],
        }),
      },
    ],
  })

  if (!active) return null

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Animated.View
        style={[
          styles.ring,
          { width: size, height: size, borderRadius: size / 2 },
          makeStyle(ring1),
        ]}
      />
      <Animated.View
        style={[
          styles.ring,
          { width: size, height: size, borderRadius: size / 2 },
          makeStyle(ring2),
        ]}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: colors.radarGlow,
  },
})
