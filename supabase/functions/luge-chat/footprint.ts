import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { jwtVerify } from 'npm:jose@5'
import { noopPromptLogger, type PromptLogger } from './llmLog.ts'

const DEEPSEEK_API_KEY = Deno.env.get('DEEPSEEK_API_KEY')
const DEEPSEEK_BASE_URL = Deno.env.get('DEEPSEEK_BASE_URL') ?? 'https://api.deepseek.com'
const DEEPSEEK_MODEL = Deno.env.get('DEEPSEEK_MODEL') ?? 'deepseek-v4-flash'
const DB_SCHEMA = Deno.env.get('AUTH_DB_SCHEMA') ?? Deno.env.get('SANDBOX_DB_SCHEMA') ?? 'dev'

export type FootprintPoiType =
  | 'city'
  | 'town'
  | 'river'
  | 'scenery'
  | 'bridge'
  | 'statue'
  | 'mountain'
  | 'other'

export type NearbyFootprint = {
  id: string
  poi_name: string
  poi_type: FootprintPoiType
  title: string
  summary: string
  llm_notes: string
  distance_m: number
  lat: number
  lng: number
  visit_count: number
  last_visit_at: string | null
}

export type FootprintDecision =
  | { action: 'skip'; reason?: string }
  | { action: 'match'; footprint_id: string; poi_name: string }
  | {
      action: 'create'
      poi_name: string
      poi_type: FootprintPoiType
      latitude: number
      longitude: number
    }

const POI_TYPES: FootprintPoiType[] = [
  'city',
  'town',
  'river',
  'scenery',
  'bridge',
  'statue',
  'mountain',
  'other',
]

const CLASSIFIER_PROMPT = `你是路鸽足迹系统的调度员。根据用户提问、地理上下文、以及附近历史足迹候选，决定是否记录足迹。

规则：
- 纯闲聊、车内无关话题 → action=skip
- 用户在了解某个地理/人文对象（市、镇、河、景点、雕像、桥、山等）→ match 或 create
- **路鸽主动讲解本身不生成足迹**；仅当用户在本轮**主动提问**，且与「刚才主动讲解的 POI」明确相关时，才可对该 POI match/create
- 若提供了「刚才主动讲解的 POI」但用户问的是别的地标，可忽略该上下文，按常规定义判断即可
- 追问同一对象（如雕像后问诗人）→ match 同一足迹，不要 create
- 山、河、城镇等为不同 POI：例如「折多山」（mountain）与「折多河」（river）应分别建档；用户本轮主要问山体/海拔/垭口/分界 → mountain，主要问河流/水源/上下游 → river；不要因为二者相关就 match 到另一个类型的足迹
- create 时坐标用地标本身位置，不要用用户 GPS 代替河流/城镇中心
- create 时 poi_name 填用户关心的地理实体正式名称（公园、河流、景区等），不要填楼盘、小区、商铺名
- 镇房价、城市经济等宏观问题 → 足迹 POI 可以是该镇/该市

只输出一个 JSON 对象（不要 markdown），字段：
- action: "skip" | "match" | "create"
- reason: 可选，skip 时的原因
- footprint_id: match 时必填，必须是候选列表里的 id
- poi_name: match/create 时必填
- poi_type: create 时必填，取值 city|town|river|scenery|bridge|statue|mountain|other
- latitude / longitude: create 时必填（地标坐标）`

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

