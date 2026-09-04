const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-luge-device-id, x-luge-debug',
}

import {
  adminClient,
  applyFootprintDecision,
  classifyFootprint,
  fetchNearbyFootprints,
  filterFootprintsForCue,
} from './footprint.ts'
import {
  formatLandmarksForLlm,
  lookupNearbyLandmarks,
} from '../volc-voice-chat/nearbyLandmarks.ts'
import {
  consumeOneAsk,
  parseQuotaAuth,
  QuotaExhaustedError,
  type QuotaStatus,
} from './quota.ts'
import { localNearby, resolveGeoContext } from '../_shared/geoLocal.ts'
import {
  normalizeGeoRadiusPrefs,
  resolveProactiveScenicRadius,
} from '../_shared/geoSearchRadius.ts'
import {
  bearingLabel,
  bearingTo,
  formatDistanceSpoken,
  toRad,
} from '../_shared/geoBearing.ts'

type DebugStep = { step: string; ms: number; detail?: string }

function createDbg(
  enabled: boolean,
  callbacks?: {
    onStep?: (e: { step: string; ms: number; total: number; detail?: string }) => void
    onPrompt?: (e: { label: string; role: string; content: string }) => void
  },
) {
  const t0 = Date.now()
  let last = t0
  const steps: DebugStep[] = []
  return {
    mark(step: string, detail?: string) {
      if (!enabled) return
      const now = Date.now()
      const delta = now - last
      const total = now - t0
      last = now
      const entry: DebugStep = { step, ms: delta, ...(detail ? { detail } : {}) }
      steps.push(entry)
      const suffix = detail ? ` — ${detail}` : ''
      console.log(`[luge +${delta}ms Σ${total}ms] ${step}${suffix}`)
      callbacks?.onStep?.({ step, ms: delta, total, detail })
    },
    logPrompt(label: string, messages: Array<{ role: string; content: string }>) {
      if (!enabled) return
      for (const m of messages) {
        const sep = '─'.repeat(48)
        console.log(`[luge prompt] ${label} :: ${m.role}\n${sep}\n${m.content}\n${sep}`)
        callbacks?.onPrompt?.({ label, role: m.role, content: m.content })
      }
    },
    total() {
      return Date.now() - t0
    },
    steps() {
      return steps
    },
  }
}

const DEEPSEEK_API_KEY = Deno.env.get('DEEPSEEK_API_KEY')
const DEEPSEEK_BASE_URL = Deno.env.get('DEEPSEEK_BASE_URL') ?? 'https://api.deepseek.com'
const DEEPSEEK_MODEL = Deno.env.get('DEEPSEEK_MODEL') ?? 'deepseek-v4-flash'
const DEEPSEEK_JUDGE_MODEL = Deno.env.get('DEEPSEEK_JUDGE_MODEL') ?? DEEPSEEK_MODEL


type MapHit = {
  name: string
  category?: string
  distance_m: number
  direction: string
  source: 'local'
  lat: number
  lng: number
  amap_poi_id?: string | null
  tags?: Record<string, string>
  cached_story?: string
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

type ScenicPoiRow = {
  name: string
  type: string
  address: string
  rating: number | null
  distance_m: number
  lat: number | null
  lng: number | null
  amap_poi_id: string | null
}

type ProactiveCandidate = {
  name: string
  type: string
  distance_m: number
  direction: string
  lat: number
  lng: number
  amap_poi_id: string | null
  spoken_key: string
}

function normalizePoiNameKey(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/(旅游区|风景区|景区|公园|度假区)$/u, '')
}

function spokenKeysForPoi(name: string, amapPoiId?: string | null): string[] {
  const keys: string[] = []
  const nk = normalizePoiNameKey(name)
  if (nk) keys.push(nk)
  if (amapPoiId?.trim()) keys.push(`id:${amapPoiId.trim()}`)
  return keys
}

/** 「芙蓉岛公园一号馆」与「芙蓉岛公园」等近距离同名簇合并 */
function dedupeProactiveCandidates(
  rows: ProactiveCandidate[],
  max = 12,
): ProactiveCandidate[] {
  const sorted = [...rows].sort((a, b) => a.distance_m - b.distance_m)
  const kept: ProactiveCandidate[] = []

  for (const row of sorted) {
    const key = normalizePoiNameKey(row.name)
    const twin = kept.find((k) => {
      const kk = normalizePoiNameKey(k.name)
      if (!key || !kk) return false
      const near =
        haversineM(row.lat, row.lng, k.lat, k.lng) < 700 ||
        Math.abs(row.distance_m - k.distance_m) < 400
      if (!near) return false
      return key === kk || key.includes(kk) || kk.includes(key)
    })
    if (!twin) {
      kept.push(row)
    } else {
      // 保留更短、更像「主景点」的名字
      if (row.name.length + 2 < twin.name.length) {
        const idx = kept.indexOf(twin)
        kept[idx] = row
      }
    }
    if (kept.length >= max) break
  }
  return kept
}

