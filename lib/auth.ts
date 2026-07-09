import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import { requestAppleCredential } from './apple'
import { SESSION_STORAGE_KEY, SUPABASE_ANON_KEY, SUPABASE_URL } from './config'
import type { AuthSession, AuthUser, DevSandboxPersona } from './types'
import { requestWechatAuthCode } from './wechat'

function functionHeaders() {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
  }
}

export async function loginWithWechat(): Promise<AuthSession> {
  const code = await requestWechatAuthCode()
  const platform = Platform.OS === 'ios' ? 'ios' : 'android'

  const res = await fetch(`${SUPABASE_URL}/functions/v1/wechat-auth`, {
    method: 'POST',
    headers: functionHeaders(),
    body: JSON.stringify({ code, platform }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg =
      (typeof data.error === 'string' && data.error) ||
      (typeof data.msg === 'string' && data.msg) ||
      '微信登录失败'
    throw new Error(msg)
  }

  return data as AuthSession
}

export async function loginWithApple(): Promise<AuthSession> {
  const credential = await requestAppleCredential()

  const res = await fetch(`${SUPABASE_URL}/functions/v1/apple-auth`, {
    method: 'POST',
    headers: functionHeaders(),
    body: JSON.stringify({
      identity_token: credential.identityToken,
      full_name: credential.fullName,
      email: credential.email,
    }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg =
      (typeof data.error === 'string' && data.error) ||
      (typeof data.msg === 'string' && data.msg) ||
      'Apple 登录失败'
    throw new Error(msg)
  }

  return data as AuthSession
}

/** 开发环境沙盒登录（Expo Go / 模拟器），Release 构建中不可用 */
export async function fetchDevSandboxPersonas(): Promise<DevSandboxPersona[]> {
  if (!__DEV__) return []

  const res = await fetch(`${SUPABASE_URL}/functions/v1/sandbox-auth`, {
    headers: functionHeaders(),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg =
      (typeof data.error === 'string' && data.error) ||
      (typeof data.msg === 'string' && data.msg) ||
      '加载开发角色失败'
    throw new Error(msg)
  }
  return (data.personas ?? []) as DevSandboxPersona[]
}

export async function loginWithDevSandbox(persona: string): Promise<AuthSession> {
  if (!__DEV__) throw new Error('开发登录仅用于本地调试')

  const res = await fetch(`${SUPABASE_URL}/functions/v1/sandbox-auth`, {
    method: 'POST',
    headers: functionHeaders(),
    body: JSON.stringify({ persona }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg =
      (typeof data.error === 'string' && data.error) ||
      (typeof data.msg === 'string' && data.msg) ||
      '开发登录失败'
    throw new Error(msg)
  }

  const raw = data as {
    access_token: string
    expires_at: string
    token_type: string
    user: AuthUser & { persona?: string; balance_asks?: number }
  }

  const { persona: _persona, ...user } = raw.user
  return {
    access_token: raw.access_token,
    expires_at: raw.expires_at,
    token_type: raw.token_type,
    user: {
      ...user,
      avatar_url: user.avatar_url ?? null,
      balance_asks: user.balance_asks ?? 0,
    },
  }
}

export async function saveSession(session: AuthSession) {
  await SecureStore.setItemAsync(SESSION_STORAGE_KEY, JSON.stringify(session))
}

export async function loadSession(): Promise<AuthSession | null> {
  const raw = await SecureStore.getItemAsync(SESSION_STORAGE_KEY)
  if (!raw) return null
  const session = JSON.parse(raw) as AuthSession
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    await clearSession()
    return null
  }
  return session
}

export async function clearSession() {
  await SecureStore.deleteItemAsync(SESSION_STORAGE_KEY)
}

export function formatBilling(user: AuthUser) {
  if (user.billing_mode === 'vip') {
    const expire = user.vip_expire_at
      ? new Date(user.vip_expire_at).toLocaleDateString('zh-CN')
      : '未知'
    return `VIP 会员 · 至 ${expire}`
  }
  return `剩余 ${user.balance_asks} 次问路`
}
