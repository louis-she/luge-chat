import { Ionicons } from '@expo/vector-icons'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTtsVoice } from '../lib/TtsVoiceContext'
import { colors, spacing } from '../lib/theme'

export function TtsVoicePicker() {
  const { speakerId, voices, setSpeakerId } = useTtsVoice()

  return (
    <View style={styles.card}>
      <Text style={styles.title}>路鸽声音</Text>
      <Text style={styles.desc}>豆包语音 2.0 · 切换后下次讲解生效</Text>
      <View style={styles.list}>
        {voices.map((voice) => {
          const selected = voice.id === speakerId
          return (
            <Pressable
              key={voice.id}
              onPress={() => void setSpeakerId(voice.id)}
              style={({ pressed }) => [
                styles.row,
                selected && styles.rowSelected,
                pressed && styles.rowPressed,
              ]}
            >
              <View style={styles.rowText}>
                <Text style={[styles.rowLabel, selected && styles.rowLabelSelected]}>
                  {voice.label}
                </Text>
                <Text style={styles.rowDesc}>{voice.desc}</Text>
              </View>
              {selected ? (
                <Ionicons name="checkmark-circle" size={22} color={colors.accent} />
              ) : (
                <View style={styles.radio} />
              )}
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.lightCard,
    borderRadius: 18,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e8edf4',
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.lightText,
  },
  desc: {
    marginTop: 6,
    fontSize: 13,
    color: colors.lightMuted,
    lineHeight: 18,
  },
  list: {
    marginTop: 14,
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#eef2f7',
  },
  rowSelected: {
    backgroundColor: '#eff6ff',
    borderColor: '#bfdbfe',
  },
  rowPressed: {
    opacity: 0.9,
  },
  rowText: {
    flex: 1,
    marginRight: 10,
  },
  rowLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.lightText,
  },
  rowLabelSelected: {
    color: '#1d4ed8',
  },
  rowDesc: {
    marginTop: 2,
    fontSize: 13,
    color: colors.lightMuted,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#cbd5e1',
  },
})