function parseSpokenPoiKeys(body: Record<string, unknown>): Set<string> {
  const raw = body?.spoken_poi_keys
  if (!Array.isArray(raw)) return new Set()
  return new Set(
    raw
      .map((x) => String(x ?? '').trim().toLowerCase())
      .filter(Boolean),
  )
}

function isSpokenCandidate(c: ProactiveCandidate, spoken: Set<string>) {
  if (spoken.size === 0) return false
  return spokenKeysForPoi(c.name, c.amap_poi_id).some((k) => spoken.has(k.toLowerCase()))
}

/**
 * 主动讲解 / 黄点：本地库的类型已经在导入时筛过一轮，这里只挡明显不值得播报的。
 * 高德时代要靠中文类型串正则挑（「风景名胜」「湖泊」…），现在类型是枚举，直接判。
 */
function isProactiveCandidateType(type: string | undefined | null, name?: string) {
  const t = type ?? ''
  const n = name ?? ''
  if (/风景名胜|河流|山脉|桥梁|城镇/.test(t)) return true
  if (t.includes('地标')) return true
  if (/水库|堰湖|天池|雪山|大桥|隧道|立交/.test(n)) return true
  return false
}

async function fetchScenicPois(
  lat: number,
  lng: number,
  radiusKm = 8,
): Promise<ScenicPoiRow[]> {
  const radiusM = Math.round(Math.min(Math.max(radiusKm, 1), 100) * 1000)
  const pois = await localNearby(adminClient(), {
    lat,
    lng,
    radiusM,
    limit: 40,
    // 库里 28 万个村庄，主动播报「前方 800 米是张庄村」没有价值
    skipVillage: true,
  })

  return pois
    .filter((p) => isProactiveCandidateType(p.typeLabel, p.name))
    .map((p) => ({
      name: p.name,
      type: p.typeLabel,
      address: '',
      rating: null,
      distance_m: p.distanceM,
      lat: p.lat,
      lng: p.lng,
      amap_poi_id: p.id,
    }))
}

function buildProactiveCandidates(
  scenic: ScenicPoiRow[],
  userLat: number,
  userLng: number,
  heading: number | null,
): ProactiveCandidate[] {
  const raw: ProactiveCandidate[] = []
  for (const p of scenic) {
    if (p.lat == null || p.lng == null) continue
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue
    if (!isProactiveCandidateType(p.type, p.name)) continue
    const distance_m = Math.round(
      Number.isFinite(p.distance_m)
        ? p.distance_m
        : haversineM(userLat, userLng, p.lat, p.lng),
    )
    const bearing = bearingTo(userLat, userLng, p.lat, p.lng)
    raw.push({
      name: p.name,
      type: p.type || '风景名胜',
      distance_m,
      direction: bearingLabel(bearing, heading),
      lat: p.lat,
      lng: p.lng,
      amap_poi_id: p.amap_poi_id,
      spoken_key: normalizePoiNameKey(p.name),
    })
  }
  return dedupeProactiveCandidates(raw, 12)
}

/** 按当前 GPS 重算距离/方位，并按距离排序 */
function enrichProactiveCandidates(
  rows: ProactiveCandidate[],
  userLat: number,
  userLng: number,
  heading: number | null,
): ProactiveCandidate[] {
  return rows
    .map((c) => {
      const distance_m = Math.round(haversineM(userLat, userLng, c.lat, c.lng))
      const direction = bearingLabel(
        bearingTo(userLat, userLng, c.lat, c.lng),
        heading,
      )
      return { ...c, distance_m, direction }
    })
    .sort((a, b) => a.distance_m - b.distance_m)
}

function formatProactiveDistance(m: number): string {
  return formatDistanceSpoken(m).replace(/^约\s*/, '')
}

/** 客户端共享风景库：有有效条目则跳过高德 around */
function parseCachedScenicCandidates(
  body: Record<string, unknown>,
  userLat: number,
  userLng: number,
  heading: number | null,
): ProactiveCandidate[] | null {
  const raw = body?.cached_scenic_candidates
  if (!Array.isArray(raw) || raw.length === 0) return null
  const out: ProactiveCandidate[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const name = String(row.name ?? '').trim()
    const lat = Number(row.lat)
    const lng = Number(row.lng)
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue
    const type = String(row.type ?? '风景名胜') || '风景名胜'
    const distance_m = Math.round(haversineM(userLat, userLng, lat, lng))
    out.push({
      name,
      type,
      distance_m,
      direction: bearingLabel(bearingTo(userLat, userLng, lat, lng), heading),
      lat,
      lng,
      amap_poi_id:
        row.amap_poi_id == null || row.amap_poi_id === ''
          ? null
          : String(row.amap_poi_id),
      spoken_key: normalizePoiNameKey(name),
    })
  }
  return out.length > 0 ? enrichProactiveCandidates(out, userLat, userLng, heading) : null
}

