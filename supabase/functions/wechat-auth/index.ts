import { createClient } from 'npm:@supabase/supabase-js@2'
import { SignJWT } from 'npm:jose@5'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type PublicUser = {
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

type WechatTokenResponse = {
  access_token?: string
  openid?: string
  unionid?: string
  errcode?: number
  errmsg?: string
}

type WechatUserInfo = {
  nickname?: string
  headimgurl?: string
  unionid?: string
  errcode?: number
  errmsg?: string
}

const WECHAT_APP_ID = Deno.env.get('WECHAT_APP_ID') ?? 'wx670d93537c72d57a'
const WECHAT_APP_SECRET = Deno.env.get('WECHAT_APP_SECRET')
const DB_SCHEMA = Deno.env.get('AUTH_DB_SCHEMA') ?? Deno.env.get('SANDBOX_DB_SCHEMA') ?? 'dev'
const NEW_USER_BONUS_ASKS = Math.max(
  0,
  Number(Deno.env.get('NEW_USER_BONUS_ASKS') ?? '30'),
)

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function adminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: DB_SCHEMA },
    },
  )
}

async function signAuthToken(user: PublicUser) {
  const secret = Deno.env.get('JWT_SECRET')
  if (!secret) throw new Error('JWT_SECRET is not configured')

  return await new SignJWT({
    role: 'authenticated',
    user_id: user.id,
    email: user.email,
    display_name: user.display_name,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(new TextEncoder().encode(secret))
}

async function exchangeCode(code: string) {
  if (!WECHAT_APP_SECRET) {
    throw new Error('WECHAT_APP_SECRET is not configured')
  }

  const url = new URL('https://api.weixin.qq.com/sns/oauth2/access_token')
  url.searchParams.set('appid', WECHAT_APP_ID)
  url.searchParams.set('secret', WECHAT_APP_SECRET)
  url.searchParams.set('code', code)
  url.searchParams.set('grant_type', 'authorization_code')

  const res = await fetch(url)
  const data = (await res.json()) as WechatTokenResponse
  if (data.errcode || !data.openid || !data.access_token) {
    throw new Error(data.errmsg ?? `wechat token error (${data.errcode ?? 'unknown'})`)
  }
  return data
}

async function fetchWechatProfile(accessToken: string, openid: string) {
  const url = new URL('https://api.weixin.qq.com/sns/userinfo')
  url.searchParams.set('access_token', accessToken)
  url.searchParams.set('openid', openid)
  url.searchParams.set('lang', 'zh_CN')

  const res = await fetch(url)
  const data = (await res.json()) as WechatUserInfo
  if (data.errcode) {
    throw new Error(data.errmsg ?? `wechat userinfo error (${data.errcode})`)
  }
  return data
}

function toSessionUser(user: {
  id: string
  email: string | null
  display_name: string | null
  avatar_url: string | null
  platform: string
  billing_mode: string
  vip_expire_at: string | null
  balance_minutes: number
  balance_asks?: number
}): PublicUser {
  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    avatar_url: user.avatar_url,
    platform: user.platform,
    billing_mode: user.billing_mode,
    vip_expire_at: user.vip_expire_at,
    balance_minutes: Number(user.balance_minutes),
    balance_asks: Number(user.balance_asks ?? 0),
  }
}

async function findUser(openid: string, unionid?: string) {
  const supabase = adminClient()

  if (unionid) {
    const { data, error } = await supabase
      .from('users')
      .select('id, email, display_name, avatar_url, platform, billing_mode, vip_expire_at, balance_minutes, balance_asks, wechat_open_id, wechat_union_id')
      .eq('wechat_union_id', unionid)
      .maybeSingle()
    if (error) throw error
    if (data) return data
  }

  const { data, error } = await supabase
    .from('users')
    .select('id, email, display_name, avatar_url, platform, billing_mode, vip_expire_at, balance_minutes, balance_asks, wechat_open_id, wechat_union_id')
    .eq('wechat_open_id', openid)
    .maybeSingle()
  if (error) throw error
  return data
}

async function upsertWechatUser(params: {
  openid: string
  unionid?: string
  platform: 'ios' | 'android'
  nickname?: string
  avatarUrl?: string
}) {
  const supabase = adminClient()
  const existing = await findUser(params.openid, params.unionid)

  if (existing) {
    const patch: Record<string, unknown> = {}
    if (params.unionid && !existing.wechat_union_id) patch.wechat_union_id = params.unionid
    if (params.nickname && !existing.display_name) patch.display_name = params.nickname
    if (params.avatarUrl && !existing.avatar_url) patch.avatar_url = params.avatarUrl
    if (existing.platform === 'unknown') patch.platform = params.platform

    if (Object.keys(patch).length > 0) {
      const { data, error } = await supabase
        .from('users')
        .update(patch)
        .eq('id', existing.id)
        .select('id, email, display_name, avatar_url, platform, billing_mode, vip_expire_at, balance_minutes, balance_asks')
        .single()
      if (error) throw error
      return data
    }

    const { id, email, display_name, avatar_url, platform, billing_mode, vip_expire_at, balance_minutes, balance_asks } = existing
    return { id, email, display_name, avatar_url, platform, billing_mode, vip_expire_at, balance_minutes, balance_asks: balance_asks ?? 0 }
  }

  const { data, error } = await supabase
    .from('users')
    .insert({
      wechat_open_id: params.openid,
      wechat_union_id: params.unionid ?? null,
      display_name: params.nickname ?? '微信用户',
      avatar_url: params.avatarUrl ?? null,
      platform: params.platform,
      billing_mode: 'pay_per_minute',
      balance_minutes: 0,
      balance_asks: NEW_USER_BONUS_ASKS,
      metadata: { signup_via: 'wechat' },
    })
    .select('id, email, display_name, avatar_url, platform, billing_mode, vip_expire_at, balance_minutes, balance_asks')
    .single()

  if (error) throw error
  return data
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json({ error: 'method not allowed' }, 405)
  }

  try {
    const body = await req.json()
    const code = body?.code as string | undefined
    const platform = body?.platform as 'ios' | 'android' | undefined

    if (!code) return json({ error: 'code is required' }, 400)
    if (platform !== 'ios' && platform !== 'android') {
      return json({ error: 'platform must be ios or android' }, 400)
    }

    const token = await exchangeCode(code)
    const profile = await fetchWechatProfile(token.access_token!, token.openid!)
    const unionid = profile.unionid ?? token.unionid

    const user = await upsertWechatUser({
      openid: token.openid!,
      unionid,
      platform,
      nickname: profile.nickname,
      avatarUrl: profile.headimgurl,
    })

    const access_token = await signAuthToken(toSessionUser(user))
    const expires_at = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

    return json({
      access_token,
      expires_at,
      token_type: 'bearer',
      user: toSessionUser(user),
    })
  } catch (err) {
    console.error('wechat-auth error:', err)
    const message = err instanceof Error ? err.message : 'internal error'
    return json({ error: message }, 500)
  }
})
