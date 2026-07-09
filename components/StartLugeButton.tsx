import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { RadarPulse } from './RadarPulse'
import { colors } from '../lib/theme'

type Props = {
  active: boolean
  onPress: () => void
}

const pigeonImage = require('../assets/luge-pigeon.png')

export function StartLugeButton({ active, onPress }: Props) {
  return (
    <View style={styles.wrap}>
      <RadarPulse active={active} />
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.button,
          active && styles.buttonActive,
          pressed && styles.buttonPressed,
        ]}
      >
        <Image source={pigeonImage} style={styles.pigeon} resizeMode="contain" />
        <View style={styles.textBlock}>
          <Text style={styles.label}>{active ? '路鸽运行中' : '开始路鸽'}</Text>
          <Text style={styles.hint}>{active ? '点击暂停' : '一键启动'}</Text>
        </View>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 240,
    height: 240,
  },
  button: {
    width: 196,
    height: 196,
    borderRadius: 98,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#152238',
    borderWidth: 2,
    borderColor: colors.radarGlowSoft,
    shadowColor: colors.radarGlow,
    shadowOpacity: 0.45,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
    paddingTop: 14,
    paddingBottom: 18,
  },
  buttonActive: {
    backgroundColor: '#1a2f52',
    borderColor: colors.radarGlow,
  },
  buttonPressed: {
    transform: [{ scale: 0.98 }],
  },
  pigeon: {
    width: 108,
    height: 108,
    marginBottom: 8,
  },
  textBlock: {
    alignItems: 'center',
  },
  label: {
    color: colors.radarText,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 1,
    textAlign: 'center',
  },
  hint: {
    marginTop: 6,
    color: colors.radarMuted,
    fontSize: 13,
    textAlign: 'center',
  },
})