function matchCandidateByName(
  candidates: ProactiveCandidate[],
  poiName: string,
): ProactiveCandidate | null {
  const want = poiName.trim()
  if (!want) return null
  const exact = candidates.find((c) => c.name === want)
  if (exact) return exact
  const nk = normalizePoiNameKey(want)
  return (
    candidates.find((c) => normalizePoiNameKey(c.name) === nk) ??
    candidates.find((c) => {
      const ck = normalizePoiNameKey(c.name)
      return Boolean(nk && ck && (ck.includes(nk) || nk.includes(ck)))
    }) ??
    null
  )
}

function candidateToMapHit(c: ProactiveCandidate): MapHit {
  return {
    name: c.name,
    category: c.type,
    distance_m: c.distance_m,
    direction: c.direction || '附近',
    source: 'local',
    lat: c.lat,
    lng: c.lng,
    amap_poi_id: c.amap_poi_id,
    tags: { name: c.name, type: c.type },
  }
}


/** 国内服务器常无法访问 OSM；用坐标粗粒度地理提示兜底 */
function coordsGeoHint(lat: number, lng: number) {
  if (lat > 30.4 && lat < 30.9 && lng > 103.9 && lng < 104.3) {
    return '四川省成都市城区。此区域主要地表河渠包括锦江（府河、南河汇合后的河段俗名）、府河、南河、沙河等，锦江自北向南穿城。'
  }
  if (lat > 29.3 && lat < 30.2 && lng > 106.3 && lng < 107.0) {
    return '重庆市主城区一带，长江与嘉陵江在此交汇，城区临江。'
  }
  return `北纬 ${lat.toFixed(4)}°、东经 ${lng.toFixed(4)}° 附近。请结合中国地理常识推断最近的主要河流水系。`
}

function buildProactiveGuidePrompt(minChars: number, maxChars: number) {
  return `你是路鸽的主动讲解调度员。系统已触发一次主动讲解机会（用户可能在开车、停车或步行，不要默认在开车）。

你会收到一份「候选 POI 列表」（已去重）。每条含：名称、类型、相对车头方位、距当前位置距离。你的任务：必须从该列表中挑选 **恰好一个** POI，写一段口语讲解。

挑选优先级（模糊权衡，由你综合判断，不要机械打分）：
1. **优质 / 视觉冲击**：从名称与类型判断辨识度。例如「xx雪山」「xx水库」「xx古镇」「xx大桥」「xx国家公园」通常优于「xx游乐场」「xx露营打卡地」「xx一号馆」「无名小沟」。附近有大片水/山/桥隧时，优先讲对应的命名对象。
2. **近且可见**：优先距离近、车头前方/侧前方的点；几公里外的点除非明显更优质，否则不要压过近处值得一提的点。
3. **足迹（可选加分）**：仅当「用户历史足迹」里某条与**所选 POI 专名相关**（同河、同景区、同一专名核心）时，可在讲解里一句带过「你以前来过…」。禁止仅因「公园」「寺」「山」「桥」等泛类词关联；列表里无关足迹直接忽略；同一足迹整段 text 里最多提一次。
4. 列表里可能有河流小沟、路口附属桥名等噪声——请自行丢掉，只挑真正值得讲的。

口播文案（E2/E3/H1/H2）：
- **只介绍景点本身**（是什么、有何特点），禁止行动号召：放慢车速、打开车窗、走进去看看、留意窗外、有机会多看一眼等。
- 用中性位置表述（「这边是…」「附近是…」）；不要写「我们正在开车」「车窗外」等驾驶套话。
- 开场应用列表里的相对方位 + 距离（如「右前方约 800 米是某某」）；在后方的点必须说清在后方；距离很近（约 150 米内）可省略距离只说方位。不要用「西南方」替代相对方位。

其它规则：
- **必须**选择列表中的一个对象；poi_name 必须与列表里某一项的名称完全一致（逐字相同）。
- 禁止编造列表里没有的地名；禁止一次讲多个对象。
- 候选可含：风景名胜、湖/水库、河、山、岛、海湾、桥/隧/立交、乡镇/村；不要讲商铺、停车场、收费站。
- 城市里 POI 多时，挑一个最有讲头的，不要罗列。
- 若上下文含「沉淀讲解」，可吸收要点，用自己的口语重述，勿照读。
- 避免：楼盘、小区、商铺；泛泛的「附近有很多公园」。
- text 为 ${minChars}～${maxChars} 字口语化中文，适合 TTS，不要 markdown。
- 仅当候选列表为空时，才输出 action=skip。

输出 JSON：{"action":"speak"|"skip","poi_name":"列表中的名称","reason":"简短原因","text":"..."}
action=speak 时 text 与 poi_name 必填；action=skip 时 text 与 poi_name 均为空字符串。只输出 JSON。`
}