export async function getUserIdFromRequest(req: Request): Promise<string | null> {
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

export async function fetchNearbyFootprints(
  supabase: SupabaseClient,
  userId: string,
  lat: number,
  lng: number,
): Promise<NearbyFootprint[]> {
  const { data, error } = await supabase.rpc('nearby_user_footprints', {
    p_user_id: userId,
    p_lat: lat,
    p_lng: lng,
    p_radius_m: 30000,
  })
  if (error) {
    console.warn('nearby_user_footprints:', error.message)
    return []
  }
  return (data ?? []) as NearbyFootprint[]
}

function formatCandidates(candidates: NearbyFootprint[]) {
  if (!candidates.length) return '（30km 内无历史足迹）'
  return candidates
    .map(
      (c, i) =>
        `${i + 1}. id=${c.id} | ${c.poi_name}（${c.poi_type}）| 距此 ${Math.round(c.distance_m)}m | 标题：${c.title || '未命名'} | 摘要：${(c.summary || '无').slice(0, 80)} | 到访 ${c.visit_count} 次`,
    )
    .join('\n')
}

export type ClassifyFootprintResult = {
  decision: FootprintDecision
  debug: {
    model: string
    http_ok: boolean
    http_status: number
    api_error: unknown
    raw_content: string | null
    reasoning_content: string | null
    parsed: Record<string, unknown> | null
    candidates_count: number
  }
}

export type ProactivePoiContext = {
  poi_name: string
  amap_poi_id?: string | null
  lat: number
  lng: number
  category?: string
}

export async function classifyFootprint(
  userMessage: string,
  geoContext: string,
  candidates: NearbyFootprint[],
  logPrompt: PromptLogger = noopPromptLogger,
  proactiveContext?: ProactivePoiContext | null,
): Promise<ClassifyFootprintResult> {
  const debugBase = {
    model: DEEPSEEK_MODEL,
    http_ok: false,
    http_status: 0,
    api_error: null as unknown,
    raw_content: null as string | null,
    reasoning_content: null as string | null,
    parsed: null as Record<string, unknown> | null,
    candidates_count: candidates.length,
  }

  if (!DEEPSEEK_API_KEY) {
    return {
      decision: { action: 'skip', reason: 'no api key' },
      debug: debugBase,
    }
  }

  const userContent = [
    proactiveContext
      ? [
          '## 刚才路鸽主动讲解的 POI（仅用户主动延续深聊才可建档）',
          `名称：${proactiveContext.poi_name}`,
          proactiveContext.category ? `类型：${proactiveContext.category}` : '',
          `坐标：${proactiveContext.lat.toFixed(5)}, ${proactiveContext.lng.toFixed(5)}`,
          proactiveContext.amap_poi_id ? `高德 POI：${proactiveContext.amap_poi_id}` : '',
        ]
          .filter(Boolean)
          .join('\n')
      : '## 刚才路鸽主动讲解的 POI\n（无）',
    '',
    '## 地理与地图上下文',
    geoContext,
    '',
    '## 30km 内历史足迹候选',
    formatCandidates(candidates),
    '',
    '## 用户本轮提问',
    userMessage,
  ].join('\n')

  const messages = [
    { role: 'system', content: CLASSIFIER_PROMPT },
    { role: 'user', content: userContent },
  ]
  logPrompt('足迹分类', messages)

  const classifyT0 = Date.now()
  const res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages,
      temperature: 0.2,
      max_tokens: 800,
      response_format: { type: 'json_object' },
      // 关闭思考模式，避免 tool/json 兼容问题
      thinking: { type: 'disabled' },
    }),
  })

  const data = await res.json().catch(() => ({}))
  debugBase.classify_ms = Date.now() - classifyT0
  debugBase.http_ok = res.ok
  debugBase.http_status = res.status
  if (!res.ok) {
    debugBase.api_error = data?.error ?? data
    console.warn('footprint classifier error:', data)
    return {
      decision: { action: 'skip', reason: 'classifier failed' },
      debug: debugBase,
    }
  }

  const msg = data?.choices?.[0]?.message
  const rawText =
    typeof msg?.content === 'string'
      ? msg.content
      : typeof msg?.reasoning_content === 'string'
        ? msg.reasoning_content
        : null
  debugBase.raw_content = typeof msg?.content === 'string' ? msg.content : null
  debugBase.reasoning_content =
    typeof msg?.reasoning_content === 'string' ? msg.reasoning_content : null

  if (!rawText?.trim()) {
    return {
      decision: { action: 'skip', reason: 'empty classifier response' },
      debug: debugBase,
    }
  }

  let args: Record<string, unknown> = {}
  try {
    const cleaned = rawText
      .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '')
      .replace(/```(?:json)?\s*([\s\S]*?)```/i, '$1')
      .trim()
    args = JSON.parse(cleaned)
    debugBase.parsed = args
  } catch {
    console.warn('footprint classifier bad json:', rawText.slice(0, 200))
    return {
      decision: { action: 'skip', reason: 'bad classifier json' },
      debug: debugBase,
    }
  }

  const action = String(args.action ?? '').toLowerCase()
  if (action === 'skip') {
    return {
      decision: { action: 'skip', reason: String(args.reason ?? '') },
      debug: debugBase,
    }
  }
  if (action === 'match') {
    const footprint_id = String(args.footprint_id ?? '')
    const poi_name = String(args.poi_name ?? '')
    if (!footprint_id || !candidates.some((c) => c.id === footprint_id)) {
      return {
        decision: { action: 'skip', reason: 'invalid match id' },
        debug: debugBase,
      }
    }
    return {
      decision: { action: 'match', footprint_id, poi_name },
      debug: debugBase,
    }
  }
  if (action === 'create') {
    const poi_name = String(args.poi_name ?? '').trim()
    const poi_type = String(args.poi_type ?? 'other') as FootprintPoiType
    const latitude = Number(args.latitude)
    const longitude = Number(args.longitude)
    if (!poi_name || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return {
        decision: { action: 'skip', reason: 'invalid create args' },
        debug: debugBase,
      }
    }
    const safeType = POI_TYPES.includes(poi_type) ? poi_type : 'other'
    return {
      decision: {
        action: 'create',
        poi_name,
        poi_type: safeType,
        latitude,
        longitude,
      },
      debug: debugBase,
    }
  }

  return {
    decision: { action: 'skip', reason: 'unknown action' },
    debug: debugBase,
  }
}

