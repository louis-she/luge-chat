export type AuthUser = {
  id: string
  email: string | null
  display_name: string | null
  avatar_url: string | null
  platform: string
  billing_mode: string
  vip_expire_at: string | null
  balance_minutes: number
  balance_asks: number
}

export type AuthSession = {
  access_token: string
  expires_at: string
  token_type: string
  user: AuthUser
}

/** 仅 __DEV__ 沙盒登录用 */
export type DevSandboxPersona = {
  persona: string
  label: string | null
  tagline: string
}