const SPEAK_LENGTH_SPEC: Record<string, { min: number; max: number; maxTokens: number }> = {
  short: { min: 80, max: 160, maxTokens: 400 },
  medium: { min: 150, max: 280, maxTokens: 700 },
  long: { min: 280, max: 450, maxTokens: 1000 },
}

async function proactiveGuideDecision(
  userContent: string,
  logPrompt: (label: string, messages: Array<{ role: string; content: string }>) => void,
  speakLength: string = 'short',
) {
  if (!DEEPSEEK_API_KEY) {
    return { action: 'skip' as const, reason: 'no api key', text: '', poi_name: '' }
  }

  const spec = SPEAK_LENGTH_SPEC[speakLength] ?? SPEAK_LENGTH_SPEC.short
  const messages = [
    { role: 'system', content: buildProactiveGuidePrompt(spec.min, spec.max) },
    { role: 'user', content: userContent },
  ]
  logPrompt('主动讲解判定', messages)

  const res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: DEEPSEEK_JUDGE_MODEL,
      messages,
      temperature: 0.3,
      max_tokens: spec.maxTokens,
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' },
    }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    return { action: 'skip' as const, reason: 'llm failed', text: '', poi_name: '' }
  }

  const raw = data?.choices?.[0]?.message?.content
  if (typeof raw !== 'string' || !raw.trim()) {
    return { action: 'skip' as const, reason: 'empty llm', text: '', poi_name: '' }
  }

  try {
    const parsed = JSON.parse(raw.replace(/```(?:json)?\s*([\s\S]*?)```/i, '$1').trim())
    const action = String(parsed.action ?? 'skip').toLowerCase()
    const text = stripModelThinking(String(parsed.text ?? ''))
    const poi_name = String(parsed.poi_name ?? '').trim()
    if (action === 'speak' && text.trim()) {
      return {
        action: 'speak' as const,
        reason: String(parsed.reason ?? ''),
        text: text.trim(),
        poi_name,
      }
    }
    return {
      action: 'skip' as const,
      reason: String(parsed.reason ?? 'not interesting'),
      text: '',
      poi_name: '',
    }
  } catch {
    return { action: 'skip' as const, reason: 'bad json', text: '', poi_name: '' }
  }
}

function mapHitToPayload(mapHit: MapHit | null) {
  if (!mapHit) return null
  return {
    name: mapHit.name,
    category: mapHit.category,
    distance_m: mapHit.distance_m,
    direction: mapHit.direction,
    source: mapHit.source,
    lat: mapHit.lat,
    lng: mapHit.lng,
    amap_poi_id: mapHit.amap_poi_id ?? null,
    osm_tags: mapHit.tags,
  }
}

