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
- **候选列表里已有同名（或专名核心相同）的足迹 → 必须 match，禁止再 create**
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

/** 公园/寺等泛类词：不能单靠这些把旧足迹和当前 POI 串起来（勿剥「江/河/山」等专名常用字） */
const FOOTPRINT_GENERIC_SUFFIX =
  /(国家森林公园|森林公园|地质公园|湿地公园|风景名胜区|旅游度假区|旅游区|风景区|度假区|博物馆|纪念馆|文化馆|水库|公园|景区|寺庙|道观|教堂|古镇|古城|大桥|隧道|立交桥|立交)$/u
const FOOTPRINT_GENERIC_INFIX = /公园|景区|寺庙|风景区|度假区/g

/**
 * 专名核心：去掉括号与泛类后缀后剩余的可辨识片段。
 * 「成都北湖公园」→「成都北湖」；「岷江」保持「岷江」。
 */
export function footprintProperCore(name: string): string {
  return name
    .replace(/[（(].*?[）)]/g, '')
    .replace(FOOTPRINT_GENERIC_SUFFIX, '')
    .replace(FOOTPRINT_GENERIC_INFIX, '')
    .replace(/[\s·\-_/／]+/g, '')
    .trim()
}

/**
 * 足迹是否与候选地名「专名相关」（同河/同景区核心名），而非仅共有「公园」等类词。
 * 用于主动讲解：无关足迹不塞进 prompt，从源头减少乱 cue。
 */
export function footprintRelatedToNames(
  footprint: { poi_name: string; title?: string | null },
  candidateNames: string[],
): boolean {
  const cores = [footprint.poi_name, footprint.title ?? '']
    .map((s) => footprintProperCore(String(s ?? '')))
    .filter((c) => c.length >= 2)
  if (!cores.length) return false

  for (const cand of candidateNames) {
    const cc = footprintProperCore(cand)
    if (cc.length < 2) continue
    for (const core of cores) {
      if (core.includes(cc) || cc.includes(core)) return true
    }
  }
  return false
}

/** 只保留与当前候选专名相关的附近足迹（最多 limit 条） */
export function filterFootprintsForCue(
  footprints: NearbyFootprint[],
  candidateNames: string[],
  limit = 5,
): NearbyFootprint[] {
  return footprints
    .filter((fp) => footprintRelatedToNames(fp, candidateNames))
    .slice(0, limit)
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

function normalizePoiNameKey(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, '')
}

/** 同用户、同名足迹已存在则复用（防并发 create / 分类器误 create） */
async function findExistingFootprintByName(
  supabase: SupabaseClient,
  userId: string,
  poiName: string,
): Promise<{ id: string; poi_name: string } | null> {
  const want = normalizePoiNameKey(poiName)
  if (!want) return null
  const { data } = await supabase
    .from('user_footprints')
    .select('id, poi_name')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(80)
  if (!data?.length) return null
  const hit = data.find(
    (r) => normalizePoiNameKey(String(r.poi_name ?? '')) === want,
  )
  return hit ? { id: hit.id, poi_name: String(hit.poi_name) } : null
}

/** 同用户串行化足迹写入，避免同秒多轮同时 create */
const footprintWriteTail = new Map<string, Promise<unknown>>()

async function withFootprintWriteLock<T>(
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = footprintWriteTail.get(userId) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = prev.then(() => gate)
  footprintWriteTail.set(userId, tail)
  await prev.catch(() => undefined)
  try {
    return await fn()
  } finally {
    release()
    if (footprintWriteTail.get(userId) === tail) {
      footprintWriteTail.delete(userId)
    }
  }
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

  return withFootprintWriteLock(userId, async () => {
    let footprintId: string

    if (decision.action === 'create') {
      const existing = await findExistingFootprintByName(
        supabase,
        userId,
        decision.poi_name,
      )
      if (existing) {
        footprintId = existing.id
      } else {
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
          const raced = await findExistingFootprintByName(
            supabase,
            userId,
            decision.poi_name,
          )
          if (raced) {
            footprintId = raced.id
          } else {
            console.warn('create footprint:', error?.message)
            return {
              footprint_id: null,
              visit_id: null,
              write_error: error?.message ?? 'create footprint failed',
            }
          }
        } else {
          footprintId = data.id
        }
      }
    } else {
      footprintId = decision.footprint_id
    }

    let visitId: string
    const existingVisit = await findReusableVisit(supabase, footprintId)

    if (existingVisit) {
      visitId = existingVisit.id
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
  })
}

export type FavoriteFootprintResult = {
  ok: boolean
  status:
    | 'created_and_favorited'
    | 'favorited'
    | 'already_favorited'
    | 'need_login'
    | 'need_topic'
    | 'error'
  footprint_id: string | null
  poi_name: string
  already_favorited: boolean
  created: boolean
  error?: string
  reply_hint: string
}

