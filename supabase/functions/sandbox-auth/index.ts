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
  platform: string
  billing_mode: string
  vip_expire_at: string | null
  balance_minutes: number
  balance_asks: number
  metadata: Record<string, unknown>
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const DB_SCHEMA = Deno.env.get('SANDBOX_DB_SCHEMA') ?? 'dev'

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

async function signSandboxToken(user: PublicUser) {
  const secret = Deno.env.get('JWT_SECRET')
  if (!secret) throw new Error('JWT_SECRET is not configured')

  return await new SignJWT({
    role: 'authenticated',
    user_id: user.id,
    email: user.email,
    display_name: user.display_name,
    sandbox: true,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(new TextEncoder().encode(secret))
}

async function listSandboxUsers() {
  const supabase = adminClient()
  const { data, error } = await supabase
    .from('users')
    .select('display_name, billing_mode, balance_minutes, vip_expire_at, metadata')
    .like('email', 'sandbox.%@luge.chat')
    .order('email')

  if (error) throw error

  return (data ?? []).map((user) => {
    const meta = (user.metadata ?? {}) as Record<string, string>
    return {
      persona: meta.sandbox_persona,
      label: user.display_name,
      tagline: meta.tagline ?? '',
      billing_mode: user.billing_mode,
      balance_minutes: user.balance_minutes,
      vip_expire_at: user.vip_expire_at,
    }
  })
}

async function login(persona: string) {
  const supabase = adminClient()
  const { data: users, error } = await supabase
    .from('users')
    .select('id, email, display_name, platform, billing_mode, vip_expire_at, balance_minutes, balance_asks, metadata')
    .like('email', 'sandbox.%@luge.chat')

  if (error) throw error

  const user = (users ?? []).find((u) => {
    const meta = (u.metadata ?? {}) as Record<string, string>
    return meta.sandbox_persona === persona
  })

  if (!user) {
    return json({ error: `unknown sandbox persona: ${persona}` }, 404)
  }

  const access_token = await signSandboxToken(user as PublicUser)
  const expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  return json({
    access_token,
    expires_at,
    token_type: 'bearer',
    user: {
      id: user.id,
      email: user.email,
      display_name: user.display_name,
      platform: user.platform,
      billing_mode: user.billing_mode,
      vip_expire_at: user.vip_expire_at,
      balance_minutes: user.balance_minutes,
      balance_asks: user.balance_asks ?? 0,
      persona,
    },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (req.method === 'GET') {
      const personas = await listSandboxUsers()
      return json({ personas })
    }

    if (req.method === 'POST') {
      const body = await req.json()
      const persona = body?.persona as string | undefined
      if (!persona) return json({ error: 'persona is required' }, 400)
      return await login(persona)
    }

    return json({ error: 'method not allowed' }, 405)
  } catch (err) {
    console.error('sandbox-auth error:', err)
    const message = err instanceof Error ? err.message : 'internal error'
    return json({ error: message }, 500)
  }
})
