import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config'
import { getDeviceId } from './deviceId'

export type QuotaTier = 'guest' | 'user' | 'vip'

export type QuotaStatus = {
  tier: QuotaTier
  remaining: number
  limit: number
  register_bonus: number
  can_ask: boolean
  config?: {
    guest_free_asks: number
    new_user_bonus_asks: number
  }
}

export type QuotaExhaustedPayload = {
  code: 'QUOTA_EXHAUSTED'
  tier: QuotaTier
  register_bonus: number
}

export type AskPackageId = 'asks_50' | 'asks_200'

export const ASK_PACKAGES: Record<
  AskPackageId,
  { id: AskPackageId; title: string; price: string; desc: string; asks: number; badge?: string | null }
> = {
  asks_50: {
    id: 'asks_50',
    title: '50 次问路包',
    price: '¥9.9',
    desc: '适合周末短途，约可畅聊一段高速',
    asks: 50,
    badge: null,
  },
  asks_200: {
    id: 'asks_200',
    title: '200 次问路包',
    price: '¥29.9',
    desc: '国庆自驾推荐，沿途景点随便问',
    asks: 200,
    badge: '划算',
  },
}

export type PurchaseResult = QuotaStatus & {
  purchased?: string
  mock?: boolean
}

function headers(accessToken?: string | null, deviceId?: string) {
  const token = accessToken?.trim() || SUPABASE_ANON_KEY
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...(deviceId ? { 'X-Luge-Device-Id': deviceId } : {}),
  }
}

export async function fetchQuota(accessToken?: string | null): Promise<QuotaStatus> {
  const deviceId = await getDeviceId()
  const res = await fetch(`${SUPABASE_URL}/functions/v1/quota`, {
    method: 'POST',
    headers: headers(accessToken, deviceId),
    body: JSON.stringify({ device_id: deviceId }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error ?? '无法获取剩余次数')
  }
  return data as QuotaStatus
}

export async function purchaseAskPackage(
  accessToken: string,
  packageId: AskPackageId,
): Promise<PurchaseResult> {
  const deviceId = await getDeviceId()
  const res = await fetch(`${SUPABASE_URL}/functions/v1/quota`, {
    method: 'POST',
    headers: headers(accessToken, deviceId),
    body: JSON.stringify({
      action: 'mock_purchase',
      package_id: packageId,
      device_id: deviceId,
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(
      typeof data.error === 'string' ? data.error : '购买失败，请稍后再试',
    )
  }
  return data as PurchaseResult
}

export function isQuotaExhaustedError(data: unknown): data is QuotaExhaustedPayload {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as QuotaExhaustedPayload).code === 'QUOTA_EXHAUSTED'
  )
}

export function formatQuotaLabel(q: QuotaStatus | null) {
  if (!q) return ''
  if (q.tier === 'vip') return 'VIP 畅聊'
  if (q.remaining <= 0) return '次数已用尽'
  return `剩余 ${q.remaining} 次问路`
}
