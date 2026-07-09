import { adminClient, runFootprintJobs } from './footprint_jobs.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-cron-secret',
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

  if (req.method !== 'POST') {
    return json({ error: 'method not allowed' }, 405)
  }

  const cronSecret = Deno.env.get('FOOTPRINT_CRON_SECRET')
  if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
    return json({ error: 'unauthorized' }, 401)
  }

  try {
    const result = await runFootprintJobs(adminClient())
    return json({ ok: true, ...result })
  } catch (err) {
    console.error('footprint-jobs error:', err)
    const msg = err instanceof Error ? err.message : 'internal error'
    return json({ error: msg }, 500)
  }
})
