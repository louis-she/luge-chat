import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useEffect } from 'react'
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { TtsVoicePicker } from '../../components/TtsVoicePicker'
import { ProactiveGuideSettings } from '../../components/ProactiveGuideSettings'
import { useAuth } from '../../lib/AuthContext'
import { formatBilling } from '../../lib/auth'
import { formatQuotaLabel } from '../../lib/quota'
import { useQuota } from '../../lib/QuotaContext'
import { colors, spacing } from '../../lib/theme'

export default function ProfileScreen() {
  const router = useRouter()
  const { user, logout, patchBalanceAsks } = useAuth()
  const { quota, loading: quotaLoading, refreshQuota } = useQuota()

  useFocusEffect(
    useCallback(() => {
      void refreshQuota()
    }, [refreshQuota]),
  )

  useEffect(() => {
    if (!user || !quota || quota.tier !== 'user') return
    if (user.balance_asks === quota.remaining) return
    void patchBalanceAsks(quota.remaining)
  }, [user, quota, patchBalanceAsks])

  const quotaCardLabel =
    quotaLoading && !quota
      ? '加载中…'
      : quota
        ? formatQuotaLabel(quota)
        : user
          ? `${user.balance_asks} 次`
          : '—'

  if (!user) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.title}>我的</Text>
          <View style={styles.guestCard}>
            <Text style={styles.guestTitle}>游客模式</Text>
            <Text style={styles.guestDesc}>
              {quota ? formatQuotaLabel(quota) : '加载中…'}
              {'\n'}
              登录可领取注册礼包、保存足迹，并购买次数包。
            </Text>
            <Pressable style={styles.loginBtn} onPress={() => router.push('/login')}>
              <Text style={styles.loginBtnText}>登录 / 注册</Text>
            </Pressable>
          </View>
          <TtsVoicePicker />
          <ProactiveGuideSettings />
          <Pressable style={styles.devCard} onPress={() => router.push('/advanced-settings')}>
            <Text style={styles.devTitle}>高级设置</Text>
            <Text style={styles.devDesc}>门槛、口播长短、路测工具（改完立即生效）</Text>
          </Pressable>
          <Pressable style={styles.devCard} onPress={() => router.push('/proactive-guide-map')}>
            <Text style={styles.devTitle}>主动讲解地图</Text>
            <Text style={styles.devDesc}>查看当前位置可能主动播报的候选点</Text>
          </Pressable>
          <Pressable style={styles.devCard} onPress={() => router.push('/rtc-spike')}>
            <Text style={styles.devTitle}>RTC 语音通话测试</Text>
            <Text style={styles.devDesc}>方案甲 V2 · 进房 + 火山 AI 对话</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    )
  }

  const isVip = user.billing_mode === 'vip'

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>个人中心</Text>

        <View style={styles.userCard}>
          <View style={styles.avatar}>
            {user.avatar_url ? (
              <Image source={{ uri: user.avatar_url }} style={styles.avatarImage} />
            ) : (
              <Text style={styles.avatarText}>
                {(user.display_name ?? '路').slice(0, 1)}
              </Text>
            )}
          </View>
          <View style={styles.userInfo}>
            <Text style={styles.name}>{user.display_name ?? '微信用户'}</Text>
            <Text style={styles.billing}>{formatBilling(user)}</Text>
          </View>
        </View>

        <Pressable style={styles.quotaCard} onPress={() => router.push('/pay')}>
          <Text style={styles.quotaTitle}>问路次数</Text>
          <Text style={styles.quotaValue}>{quotaCardLabel}</Text>
          <Text style={styles.quotaAction}>购买次数包 →</Text>
        </Pressable>

        <Pressable style={styles.vipCard} onPress={() => router.push('/pay')}>
          <Text style={styles.vipTitle}>会员与套餐</Text>
          <Text style={styles.vipDesc}>
            {isVip
              ? '您已是 VIP · 包天畅聊即将推出'
              : '按次计费，后续支持包天与会员订阅'}
          </Text>
          <Text style={styles.vipAction}>查看套餐 →</Text>
        </Pressable>

        <TtsVoicePicker />
        <ProactiveGuideSettings />

        <Pressable style={styles.devCard} onPress={() => router.push('/advanced-settings')}>
          <Text style={styles.devTitle}>高级设置</Text>
          <Text style={styles.devDesc}>门槛、口播长短、路测工具（改完立即生效）</Text>
        </Pressable>

        <Pressable style={styles.devCard} onPress={() => router.push('/proactive-guide-map')}>
          <Text style={styles.devTitle}>主动讲解地图</Text>
          <Text style={styles.devDesc}>查看当前位置可能主动播报的候选点</Text>
        </Pressable>

        <Pressable style={styles.devCard} onPress={() => router.push('/rtc-spike')}>
          <Text style={styles.devTitle}>RTC 语音通话测试</Text>
          <Text style={styles.devDesc}>方案甲 V2 · 进房 + 火山 AI 对话</Text>
        </Pressable>

        <Pressable style={styles.logoutBtn} onPress={logout}>
          <Text style={styles.logoutText}>退出登录</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.lightBg },
  scroll: {
    padding: spacing.screen,
    paddingBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.lightText,
    marginBottom: 20,
  },
  guestCard: {
    backgroundColor: colors.lightCard,
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: '#e8edf4',
  },
  guestTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.lightText,
    marginBottom: 8,
  },
  guestDesc: {
    color: colors.lightMuted,
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 16,
  },
  loginBtn: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  loginBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.lightCard,
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e8edf4',
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#dbeafe',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: { width: 56, height: 56 },
  avatarText: { fontSize: 22, fontWeight: '700', color: '#1d4ed8' },
  userInfo: { marginLeft: 14, flex: 1 },
  name: { fontSize: 18, fontWeight: '700', color: colors.lightText },
  billing: { marginTop: 4, color: colors.lightMuted, fontSize: 14 },
  quotaCard: {
    backgroundColor: '#0f172a',
    borderRadius: 18,
    padding: 18,
    marginBottom: 16,
  },
  quotaTitle: { color: '#94a3b8', fontSize: 13 },
  quotaValue: {
    marginTop: 6,
    color: '#f8fafc',
    fontSize: 28,
    fontWeight: '800',
  },
  quotaAction: {
    marginTop: 10,
    color: '#60a5fa',
    fontSize: 14,
    fontWeight: '600',
  },
  vipCard: {
    backgroundColor: colors.lightCard,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: '#dbeafe',
    marginBottom: 20,
  },
  vipTitle: { fontSize: 17, fontWeight: '700', color: colors.lightText },
  vipDesc: {
    marginTop: 8,
    color: colors.lightMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  vipAction: {
    marginTop: 12,
    color: colors.accent,
    fontSize: 14,
    fontWeight: '700',
  },
  logoutBtn: {
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#111827',
  },
  logoutText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  devCard: {
    marginTop: 16,
    marginBottom: 16,
    backgroundColor: '#fff7ed',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#fed7aa',
  },
  devTitle: { fontSize: 16, fontWeight: '700', color: '#9a3412' },
  devDesc: { marginTop: 6, fontSize: 13, color: '#c2410c', lineHeight: 18 },
})
