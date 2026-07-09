import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { jwtVerify } from 'npm:jose@5'

const DB_SCHEMA = Deno.env.get('AUTH_DB_SCHEMA') ?? Deno.env.get('SANDBOX_DB_SCHEMA') ?? 'dev'

export function quotaConfig() {
  return {
    guestFreeAsks: Math.max(0, Number(Deno.env.get('GUEST_FREE_ASKS') ?? '3')),
    newUserBonusAsks: Math.max(0, Number(Deno.env.get('NEW_USER_BONUS_ASKS') ?? '30')),
  }
}

export type QuotaTier = 'guest' | 'user' | 'vip'

export type QuotaStatus = {
  tier: QuotaTier
  remaining: number
  limit: number
  register_bonus: number
  can_ask: boolean
}

export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: DB_SCHEMA },
    },
  )
}

export async function resolveUserId(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return null
  const token = auth.slice(7).trim()
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  if (anon && token === anon) return null

  const secret = Deno.env.get('JWT_SECRET')
  if (!secret) return null

  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret))
    const uid = payload.user_id ?? payload.sub
    return typeof uid === 'string' ? uid : null
  } catch {
    return null
  }
}

function deviceKeyFromRequest(req: Request, bodyDeviceId?: string) {
  const header = req.headers.get('x-luge-device-id')?.trim()
  const fromBody = bodyDeviceId?.trim()
  const key = header || fromBody
  if (!key || key.length < 8 || key.length > 128) return null
  return key
}

function isVipActive(user: {
  billing_mode: string
  vip_expire_at: string | null
}) {
  if (user.billing_mode !== 'vip') return false
  if (!user.vip_expire_at) return true
  return new Date(user.vip_expire_at).getTime() > Date.now()
}

export async function getQuotaStatus(
  supabase: SupabaseClient,
  opts: { userId: string | null; deviceKey: string | null },
): Promise<QuotaStatus> {
  const { guestFreeAsks, newUserBonusAsks } = quotaConfig()

  if (opts.userId) {
    const { data: user } = await supabase
      .from('users')
      .select('billing_mode, vip_expire_at, balance_asks')
      .eq('id', opts.userId)
      .maybeSingle()

    if (user && isVipActive(user)) {
      return {
        tier: 'vip',
        remaining: 9999,
        limit: 9999,
        register_bonus: newUserBonusAsks,
        can_ask: true,
      }
    }

    const remaining = user?.balance_asks ?? 0
    return {
      tier: 'user',
      remaining,
      limit: remaining,
      register_bonus: newUserBonusAsks,
      can_ask: remaining > 0,
    }
  }

  if (!opts.deviceKey) {
    return {
      tier: 'guest',
      remaining: 0,
      limit: guestFreeAsks,
      register_bonus: newUserBonusAsks,
      can_ask: false,
    }
  }

  const { data: guest } = await supabase
    .from('guest_devices')
    .select('asks_used')
    .eq('device_key', opts.deviceKey)
    .maybeSingle()

  const used = guest?.asks_used ?? 0
  const remaining = Math.max(0, guestFreeAsks - used)

  return {
    tier: 'guest',
    remaining,
    limit: guestFreeAsks,
    register_bonus: newUserBonusAsks,
    can_ask: remaining > 0,
  }
}

export class QuotaExhaustedError extends Error {
  code = 'QUOTA_EXHAUSTED'
  tier: QuotaTier
  register_bonus: number

  constructor(tier: QuotaTier, register_bonus: number) {
    super('quota exhausted')
    this.tier = tier
    this.register_bonus = register_bonus
  }
}

export async function consumeOneAsk(
  supabase: SupabaseClient,
  opts: { userId: string | null; deviceKey: string | null },
): Promise<QuotaStatus> {
  const status = await getQuotaStatus(supabase, opts)
  if (!status.can_ask) {
    throw new QuotaExhaustedError(status.tier, status.register_bonus)
  }

  if (opts.userId && status.tier !== 'vip') {
    const { data, error } = await supabase.rpc('consume_user_ask', {
      p_user_id: opts.userId,
    })
    if (error) {
      const { data: user } = await supabase
        .from('users')
        .select('balance_asks')
        .eq('id', opts.userId)
        .single()
      if (!user || user.balance_asks <= 0) {
        throw new QuotaExhaustedError('user', status.register_bonus)
      }
      await supabase
        .from('users')
        .update({ balance_asks: user.balance_asks - 1 })
        .eq('id', opts.userId)
        .eq('balance_asks', user.balance_asks)
    } else if (data === false) {
      throw new QuotaExhaustedError('user', status.register_bonus)
    }
    return getQuotaStatus(supabase, opts)
  }

  if (status.tier === 'vip') {
    return status
  }

  if (!opts.deviceKey) {
    throw new QuotaExhaustedError('guest', status.register_bonus)
  }

  const { guestFreeAsks } = quotaConfig()
  const { data: guest } = await supabase
    .from('guest_devices')
    .select('asks_used')
    .eq('device_key', opts.deviceKey)
    .maybeSingle()

  const used = guest?.asks_used ?? 0
  if (used >= guestFreeAsks) {
    throw new QuotaExhaustedError('guest', status.register_bonus)
  }

  if (guest) {
    await supabase
      .from('guest_devices')
      .update({ asks_used: used + 1 })
      .eq('device_key', opts.deviceKey)
      .eq('asks_used', used)
  } else {
    await supabase.from('guest_devices').insert({
      device_key: opts.deviceKey,
      asks_used: 1,
    })
  }

  return getQuotaStatus(supabase, opts)
}

export function parseQuotaRequest(req: Request, body?: { device_id?: string }) {
  return {
    userId: null as string | null,
    deviceKey: deviceKeyFromRequest(req, body?.device_id),
  }
}

export async function parseQuotaAuth(req: Request, body?: { device_id?: string }) {
  const userId = await resolveUserId(req)
  const deviceKey = deviceKeyFromRequest(req, body?.device_id)
  return { userId, deviceKey }
}