async function processProactiveGuide(
  req: Request,
  body: Record<string, unknown>,
  dbg: ReturnType<typeof createDbg>,
  includeDebugPayload: boolean,
) {
  const latitude = Number(body?.latitude)
  const longitude = Number(body?.longitude)
  const headingRaw =
    body?.heading == null || body?.heading === '' ? null : Number(body.heading)
  const heading =
    headingRaw != null && Number.isFinite(headingRaw) ? headingRaw : null
    const spokenKeys = parseSpokenPoiKeys(body)
  const speakLengthRaw = String(body?.speak_length ?? 'short').toLowerCase()
  const speakLength = speakLengthRaw in SPEAK_LENGTH_SPEC ? speakLengthRaw : 'short'
  const geoRadiusPrefs = normalizeGeoRadiusPrefs(
    body?.geo_radius_prefs && typeof body.geo_radius_prefs === 'object'
      ? (body.geo_radius_prefs as Record<string, number>)
      : null,
  )

dbg.mark('主动讲解请求')

  const { userId, deviceKey } = await parseQuotaAuth(req, {
    device_id: body?.device_id as string | undefined,
  })

  let quota: QuotaStatus
  try {
    quota = await consumeOneAsk(adminClient(), { userId, deviceKey })
  } catch (e) {
    if (e instanceof QuotaExhaustedError) throw e
    throw e
  }
  dbg.mark('额度扣减', `剩余 ${quota.remaining}/${quota.limit}`)

  dbg.mark('逆地理', '开始')
  const geoCtx = await resolveGeoContext(adminClient(), latitude, longitude)
  const localRegeo = geoCtx.text
  const scenicRadius = resolveProactiveScenicRadius({
    scene: geoCtx.scene,
    prefs: geoRadiusPrefs,
  })
  dbg.mark(
    '逆地理',
    `[${geoCtx.source}] ${[geoCtx.province, geoCtx.city, geoCtx.county, geoCtx.township].filter(Boolean).join('') || '未命中行政区'}` +
      `${geoCtx.road ? ` · ${geoCtx.road}` : ''} · ${geoCtx.scene}`,
  )
  dbg.mark('场景半径', scenicRadius.formula)

  const cachedCandidates = parseCachedScenicCandidates(
    body,
    latitude,
    longitude,
    heading,
  )
  let allCandidates: ProactiveCandidate[]
  if (cachedCandidates) {
    allCandidates = cachedCandidates.filter(
      (c) => c.distance_m <= scenicRadius.radiusM * 1.05,
    )
    dbg.mark(
      '景点候选',
      `客户端风景库 ${cachedCandidates.length} → 场景圈内 ${allCandidates.length}（${scenicRadius.formula}）`,
    )
    // 圈内太少则补搜
    if (allCandidates.length < 2) {
      dbg.mark('景点候选', `圈内不足，补搜风景名胜 ${scenicRadius.radiusKm}km`)
      const scenicPois = await fetchScenicPois(
        latitude,
        longitude,
        scenicRadius.radiusKm,
      )
      allCandidates = enrichProactiveCandidates(
        buildProactiveCandidates(scenicPois, latitude, longitude, heading),
        latitude,
        longitude,
        heading,
      )
    } else {
      allCandidates = enrichProactiveCandidates(
        allCandidates,
        latitude,
        longitude,
        heading,
      )
    }
  } else {
    dbg.mark('景点候选', `风景名胜 ${scenicRadius.radiusKm}km · ${scenicRadius.formula}`)
    const scenicPois = await fetchScenicPois(
      latitude,
      longitude,
      scenicRadius.radiusKm,
    )
    allCandidates = enrichProactiveCandidates(
      buildProactiveCandidates(scenicPois, latitude, longitude, heading),
      latitude,
      longitude,
      heading,
    )
  }

  const forcePoiName = String(body?.force_poi_name ?? '').trim()
  const forceLat = Number(body?.force_poi_lat)
  const forceLng = Number(body?.force_poi_lng)
  const forceType = String(body?.force_poi_type ?? '').trim() || '景点'
  if (forcePoiName) {
    let forced =
      matchCandidateByName(allCandidates, forcePoiName) ??
      allCandidates.find((c) => c.name === forcePoiName) ??
      null
    if (
      !forced &&
      Number.isFinite(forceLat) &&
      Number.isFinite(forceLng)
    ) {
      const distance_m = Math.round(haversineM(latitude, longitude, forceLat, forceLng))
      const direction = bearingLabel(
        bearingTo(latitude, longitude, forceLat, forceLng),
        heading,
      )
      forced = {
        name: forcePoiName,
        type: forceType,
        distance_m,
        direction,
        lat: forceLat,
        lng: forceLng,
        amap_poi_id: null,
        spoken_key: normalizePoiNameKey(forcePoiName),
      }
    }
    if (forced) {
      allCandidates = [forced]
      dbg.mark('Dev 指定 POI', `${forced.name} · ${forced.direction} · ${forced.distance_m}m`)
    } else {
      dbg.mark('Dev 指定 POI', `未匹配到「${forcePoiName}」，仍用全量候选`)
    }
  }

  const candidates = forcePoiName
    ? allCandidates
    : allCandidates.filter((c) => !isSpokenCandidate(c, spokenKeys))
  dbg.mark(
    '候选去重',
    forcePoiName
      ? `Dev 强制 · ${candidates.length} 条`
      : `原始 ${allCandidates.length} → 当日未讲 ${candidates.length}` +
          (spokenKeys.size ? `（已讲键 ${spokenKeys.size}）` : ''),
  )

  const geoHint = coordsGeoHint(latitude, longitude)

  let footprintHint = ''
  if (userId) {
    const supabase = adminClient()
    const nearby = await fetchNearbyFootprints(supabase, userId, latitude, longitude)
    const related = filterFootprintsForCue(
      nearby,
      candidates.map((c) => c.name),
    )
    if (nearby.length && !related.length) {
      dbg.mark(
        '足迹 cue 过滤',
        `附近 ${nearby.length} 条均与候选专名无关，不注入`,
      )
    } else if (related.length) {
      dbg.mark(
        '足迹 cue 过滤',
        `附近 ${nearby.length} → 专名相关 ${related.length}`,
      )
      footprintHint = related
        .map(
          (c, i) =>
            `${i + 1}. ${c.poi_name}（${c.title || '无标题'}）距此 ${Math.round(c.distance_m)}m，到访 ${c.visit_count} 次`,
        )
        .join('\n')
    }
  }

  const quotaPayload = {
    tier: quota.tier,
    remaining: quota.remaining,
    limit: quota.limit,
  }

  if (candidates.length === 0) {
    dbg.mark('主动讲解判定完成', 'skip · 无可用候选')
    const payload: Record<string, unknown> = {
      proactive: true,
      skipped: true,
      skip_reason: allCandidates.length === 0 ? '附近无候选 POI' : '附近候选今日均已讲过',
      answer: '',
      map_hit: null,
      footprint: null,
      quota: quotaPayload,
    }
    if (includeDebugPayload) {
      payload.debug = {
        timeline: dbg.steps(),
        total_ms: dbg.total(),
        logged_in: Boolean(userId),
        user_id: userId,
        candidates: allCandidates.map((c) => c.name),
      }
    }
    return payload
  }

  const candidateHint = candidates
    .map(
      (p, i) =>
        `${i + 1}. ${p.name}｜${p.direction}｜约${formatProactiveDistance(p.distance_m)}｜${p.type || '景点'}` +
        (p.amap_poi_id ? `｜id=${p.amap_poi_id}` : ''),
    )
    .join('\n')

  const userContent = [
    '## 用户位置',
    `纬度 ${latitude.toFixed(6)}，经度 ${longitude.toFixed(6)}`,
    heading != null ? `朝向约 ${Math.round(heading)}°` : '朝向未知',
    `场景判定：${scenicRadius.scene}；搜索半径：${scenicRadius.formula}`,
    '',
    '## 坐标地理提示',
    geoHint,
    '',
    '## 当前位置',
    localRegeo ?? '（未命中行政区）',
    '',
    '## 候选 POI 列表（仅风景名胜；含方位与距离；必须从中选恰好一个）',
    '格式：序号. 名称｜相对车头方位｜距离｜类型',
    candidateHint,
    '',
    '## 用户历史足迹（已按专名与候选相关过滤；无关勿提）',
    footprintHint || '（无相关足迹）',
  ].join('\n')

  dbg.mark('主动讲解判定开始')
  const decision = await proactiveGuideDecision(
    userContent,
    dbg.logPrompt.bind(dbg),
    speakLength,
  )

  let selected =
    decision.action === 'speak' ? matchCandidateByName(candidates, decision.poi_name) : null
  let speakText = decision.text.trim()

  // 有候选时强制开口：名称对不上 / 空文案时回退到最近候选
  if (!selected) {
    selected = candidates[0]
    dbg.mark(
      '主动讲解回退',
      decision.poi_name
        ? `名称「${decision.poi_name}」未命中，改用 ${selected.name}`
        : `未选点，改用 ${selected.name}`,
    )
  }
  if (!speakText) {
    speakText = `这边是${selected.name}。`
    dbg.mark('主动讲解回退', '空文案，使用兜底口播')
  }

  dbg.mark(
    '主动讲解判定完成',
    `speak · ${selected.name}${decision.reason ? ` · ${decision.reason}` : ''}`,
  )

  const selectedHit = candidateToMapHit(selected)
  const payload: Record<string, unknown> = {
    proactive: true,
    skipped: false,
    skip_reason: null,
    answer: speakText.trim(),
    map_hit: mapHitToPayload(selectedHit),
    footprint: null,
    quota: quotaPayload,
    /** 客户端并入黄点库：含场景圈内/补搜候选，避免「讲了但地图无黄点」 */
    scenic_library_upsert: allCandidates.slice(0, 40).map((c) => ({
      name: c.name,
      lat: c.lat,
      lng: c.lng,
      distance_m: c.distance_m,
      type: c.type,
      amap_poi_id: c.amap_poi_id ?? null,
    })),
  }

  if (includeDebugPayload) {
    payload.debug = {
      timeline: dbg.steps(),
      total_ms: dbg.total(),
      logged_in: Boolean(userId),
      user_id: userId,
      selected_poi: selected.name,
      candidates: candidates.map((c) => c.name),
    }
  }

  return payload
}

