import {
  adminClient,
  ASK_PACKAGES,
  getQuotaStatus,
  mockPurchaseEnabled,
  mockPurchasePackage,
  parseQuotaAuth,
  quotaConfig,
} from './quota.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-luge-device-id',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return json({ error: 'method not allowed' }, 405)
  }

  try {
    let bodyDeviceId: string | undefined
    let body: Record<string, unknown> = {}

    if (req.method === 'POST') {
      body = (await req.json().catch(() => ({}))) as Record<string, unknown>
      bodyDeviceId = body.device_id as string | undefined

      if (body.action === 'mock_purchase') {
        if (!mockPurchaseEnabled()) {
          return json({ error: '支付即将上线，请稍后再试' }, 403)
        }

        const { userId } = await parseQuotaAuth(req, { device_id: bodyDeviceId })
        if (!userId) return json({ error: '请先登录' }, 401)

        const packageId = typeof body.package_id === 'string' ? body.package_id : ''
        if (!ASK_PACKAGES[packageId]) {
          return json({ error: '无效的套餐' }, 400)
        }

        const supabase = adminClient()
        const status = await mockPurchasePackage(supabase, { userId, packageId })
        return json({
          ...status,
          purchased: packageId,
          mock: true,
        })
      }
    }

    const { userId, deviceKey } = await parseQuotaAuth(req, { device_id: bodyDeviceId })
    const supabase = adminClient()
    const status = await getQuotaStatus(supabase, { userId, deviceKey })
    const cfg = quotaConfig()

    return json({
      ...status,
      config: {
        guest_free_asks: cfg.guestFreeAsks,
        new_user_bonus_asks: cfg.newUserBonusAsks,
      },
      packages: Object.entries(ASK_PACKAGES).map(([id, pkg]) => ({
        id,
        asks: pkg.asks,
        title: pkg.title,
      })),
      mock_purchase_enabled: mockPurchaseEnabled(),
    })
  } catch (err) {
    console.error('quota error:', err)
    const msg = err instanceof Error ? err.message : 'internal error'
    return json({ error: msg }, 500)
  }
})
