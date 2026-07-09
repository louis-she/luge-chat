import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useAuth } from '../lib/AuthContext'
import { loadSession } from '../lib/auth'
import { useQuota } from '../lib/QuotaContext'
import {
  ASK_PACKAGES,
  formatQuotaLabel,
  purchaseAskPackage,
  type AskPackageId,
} from '../lib/quota'
import { colors, spacing } from '../lib/theme'

const DAY_PASS = {
  id: 'day_pass',
  title: '包天畅聊',
  price: '¥19.9',
  desc: '24 小时内不限次数（即将推出）',
  badge: '敬请期待',
} as const

export default function PayScreen() {
  const router = useRouter()
  const { from } = useLocalSearchParams<{ from?: string }>()
  const { user, patchBalanceAsks } = useAuth()
  const { quota, loading: quotaLoading, refreshQuota } = useQuota()
  const [buyingId, setBuyingId] = useState<AskPackageId | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastPurchased, setLastPurchased] = useState<AskPackageId | null>(null)

  const fromExhausted = from === 'exhausted'

  useFocusEffect(
    useCallback(() => {
      void refreshQuota()
    }, [refreshQuota]),
  )

  const handlePurchase = useCallback(
    async (packageId: AskPackageId) => {
      if (buyingId) return
      setError(null)
      setBuyingId(packageId)
      try {
        const session = await loadSession()
        if (!session?.access_token) {
          setError('请先登录后再购买')
          return
        }
        const result = await purchaseAskPackage(session.access_token, packageId)
        setLastPurchased(packageId)
        await refreshQuota()
        await patchBalanceAsks(result.remaining)
      } catch (e) {
        setError(e instanceof Error ? e.message : '购买失败')
      } finally {
        setBuyingId(null)
      }
    },
    [buyingId, patchBalanceAsks, refreshQuota],
  )

  const quotaLabel = quotaLoading
    ? '加载中…'
    : quota
      ? formatQuotaLabel(quota)
      : '—'

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backText}>← 返回</Text>
        </Pressable>

        {fromExhausted ? (
          <View style={styles.banner}>
            <Text style={styles.bannerTitle}>问路次数已用完</Text>
            <Text style={styles.bannerBody}>购买次数包后可继续向路鸽提问</Text>
          </View>
        ) : null}

        <Text style={styles.title}>购买问路次数</Text>
        <Text style={styles.subtitle}>
          按次计费，问一次扣一次。购买后次数立即到账。
        </Text>

        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>当前剩余</Text>
          <Text style={styles.balanceValue}>{quotaLabel}</Text>
        </View>

        {!user ? (
          <View style={styles.hintCard}>
            <Text style={styles.hintText}>登录后可购买并同步到账号</Text>
            <Pressable style={styles.hintBtn} onPress={() => router.push('/login')}>
              <Text style={styles.hintBtnText}>去登录</Text>
            </Pressable>
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {lastPurchased ? (
          <View style={styles.successCard}>
            <Text style={styles.successTitle}>购买成功</Text>
            <Text style={styles.successBody}>
              已充值 {ASK_PACKAGES[lastPurchased].asks} 次，当前 {quotaLabel}
            </Text>
            <Pressable style={styles.continueBtn} onPress={() => router.back()}>
              <Text style={styles.continueBtnText}>继续问路</Text>
            </Pressable>
          </View>
        ) : null}

        {Object.values(ASK_PACKAGES).map((pkg) => {
          const busy = buyingId === pkg.id
          const disabled = !user || buyingId !== null
          return (
            <View key={pkg.id} style={styles.packCard}>
              <View style={styles.packHead}>
                <Text style={styles.packTitle}>{pkg.title}</Text>
                {pkg.badge ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{pkg.badge}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.packPrice}>{pkg.price}</Text>
              <Text style={styles.packDesc}>{pkg.desc}</Text>
              <Pressable
                style={[styles.buyBtn, disabled && styles.buyBtnDisabled]}
                disabled={disabled}
                onPress={() => void handlePurchase(pkg.id)}
              >
                {busy ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.buyBtnText}>
                    {user ? '立即购买' : '登录后购买'}
                  </Text>
                )}
              </Pressable>
            </View>
          )
        })}

        <View style={styles.packCard}>
          <View style={styles.packHead}>
            <Text style={styles.packTitle}>{DAY_PASS.title}</Text>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{DAY_PASS.badge}</Text>
            </View>
          </View>
          <Text style={styles.packPrice}>{DAY_PASS.price}</Text>
          <Text style={styles.packDesc}>{DAY_PASS.desc}</Text>
          <Pressable style={[styles.buyBtn, styles.buyBtnDisabled]} disabled>
            <Text style={styles.buyBtnText}>即将上线</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.lightBg },
  scroll: { padding: spacing.screen, paddingBottom: 40 },
  back: { marginBottom: 12 },
  backText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
  banner: {
    backgroundColor: '#fff7ed',
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#fed7aa',
  },
  bannerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#9a3412',
    marginBottom: 4,
  },
  bannerBody: {
    fontSize: 14,
    lineHeight: 20,
    color: '#c2410c',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.lightText,
  },
  subtitle: {
    marginTop: 8,
    marginBottom: 16,
    color: colors.lightMuted,
    fontSize: 15,
    lineHeight: 22,
  },
  balanceCard: {
    backgroundColor: '#0f172a',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  balanceLabel: { color: '#94a3b8', fontSize: 13 },
  balanceValue: {
    marginTop: 6,
    color: '#f8fafc',
    fontSize: 24,
    fontWeight: '800',
  },
  hintCard: {
    backgroundColor: '#eff6ff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    gap: 10,
  },
  hintText: { color: '#1d4ed8', fontSize: 14 },
  hintBtn: {
    alignSelf: 'flex-start',
    backgroundColor: colors.accent,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  hintBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  error: {
    color: '#dc2626',
    fontSize: 14,
    marginBottom: 12,
    lineHeight: 20,
  },
  successCard: {
    backgroundColor: '#ecfdf5',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  successTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#065f46',
    marginBottom: 6,
  },
  successBody: {
    fontSize: 14,
    lineHeight: 20,
    color: '#047857',
    marginBottom: 12,
  },
  continueBtn: {
    backgroundColor: '#059669',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  continueBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  packCard: {
    backgroundColor: colors.lightCard,
    borderRadius: 16,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#e8edf4',
  },
  packHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  packTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.lightText,
  },
  badge: {
    backgroundColor: '#dbeafe',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeText: { color: '#1d4ed8', fontSize: 11, fontWeight: '700' },
  packPrice: {
    marginTop: 8,
    fontSize: 24,
    fontWeight: '800',
    color: colors.accent,
  },
  packDesc: {
    marginTop: 6,
    color: colors.lightMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  buyBtn: {
    marginTop: 14,
    backgroundColor: '#111827',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  buyBtnDisabled: { backgroundColor: '#94a3b8' },
  buyBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
})