function pointWkt(lng: number, lat: number) {
  return `SRID=4326;POINT(${lng} ${lat})`
}

async function findReusableVisit(supabase: SupabaseClient, footprintId: string) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data } = await supabase
    .from('footprint_visits')
    .select('id, started_at')
    .eq('footprint_id', footprintId)
    .eq('status', 'active')
    .gte('last_active_at', since)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data
}

export async function applyFootprintDecision(
  supabase: SupabaseClient,
  userId: string,
  decision: FootprintDecision,
  params: {
    userMessage: string
    assistantMessage: string
    userLat: number
    userLng: number
    heading: number | null
  },
): Promise<{
  footprint_id: string | null
  visit_id: string | null
  write_error: string | null
}> {
  if (decision.action === 'skip') {
    return { footprint_id: null, visit_id: null, write_error: null }
  }

  let footprintId: string

  if (decision.action === 'create') {
    const { data, error } = await supabase
      .from('user_footprints')
      .insert({
        user_id: userId,
        poi_name: decision.poi_name,
        poi_type: decision.poi_type,
        geom: pointWkt(decision.longitude, decision.latitude),
        title: decision.poi_name,
      })
      .select('id')
      .single()
    if (error || !data) {
      console.warn('create footprint:', error?.message)
      return {
        footprint_id: null,
        visit_id: null,
        write_error: error?.message ?? 'create footprint failed',
      }
    }
    footprintId = data.id
  } else {
    footprintId = decision.footprint_id
  }

  let visitId: string
  const existing = await findReusableVisit(supabase, footprintId)

  if (existing) {
    visitId = existing.id
    await supabase
      .from('footprint_visits')
      .update({
        last_active_at: new Date().toISOString(),
        needs_summary: true,
      })
      .eq('id', visitId)
  } else {
    const { data, error } = await supabase
      .from('footprint_visits')
      .insert({
        footprint_id: footprintId,
        status: 'active',
        start_location: pointWkt(params.userLng, params.userLat),
        needs_summary: true,
      })
      .select('id')
      .single()
    if (error || !data) {
      console.warn('create visit:', error?.message)
      return {
        footprint_id: footprintId,
        visit_id: null,
        write_error: error?.message ?? 'create visit failed',
      }
    }
    visitId = data.id
  }

  const rows = [
    {
      footprint_visit_id: visitId,
      role: 'user',
      content: params.userMessage,
      triggered_location: pointWkt(params.userLng, params.userLat),
      heading_degrees: params.heading,
    },
    {
      footprint_visit_id: visitId,
      role: 'assistant',
      content: params.assistantMessage,
    },
  ]

  const { error: msgErr } = await supabase.from('footprint_messages').insert(rows)
  if (msgErr) {
    return {
      footprint_id: footprintId,
      visit_id: visitId,
      write_error: msgErr.message,
    }
  }

  await supabase
    .from('user_footprints')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', footprintId)

  return { footprint_id: footprintId, visit_id: visitId, write_error: null }
}

export async function loadFootprintMemory(
  supabase: SupabaseClient,
  footprintId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('user_footprints')
    .select('poi_name, title, summary, llm_notes')
    .eq('id', footprintId)
    .maybeSingle()
  if (!data) return null
  const parts = [
    `POI：${data.poi_name}`,
    data.title ? `标题：${data.title}` : '',
    data.summary ? `总述：${data.summary}` : '',
    data.llm_notes ? `隐藏访问笔记：${data.llm_notes}` : '',
  ].filter(Boolean)
  return parts.join('\n')
}

