import { createClient } from 'npm:@supabase/supabase-js@2'
import { createRemoteJWKSet, jwtVerify, SignJWT } from 'npm:jose@5'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const APPLE_ISSUER = 'https://appleid.apple.com'
const APPLE_AUDIENCE =
  Deno.env.get('APPLE_BUNDLE_ID') ?? 'com.shexiaoshu.lugechat'
const DB_SCHEMA = Deno.env.get('AUTH_DB_SCHEMA') ?? Deno.env.get('SANDBOX_DB_SCHEMA') ?? 'dev'
const NEW_USER_BONUS_ASKS = Math.max(
  0,
  Number(Deno.env.get('NEW_USER_BONUS_ASKS') ?? '30'),
)

const appleJwks = createRemoteJWKSet(new URL(`${APPLE_ISSUER}/auth/keys`))

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

async function verifyAppleIdentityToken(identityToken: string) {
  const { payload } = await jwtVerify(identityToken, appleJwks, {
    issuer: APPLE_ISSUER,
    audience: APPLE_AUDIENCE,
  })

  const appleUserId = typeof payload.sub === 'string' ? payload.sub : null
  if (!appleUserId) throw new Error('invalid Apple token: missing sub')

  const email = typeof payload.email === 'string' ? payload.email : null
  return { appleUserId, email }
}

async function findUserByAppleId(appleUserId: string) {
  const supabase = adminClient()
  const { data, error } = await supabase
    .from('users')
    .select(
      'id, email, display_name, avatar_url, platform, billing_mode, vip_expire_at, balance_minutes, balance_asks, apple_user_id',
    )
    .eq('apple_user_id', appleUserId)
    .maybeSingle()
  if (error) throw error
  return data
}

async function upsertAppleUser(params: {
  appleUserId: string
  email: string | null
  displayName: string | null
}) {
  const supabase = adminClient()
  const existing = await findUserByAppleId(params.appleUserId)

  if (existing) {
    const patch: Record<string, unknown> = {}
    if (params.email && !existing.email) patch.email = params.email
    if (params.displayName && !existing.display_name) {
      patch.display_name = params.displayName
    }
    if (existing.platform === 'unknown') patch.platform = 'ios'

    if (Object.keys(patch).length > 0) {
      const { data, error } = await supabase
        .from('users')
        .update(patch)
        .eq('id', existing.id)
        .select(
          'id, email, display_name, avatar_url, platform, billing_mode, vip_expire_at, balance_minutes, balance_asks',
        )
        .single()
      if (error) throw error
      return data
    }

    const {
      id,
      email,
      display_name,
      avatar_url,
      platform,
      billing_mode,
      vip_expire_at,
      balance_minutes,
      balance_asks,
    } = existing
    return {
      id,
      email,
      display_name,
      avatar_url,
      platform,
      billing_mode,
      vip_expire_at,
      balance_minutes,
      balance_asks: balance_asks ?? 0,
    }
  }

  const { data, error } = await supabase
    .from('users')
    .insert({
      apple_user_id: params.appleUserId,
      email: params.email,
      display_name: params.displayName ?? 'Apple 用户',
      platform: 'ios',
      billing_mode: 'pay_per_minute',
      balance_minutes: 0,
      balance_asks: NEW_USER_BONUS_ASKS,
      metadata: { signup_via: 'apple' },
    })
    .select(
      'id, email, display_name, avatar_url, platform, billing_mode, vip_expire_at, balance_minutes, balance_asks',
    )
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
    const identityToken = body?.identity_token as string | undefined
    const fullName = (body?.full_name as string | undefined)?.trim() || null
    const clientEmail = (body?.email as string | undefined)?.trim() || null

    if (!identityToken) return json({ error: 'identity_token is required' }, 400)

    const verified = await verifyAppleIdentityToken(identityToken)
    const user = await upsertAppleUser({
      appleUserId: verified.appleUserId,
      email: verified.email ?? clientEmail,
      displayName: fullName,
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
    console.error('apple-auth error:', err)
    const message = err instanceof Error ? err.message : 'internal error'
    return json({ error: message }, 500)
  }
})