/** 语音「收藏 / 记住这个点」：匹配或新建足迹，并点亮 favorited_at */
export async function ensureFootprintFavorited(
  supabase: SupabaseClient,
  userId: string | null | undefined,
  opts: {
    poiName: string
    poiType?: FootprintPoiType
    latitude: number
    longitude: number
    userLat: number
    userLng: number
    heading?: number | null
    userMessage?: string
  },
): Promise<FavoriteFootprintResult> {
  const poiName = opts.poiName.trim().slice(0, 80)
  if (!userId) {
    return {
      ok: false,
      status: 'need_login',
      footprint_id: null,
      poi_name: poiName,
      already_favorited: false,
      created: false,
      reply_hint:
        '用户未登录。请用一两句提醒：登录后才能收藏地点；不要假装已经收藏成功。',
    }
  }
  if (!poiName) {
    return {
      ok: false,
      status: 'need_topic',
      footprint_id: null,
      poi_name: '',
      already_favorited: false,
      created: false,
      reply_hint:
        '当前没有可收藏的话题景点。请用一两句问用户想收藏哪个地方，不要假装已收藏。',
    }
  }

  const poiType: FootprintPoiType =
    opts.poiType && POI_TYPES.includes(opts.poiType) ? opts.poiType : 'other'

  try {
    return await withFootprintWriteLock(userId, async () => {
      const existing = await findExistingFootprintByName(supabase, userId, poiName)
      let footprintId: string
      let created = false
      let alreadyFavorited = false

      if (existing) {
        footprintId = existing.id
        const { data: row } = await supabase
          .from('user_footprints')
          .select('favorited_at, poi_name')
          .eq('id', footprintId)
          .maybeSingle()
        alreadyFavorited = row?.favorited_at != null
      } else {
        const { data, error } = await supabase
          .from('user_footprints')
          .insert({
            user_id: userId,
            poi_name: poiName,
            poi_type: poiType,
            geom: pointWkt(opts.longitude, opts.latitude),
            title: poiName,
          })
          .select('id')
          .single()
        if (error || !data) {
          const raced = await findExistingFootprintByName(supabase, userId, poiName)
          if (!raced) {
            return {
              ok: false,
              status: 'error',
              footprint_id: null,
              poi_name: poiName,
              already_favorited: false,
              created: false,
              error: error?.message ?? 'create failed',
              reply_hint: '收藏失败了，请让用户稍后再试，不要编造已收藏。',
            }
          }
          footprintId = raced.id
        } else {
          footprintId = data.id
          created = true
        }
      }

      if (!alreadyFavorited) {
        const favoritedAt = new Date().toISOString()
        const { error: favErr } = await supabase
          .from('user_footprints')
          .update({
            favorited_at: favoritedAt,
            updated_at: favoritedAt,
          })
          .eq('id', footprintId)
          .eq('user_id', userId)
        if (favErr) {
          return {
            ok: false,
            status: 'error',
            footprint_id: footprintId,
            poi_name: poiName,
            already_favorited: false,
            created,
            error: favErr.message,
            reply_hint: '收藏失败了，请让用户稍后再试，不要编造已收藏。',
          }
        }

        try {
          const { error: sigErr } = await supabase.rpc('record_geo_landmark_signal', {
            p_user_id: userId,
            p_signal_type: 'favorite',
            p_landmark_name: poiName,
            p_landmark_type: (() => {
              if (poiType === 'city' || poiType === 'town') return 'town'
              if (
                poiType === 'river' ||
                poiType === 'scenery' ||
                poiType === 'bridge' ||
                poiType === 'mountain'
              ) {
                return poiType
              }
              return 'other'
            })(),
            p_lat: opts.latitude,
            p_lng: opts.longitude,
            p_ai_story: '',
            p_amap_poi_id: null,
            p_metadata: {
              footprint_id: footprintId,
              source: 'voice_favorite',
            },
          })
          if (sigErr) {
            console.warn('record_geo_landmark_signal favorite:', sigErr.message)
          }
        } catch (e) {
          console.warn(
            'record_geo_landmark_signal favorite:',
            e instanceof Error ? e.message : e,
          )
        }
      }

      // 轻量记一条访问消息（不嵌套 applyFootprintDecision，避免同用户写锁死锁）
      const note = (opts.userMessage?.trim() || '用户语音请求收藏此点').slice(0, 200)
      const assistantNote = alreadyFavorited
        ? `已收藏过「${poiName}」。`
        : `已收藏「${poiName}」。`
      try {
        let visitId: string | null = null
        const existingVisit = await findReusableVisit(supabase, footprintId)
        if (existingVisit) {
          visitId = existingVisit.id
          await supabase
            .from('footprint_visits')
            .update({
              last_active_at: new Date().toISOString(),
              needs_summary: true,
            })
            .eq('id', visitId)
        } else {
          const { data: visit } = await supabase
            .from('footprint_visits')
            .insert({
              footprint_id: footprintId,
              status: 'active',
              start_location: pointWkt(opts.userLng, opts.userLat),
              needs_summary: true,
            })
            .select('id')
            .single()
          visitId = visit?.id ?? null
        }
        if (visitId) {
          await supabase.from('footprint_messages').insert([
            {
              footprint_visit_id: visitId,
              role: 'user',
              content: note,
              triggered_location: pointWkt(opts.userLng, opts.userLat),
              heading_degrees: opts.heading ?? null,
            },
            {
              footprint_visit_id: visitId,
              role: 'assistant',
              content: assistantNote,
            },
          ])
        }
      } catch (e) {
        console.warn(
          'favorite visit write:',
          e instanceof Error ? e.message : e,
        )
      }

      if (alreadyFavorited) {
        return {
          ok: true,
          status: 'already_favorited',
          footprint_id: footprintId,
          poi_name: poiName,
          already_favorited: true,
          created: false,
          reply_hint: `「${poiName}」已经在收藏里了。用一两句短话确认即可，不要再介绍景点。`,
        }
      }
      return {
        ok: true,
        status: created ? 'created_and_favorited' : 'favorited',
        footprint_id: footprintId,
        poi_name: poiName,
        already_favorited: false,
        created,
        reply_hint: `已收藏「${poiName}」。用一两句短话确认即可，不要展开介绍，也不要复述方位距离。`,
      }
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      ok: false,
      status: 'error',
      footprint_id: null,
      poi_name: poiName,
      already_favorited: false,
      created: false,
      error: msg,
      reply_hint: '收藏失败了，请让用户稍后再试，不要编造已收藏。',
    }
  }
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