export async function summarizeVisitAndFootprint(
  supabase: SupabaseClient,
  visitId: string,
  logPrompt: PromptLogger = noopPromptLogger,
): Promise<boolean> {
  const { data: visit, error: visitErr } = await supabase
    .from('footprint_visits')
    .select('id, footprint_id, started_at, visit_summary, llm_notes')
    .eq('id', visitId)
    .single()

  if (visitErr || !visit) return false

  const { data: footprint } = await supabase
    .from('user_footprints')
    .select('id, poi_name, poi_type, title, summary, llm_notes')
    .eq('id', visit.footprint_id)
    .single()

  if (!footprint) return false

  const { data: visitMessages } = await supabase
    .from('footprint_messages')
    .select('role, content, created_at')
    .eq('footprint_visit_id', visitId)
    .order('created_at', { ascending: true })

  const dialog = (visitMessages ?? [])
    .map((m) => `${m.role === 'user' ? '用户' : '路鸽'}：${m.content}`)
    .join('\n')

  if (!dialog.trim() || !DEEPSEEK_API_KEY) return false

  const SUMMARIZE_SYSTEM = `你是路鸽足迹归档助手。根据对话生成 JSON，不要 markdown 代码块。

字段：
- visit_summary：本次访问 80-150 字用户可见摘要
- visit_llm_notes：本次隐藏笔记，含时间线与用户兴趣点
- footprint_title：POI 卡片标题，10 字内。必须反映用户真正关心的地理对象，优先采用用户提问中的叫法（例：用户反复问「北湖」应写「成都北湖公园」，不要写楼盘名、小区名，也不要沿用首次回答的旁支主题）。若用户兴趣已偏离旧标题，应更新标题
- footprint_summary：跨访问 POI 总述 100-200 字
- footprint_llm_notes_append：追加到 POI 隐藏笔记的一段话，含本次访问时间`

  const summarizeUser = [
    `POI：${footprint.poi_name}（${footprint.poi_type}）`,
    `已有 POI 标题：${footprint.title || '无'}`,
    `本次访问开始：${visit.started_at}`,
    `已有 POI 总述：${footprint.summary || '无'}`,
    `已有 POI 隐藏笔记：${footprint.llm_notes || '无'}`,
    '',
    '## 本次对话',
    dialog,
  ].join('\n')

  const promptMessages = [
    { role: 'system', content: SUMMARIZE_SYSTEM },
    { role: 'user', content: summarizeUser },
  ]
  logPrompt('足迹摘要', promptMessages)

  const res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: promptMessages,
      temperature: 0.4,
      max_tokens: 900,
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' },
    }),
  })

  const raw = await res.json().catch(() => ({}))
  const text = raw?.choices?.[0]?.message?.content
  if (!res.ok || typeof text !== 'string') {
    console.warn('summarize failed:', JSON.stringify(raw).slice(0, 400))
    return false
  }

  let parsed: Record<string, string> = {}
  try {
    parsed = JSON.parse(text)
  } catch {
    return false
  }

  const visitSummary = parsed.visit_summary?.trim() ?? ''
  const visitNotes = parsed.visit_llm_notes?.trim() ?? ''
  const fpTitle = parsed.footprint_title?.trim() ?? footprint.title
  const fpSummary = parsed.footprint_summary?.trim() ?? footprint.summary
  const fpNotesAppend = parsed.footprint_llm_notes_append?.trim() ?? ''

  const mergedVisitNotes = [visit.llm_notes, visitNotes].filter(Boolean).join('\n\n')
  const mergedFpNotes = [footprint.llm_notes, fpNotesAppend].filter(Boolean).join('\n\n')

  await supabase
    .from('footprint_visits')
    .update({
      visit_summary: visitSummary || visit.visit_summary,
      llm_notes: mergedVisitNotes,
      needs_summary: false,
    })
    .eq('id', visitId)

  await supabase
    .from('user_footprints')
    .update({
      title: fpTitle || footprint.poi_name,
      summary: fpSummary,
      llm_notes: mergedFpNotes,
    })
    .eq('id', footprint.id)

  return true
}

export async function archiveVisit(supabase: SupabaseClient, visitId: string) {
  await supabase
    .from('footprint_visits')
    .update({
      status: 'archived',
      archived_at: new Date().toISOString(),
      needs_summary: false,
    })
    .eq('id', visitId)
}

export async function runFootprintJobs(supabase: SupabaseClient) {
  const now = Date.now()
  const debounceBefore = new Date(now - 10 * 60 * 1000).toISOString()
  const archiveBefore = new Date(now - 24 * 60 * 60 * 1000).toISOString()

  const { data: toSummarize } = await supabase
    .from('footprint_visits')
    .select('id')
    .eq('status', 'active')
    .eq('needs_summary', true)
    .lt('last_active_at', debounceBefore)
    .limit(20)

  let summarized = 0
  for (const row of toSummarize ?? []) {
    if (await summarizeVisitAndFootprint(supabase, row.id)) summarized++
  }

  const { data: toArchive } = await supabase
    .from('footprint_visits')
    .select('id, needs_summary')
    .eq('status', 'active')
    .lt('last_active_at', archiveBefore)
    .limit(20)

  let archived = 0
  for (const row of toArchive ?? []) {
    if (row.needs_summary) {
      await summarizeVisitAndFootprint(supabase, row.id)
    }
    await archiveVisit(supabase, row.id)
    archived++
  }

  return { summarized, archived }
}
