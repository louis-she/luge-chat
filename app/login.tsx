import { Redirect, useRouter } from 'expo-router'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useAuth } from '../lib/AuthContext'
import { colors, spacing } from '../lib/theme'

export default function LoginScreen() {
  const router = useRouter()
  const {
    user,
    loggingIn,
    wechatAvailable,
    appleAvailable,
    devLoginAvailable,
    devPersonas,
    error,
    loginWithWechat,
    loginWithApple,
    loginWithDevSandbox,
  } = useAuth()

  if (user) return <Redirect href="/(tabs)" />

  const hasNativeLogin = wechatAvailable || appleAvailable

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Text style={styles.brand}>路鸽</Text>
      <Text style={styles.subtitle}>自驾旅途 · AI 语音导游</Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {appleAvailable ? (
        <Pressable
          style={({ pressed }) => [
            styles.appleBtn,
            pressed && styles.btnPressed,
            loggingIn && styles.btnBusy,
          ]}
          disabled={!!loggingIn}
          onPress={() => loginWithApple().catch(() => {})}
        >
          {loggingIn === 'apple' ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.appleBtnText}>通过 Apple 登录</Text>
          )}
        </Pressable>
      ) : null}

      {wechatAvailable ? (
        <Pressable
          style={({ pressed }) => [
            styles.wechatBtn,
            pressed && styles.btnPressed,
            loggingIn && styles.btnBusy,
          ]}
          disabled={!!loggingIn}
          onPress={() => loginWithWechat().catch(() => {})}
        >
          {loggingIn === 'wechat' ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.wechatBtnText}>微信登录</Text>
          )}
        </Pressable>
      ) : null}

      {devLoginAvailable ? (
        <View style={styles.devSection}>
          <Text style={styles.devTitle}>
            {hasNativeLogin ? '或 · 开发调试' : '开发环境登录'}
          </Text>
          <Text style={styles.devHint}>
            Expo Go 无法调原生登录；模拟器可测 Apple，微信需真机 Dev Build。
          </Text>

          {devPersonas.map((p) => (
            <Pressable
              key={p.persona}
              style={({ pressed }) => [
                styles.devCard,
                pressed && styles.btnPressed,
                loggingIn === p.persona && styles.btnBusy,
              ]}
              disabled={!!loggingIn}
              onPress={() => loginWithDevSandbox(p.persona).catch(() => {})}
            >
              <Text style={styles.devCardTitle}>{p.label}</Text>
              <Text style={styles.devCardTagline}>{p.tagline}</Text>
              {loggingIn === p.persona ? (
                <ActivityIndicator style={styles.spinner} color={colors.accent} />
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}

      {hasNativeLogin ? (
        <Text style={styles.hint}>登录即表示同意用户协议与隐私政策</Text>
      ) : null}

      <Pressable style={styles.guestBtn} onPress={() => router.replace('/(tabs)')}>
        <Text style={styles.guestBtnText}>先逛逛 · 游客试用</Text>
      </Pressable>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    backgroundColor: colors.radarBg,
    padding: spacing.screen,
    paddingTop: 88,
    alignItems: 'center',
  },
  brand: {
    fontSize: 40,
    fontWeight: '700',
    color: colors.radarText,
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    color: colors.radarMuted,
    marginBottom: 32,
  },
  appleBtn: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: '#000',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  appleBtnText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  wechatBtn: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: '#07c160',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    marginBottom: 8,
  },
  wechatBtnText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  devSection: {
    width: '100%',
    maxWidth: 320,
    marginTop: 8,
  },
  devTitle: {
    color: colors.radarMuted,
    fontSize: 13,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 8,
    textAlign: 'center',
  },
  devHint: {
    color: colors.radarMuted,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 16,
  },
  devCard: {
    backgroundColor: colors.radarSurface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.15)',
    width: '100%',
  },
  devCardTitle: {
    color: colors.radarText,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  devCardTagline: {
    color: colors.radarMuted,
    fontSize: 13,
  },
  spinner: { marginTop: 8 },
  btnPressed: { opacity: 0.9 },
  btnBusy: { opacity: 0.75 },
  hint: {
    marginTop: 20,
    color: colors.radarMuted,
    fontSize: 13,
    textAlign: 'center',
    maxWidth: 320,
  },
  guestBtn: {
    marginTop: 24,
    paddingVertical: 12,
  },
  guestBtnText: {
    color: colors.radarText,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  error: {
    color: colors.danger,
    marginBottom: 16,
    textAlign: 'center',
    maxWidth: 320,
  },
})