async function processAsk(
  req: Request,
  body: Record<string, unknown>,
  dbg: ReturnType<typeof createDbg>,
  includeDebugPayload: boolean,
) {
  const latitude = Number(body?.latitude)
  const longitude = Number(body?.longitude)
  const headingRaw = body?.heading == null ? null : Number(body.heading)
  const heading = headingRaw != null && Number.isFinite(headingRaw) ? headingRaw : null
  const userMessage = String(body?.user_message ?? '').trim().slice(0, 2000)
  if (!userMessage) return json({ error: 'user_message is required' }, 400)

  dbg.mark('追问请求', `${userMessage.length}字`)

  const { userId, deviceKey } = await parseQuotaAuth(req, {
    device_id: body?.device_id as string | undefined,
  })
  const quota = await consumeOneAsk(adminClient(), { userId, deviceKey })
  dbg.mark('额度扣减', `剩余 ${quota.remaining}/${quota.limit}`)
  const db = adminClient()
  dbg.mark('上下文准备', `历史 ${Array.isArray(body?.conversation) ? body.conversation.length : 0} 条`)
  const geo = await resolveGeoContext(db, latitude, longitude)
  const nearby = await lookupNearbyLandmarks({ lat: latitude, lng: longitude, heading })
  const context = body?.proactive_context && typeof body.proactive_context === 'object'
    ? body.proactive_context as Record<string, unknown>
    : null
  const conversation = Array.isArray(body?.conversation)
    ? body.conversation.slice(-12).map((m) => ({
        role: m?.role === 'assistant' ? 'assistant' : 'user',
        content: String(m?.content ?? '').slice(0, 1200),
      }))
    : []
  const messages = [
    {
      role: 'system',
      content: `你是路鸽，回答用户关于当前位置、路线和周边地理对象的问题。回答要口语化、简洁、适合语音播报。

对话衔接规则：
- 如果用户说“这个塔”“它”“刚才那个”等，而最近对话中只有一个合理对象，直接把它理解为该对象并回答，不要重复确认“您说的是……吧”，也不要把用户已经明确的内容再复述一遍。
- 只有存在两个或以上同样合理的指代对象时，才用一句话澄清；否则直接回答问题。
- 语音识别（ASR）可能有同音字、错字、漏字或断句错误。不要逐字纠正，也不要因为转写不准确就让用户重新说一遍；结合上下文、刚才的主动讲解、当前位置和问句结构，揣摩用户最可能的主要含义并直接回答。只有存在两个同样合理、且会导致答案明显不同的理解时，才简短澄清。
- 不要向用户暴露“数据库、知识库、检索链路、模型”等内部实现。
- 如果没有可靠的具体资料，使用自然表达：“我查了一下，目前没有找到可靠的具体记载。”随后可以补充常识或推论，但必须明确说“结合现有资料推测”或“这部分只是推测”，不能编造精确年代、人物或事件。
- 已知事实和推测分开表达，优先回答用户真正问的内容，不要以免责声明开头。

当前位置：${geo.text || '未知'}。周边地标：
${formatLandmarksForLlm(nearby.landmarks, { lat: latitude, lng: longitude, heading, note: nearby.note })}${context ? `
刚才主动讲解的对象：${String(context.poi_name ?? '')}。当用户使用明确指代追问时，默认延续这个对象。` : ''}`,
    },
    ...conversation,
    { role: 'user', content: userMessage },
  ]
  dbg.logPrompt('追问', messages)
  if (!DEEPSEEK_API_KEY) throw new Error('问答服务未配置')
  const res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: DEEPSEEK_MODEL, messages, temperature: 0.3, max_tokens: 600, thinking: { type: 'disabled' } }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error('问答模型请求失败')
  const answer = stripModelThinking(String(data?.choices?.[0]?.message?.content ?? '')).trim()
  if (!answer) throw new Error('路鸽没有生成回答')
  dbg.mark('问答模型完成', `${answer.length}字`)

  let footprint: Record<string, unknown> | null = null
  if (userId) {
    const candidates = await fetchNearbyFootprints(db, userId, latitude, longitude)
    const classified = await classifyFootprint(
      userMessage,
      geo.text || '',
      candidates,
      undefined,
      context && typeof context.poi_name === 'string'
        ? { poi_name: context.poi_name, lat: Number(context.lat) || latitude, lng: Number(context.lng) || longitude, category: String(context.category ?? '') }
        : null,
    )
    if (classified.decision.action !== 'skip') {
      const written = await applyFootprintDecision(db, userId, classified.decision, {
        userMessage,
        assistantMessage: answer,
        userLat: latitude,
        userLng: longitude,
        heading,
      })
      footprint = { ...written, action: classified.decision.action }
    }
  }
  const payload: Record<string, unknown> = {
    answer,
    proactive: false,
    skipped: false,
    map_hit: null,
    footprint,
    quota: { tier: quota.tier, remaining: quota.remaining, limit: quota.limit },
  }
  if (includeDebugPayload) {
    payload.debug = {
      timeline: dbg.steps(),
      total_ms: dbg.total(),
      logged_in: Boolean(userId),
      user_id: userId,
      user_message: userMessage,
      conversation,
      proactive_context: context,
      answer,
    }
  }
  return json(payload)
}

