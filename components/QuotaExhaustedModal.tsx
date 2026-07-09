import { useRouter } from 'expo-router'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useQuota } from '../lib/QuotaContext'
import { colors, spacing } from '../lib/theme'

export function QuotaExhaustedModal() {
  const router = useRouter()
  const { exhausted, clearExhausted } = useQuota()
  if (!exhausted) return null

  const isGuest = exhausted.tier === 'guest'

  return (
    <Modal visible transparent animationType="fade" onRequestClose={clearExhausted}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>
            {isGuest ? '体验次数已用完' : '问路次数已用完'}
          </Text>
          <Text style={styles.body}>
            {isGuest
              ? `注册后可领取 ${exhausted.register_bonus} 次问路，并保存足迹与旅途回忆。`
              : '购买次数包后可继续向路鸽提问。包天套餐即将推出。'}
          </Text>

          {isGuest ? (
            <Pressable
              style={styles.primaryBtn}
              onPress={() => {
                clearExhausted()
                router.push('/login')
              }}
            >
              <Text style={styles.primaryText}>微信登录 / 注册</Text>
            </Pressable>
          ) : (
            <Pressable
              style={styles.primaryBtn}
              onPress={() => {
                clearExhausted()
                router.push('/pay?from=exhausted')
              }}
            >
              <Text style={styles.primaryText}>查看次数包</Text>
            </Pressable>
          )}

          <Pressable style={styles.secondaryBtn} onPress={clearExhausted}>
            <Text style={styles.secondaryText}>稍后再说</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.screen,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 22,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.lightText,
    marginBottom: 10,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.lightMuted,
    marginBottom: 20,
  },
  primaryBtn: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryBtn: {
    marginTop: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  secondaryText: {
    color: colors.lightMuted,
    fontSize: 14,
  },
})