/** 开发者地图：候选主动讲解 POI，不扣次、不调 LLM */
async function processProactivePreview(
  body: Record<string, unknown>,
  dbg: ReturnType<typeof createDbg>,
) {
  const latitude = Number(body?.latitude)
  const longitude = Number(body?.longitude)
  const headingRaw =
    body?.heading == null || body?.heading === '' ? null : Number(body.heading)
  const heading =
    headingRaw != null && Number.isFinite(headingRaw) ? headingRaw : null
  const spokenKeys = parseSpokenPoiKeys(body)
  const returnRawLibrary = Boolean(body?.return_raw_library)

  const scenicRadiusKm = Math.min(
    50,
    Math.max(1, Number(body?.scenic_radius_km) || 8),
  )

  dbg.mark('主动讲解预览', `风景名胜 ${scenicRadiusKm}km`)
  const scenicPois = await fetchScenicPois(latitude, longitude, scenicRadiusKm)
  const library = scenicPois
    .filter((p) => p.lat != null && p.lng != null)
    .map((p) => ({
      name: p.name,
      lat: p.lat as number,
      lng: p.lng as number,
      rating: p.rating,
      distance_m: p.distance_m,
      type: p.type,
      amap_poi_id: p.amap_poi_id,
    }))

  const allCandidates = buildProactiveCandidates(
    scenicPois,
    latitude,
    longitude,
    heading,
  )
  const candidates = allCandidates
    .filter((c) => !isSpokenCandidate(c, spokenKeys))
    .slice(0, 40)
    .map((p) => ({
      name: p.name,
      lat: p.lat,
      lng: p.lng,
      rating: null as number | null,
      distance_m: p.distance_m,
      type: p.type,
      amap_poi_id: p.amap_poi_id,
    }))

  return {
    preview: true,
    candidates,
    /** 完整周边库（未做当日已讲过滤），供客户端整库替换缓存 */
    library: returnRawLibrary ? library : undefined,
    forward_map_hit: null,
  }
}

function stripModelThinking(raw: string): string {
  let text = raw.trim()
  if (!text) return ''

  text = text
    .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking\b[^>]*>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<reasoning\b[^>]*>[\s\S]*?<\/reasoning>/gi, '')
    .replace(/```(?:thinking|reasoning)[\s\S]*?```/gi, '')
    .trim()

  // 部分模型把思考写在正文前，用「最终回答：」等分隔
  const splitMarkers = [
    /(?:^|\n)\s*(?:最终回答|最终答复|回答|答：)\s*[:：]\s*/i,
    /(?:^|\n)\s*#{1,3}\s*(?:最终回答|回答)\s*\n+/i,
  ]
  for (const re of splitMarkers) {
    const m = text.match(re)
    if (m && m.index != null && m.index > 80) {
      text = text.slice(m.index + m[0].length).trim()
      break
    }
  }

  return text.trim()
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
    const modeRaw = typeof body?.mode === 'string' ? body.mode.trim() : ''
    if (modeRaw !== 'ask' && modeRaw !== 'proactive' && modeRaw !== 'proactive_preview') {
      return json(
        { error: 'mode must be ask, proactive or proactive_preview' },
        400,
      )
    }
    const mode = modeRaw as 'ask' | 'proactive' | 'proactive_preview'
    const latitude = Number(body?.latitude)
    const longitude = Number(body?.longitude)

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return json({ error: 'latitude and longitude are required' }, 400)
    }

    const wantDebug =
      body?.debug === true ||
      req.headers.get('x-luge-debug') === '1' ||
      Deno.env.get('LUGE_DEBUG') === '1'

    if (mode === 'proactive_preview') {
      if (req.headers.get('x-luge-debug') !== '1') {
        return json({ error: 'proactive_preview requires X-Luge-Debug' }, 403)
      }
      const dbg = createDbg(false)
      const payload = await processProactivePreview(body, dbg)
      return json(payload)
    }

    // Await here so business errors (including quota exhaustion) are handled
    // by the outer catch and returned with their proper HTTP status.
    if (modeRaw === 'ask') {
      const dbg = createDbg(wantDebug)
      return await processAsk(req, body, dbg, wantDebug)
    }

    if (wantDebug) {
      const stream = new ReadableStream({
        async start(controller) {
          const enc = new TextEncoder()
          const write = (obj: unknown) => {
            controller.enqueue(enc.encode(JSON.stringify(obj) + '\n'))
          }
          const dbg = createDbg(true, {
            onStep: (e) => write({ event: 'step', ...e }),
            onPrompt: (p) => write({ event: 'prompt', ...p }),
          })
          try {
            const payload = await processProactiveGuide(req, body, dbg, false)
            write({ event: 'done', ...payload })
          } catch (e) {
            if (e instanceof QuotaExhaustedError) {
              write({
                event: 'error',
                status: 402,
                error: 'quota exhausted',
                code: 'QUOTA_EXHAUSTED',
                tier: e.tier,
                register_bonus: e.register_bonus,
              })
            } else {
              const msg = e instanceof Error ? e.message : 'internal error'
              write({ event: 'error', error: msg })
            }
          } finally {
            controller.close()
          }
        },
      })
      return new Response(stream, {
        headers: { ...corsHeaders, 'Content-Type': 'application/x-ndjson' },
      })
    }

    const dbg = createDbg(false)
    const payload = await processProactiveGuide(req, body, dbg, false)
    return json(payload)
  } catch (err) {
    if (err instanceof QuotaExhaustedError) {
      return json(
        {
          error: 'quota exhausted',
          code: 'QUOTA_EXHAUSTED',
          tier: err.tier,
          register_bonus: err.register_bonus,
        },
        402,
      )
    }
    console.error('luge-chat error:', err)
    const msg = err instanceof Error ? err.message : 'internal error'
    return json({ error: msg }, 500)
  }
})
