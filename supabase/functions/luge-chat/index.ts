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
  getUserIdFromRequest,
  loadFootprintMemory,
  summarizeVisitAndFootprint,
  type FootprintDecision,
  type ProactivePoiContext,
} from './footprint.ts'
import {
  fetchNearbyGeoLandmarks,
  geoLandmarkToMapHit,
  inferLandmarkType,
  pickBestGeoLandmark,
  recordGeoLandmarkSignal,
  type LandmarkMapHit,
} from './landmarkCache.ts'
import {
  consumeOneAsk,
  parseQuotaAuth,
  QuotaExhaustedError,
  type QuotaStatus,
} from './quota.ts'

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
const DEEPSEEK_ANSWER_MODEL = Deno.env.get('DEEPSEEK_ANSWER_MODEL') ?? DEEPSEEK_MODEL
const AMAP_WEB_KEY = Deno.env.get('AMAP_WEB_KEY')

const SYSTEM_PROMPT = `你是「路鸽」，一位专业、幽默、适合车载场景的自驾游 AI 语音导游。

你会收到：
1) 用户当前 GPS 坐标，以及可选的「朝向」（车头/行进方向，正北为 0°）；朝向可能标注为未知；
2) 高德地图 / OpenStreetMap 检索到的周边地理要素（山川、河流、城镇、景点、桥梁等；有朝向时会标左前方/右前方等）；
3) 逆地理编码得到的地址上下文；
4) 联网检索到的摘要片段（如有）；
5) 用户历史足迹记忆（如有）；
6) 用户的自然语言提问（可以是路上任何地理、历史、人文、城镇风物问题）。

回答要求：
- 用口语化中文，适合 TTS 朗读，控制在 150～280 字，除非用户明确要求更详细；
- 先直接回答用户问题，再补充 1～2 个旅途趣味点；
- 若地图上下文不足以支撑结论，诚实说明，并基于坐标与地理常识做合理推断，标注「推测」；
- 若提供了历史足迹，可自然提及「您此前来过」等，但不要生硬；
- 引用联网资料时融入叙述，不要列链接；
- 禁止编造确切数据（如精确海拔、未证实的传说），不确定时要说明。
- 关于朝向：仅当用户问题里出现相对自身的方位词（如左边、右边、前方、右前方、后面等），且上下文写明「朝向未知」时，才可简短说明暂时无法判断他的朝向、改按附近介绍；若用户没问左右前后，不要主动提朝向问题。有可靠朝向时，可自然使用「您右前方」等表述。`

const RECENT_CHAT_NOTE = `近期对话说明：messages 里可能出现本轮之前的 user/assistant 往返（含路鸽主动讲解）。请结合近期对话理解「它」「那里」「刚才说的」等指代；若与当前 GPS/地图矛盾，以当前位置与地图为准，并自然衔接上文。`

const CHAT_WINDOW_MAX_MESSAGES = 20
const CHAT_MESSAGE_MAX_LEN = 2000

type ChatTurnMessage = { role: 'user' | 'assistant'; content: string }

function parseRecentMessages(body: Record<string, unknown>): ChatTurnMessage[] {
  const raw = body.recent_messages
  if (!Array.isArray(raw)) return []

  const out: ChatTurnMessage[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const role = (item as ChatTurnMessage).role === 'assistant' ? 'assistant' : 'user'
    const content =
      typeof (item as ChatTurnMessage).content === 'string'
        ? (item as ChatTurnMessage).content.trim().slice(0, CHAT_MESSAGE_MAX_LEN)
        : ''
    if (!content) continue
    out.push({ role, content })
  }

  return out.slice(-CHAT_WINDOW_MAX_MESSAGES)
}

const SHOULD_ANSWER_PROMPT = `你是路鸽的“是否回答”判定器。你的任务不是回答问题，而是判断这句用户输入是否值得触发一次正式回答。

请输出 JSON：{"action":"answer"|"ignore","reason":"..."}

判定原则：
- answer：明确问题、地理提问、旅游/导游相关请求、打招呼唤醒、明显在对路鸽说话、需要继续对话的简短追问。
- ignore：语气词、口头禅、随口附和、背景视频/旁人说话片段、无明确意图的短碎句、仅有“嗯/啊/哦/好的/行/收到”等。
- 如果像是在和路鸽继续对话，即便很短，也可判 answer。
- 保守一点；不确定时优先 ignore，避免误触发。
- 只输出 JSON，不要 markdown。`

type StepLogger = { mark(step: string, detail?: string): void }

type MapHit = LandmarkMapHit

const geoBearingHelpers = {
  haversineM,
  bearingTo,
  bearingLabel,
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function toRad(deg: number) {
  return (deg * Math.PI) / 180
}

function toDeg(rad: number) {
  return (rad * 180) / Math.PI
}

/** 沿朝向向前推算一个点（米） */
function pointAhead(lat: number, lng: number, headingDeg: number, distanceM: number) {
  const R = 6371000
  const brng = toRad(headingDeg)
  const lat1 = toRad(lat)
  const lng1 = toRad(lng)
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(distanceM / R) +
      Math.cos(lat1) * Math.sin(distanceM / R) * Math.cos(brng),
  )
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(distanceM / R) * Math.cos(lat1),
      Math.cos(distanceM / R) - Math.sin(lat1) * Math.sin(lat2),
    )
  return { lat: toDeg(lat2), lng: toDeg(lng2) }
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

function bearingTo(lat1: number, lng1: number, lat2: number, lng2: number) {
  const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2))
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1))
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

function bearingLabel(bearing: number, reference: number | null) {
  if (reference == null || !Number.isFinite(reference)) return '附近'
  let diff = bearing - reference
  while (diff > 180) diff -= 360
  while (diff < -180) diff += 360
  const abs = Math.abs(diff)
  if (abs <= 25) return '正前方'
  if (abs >= 155) return '后方'
  if (diff > 0) return '右前方'
  return '左前方'
}

function pickOsmWaterName(tags: Record<string, string>) {
  return (
    tags['name:zh'] ||
    tags.name ||
    tags['name:en'] ||
    tags['official_name'] ||
    '未命名水体'
  )
}

const NON_GEO_POI_RE =
  /街道办事处|居委会|派出所|酒店|宾馆|公寓|民宿|茶坊|超市|办证|桃酥|糕点|糕饼|银行|商场|餐厅|饭店|烧烤|奶茶|咖啡|药店|诊所|医院|学校|幼儿园|培训|物业|中介|装修|五金|洗车|维修|4S|加油站|停车场|充电桩|小区|楼盘|花园$/
const GEO_AMAP_TYPE_RE =
  /风景名胜|水系|河流|湖泊|湿地|自然|地名|山峰|山脉|桥|古镇|乡镇|公园|博物馆|寺庙|遗址|文物|雕塑|观景点|国家森林公园|风景区|行政区/

function poiLooksLikeGeoLandmark(poi: AmapPoi) {
  const name = poi.name ?? ''
  const type = poi.type ?? ''

  if (NON_GEO_POI_RE.test(name) || /餐饮|住宿|购物|生活服务|金融|公司企业|汽车服务|摩托车服务/.test(type)) {
    return false
  }
  if (/小区|楼盘|停车场|加油站|地铁站|公交站|路口$|^\d|便利店|生鲜/.test(name)) return false

  if (GEO_AMAP_TYPE_RE.test(type)) return true

  const stem = name.split(/[()（）]/)[0].trim()
  if (/[山川峰岭江河溪湖渠湾镇乡村桥寺塔园]$/.test(stem)) return true
  if (/公园|景区|遗址|博物馆|古城|古镇|雪山|草原|湿地|大坝|关卡|口岸|垭口|瀑布|峡谷|草原/.test(name)) {
    return true
  }
  if (/地名地址/.test(type) && /[镇乡村]$/.test(stem)) return true

  return false
}

type AmapPoi = {
  id?: string
  name?: string
  type?: string
  address?: string
  location?: string
  distance?: string
  tel?: string
  pname?: string
  cityname?: string
  adname?: string
  rating?: string
  biz_ext?: string
}

function parsePoiRating(poi: AmapPoi): number | null {
  if (poi.rating != null && poi.rating !== '') {
    const r = Number(poi.rating)
    if (Number.isFinite(r) && r > 0) return r
  }
  if (poi.biz_ext) {
    try {
      const ext = JSON.parse(poi.biz_ext) as { rating?: string | number }
      const r = Number(ext.rating)
      if (Number.isFinite(r) && r > 0) return r
    } catch {
      /* ignore */
    }
  }
  return null
}

async function amapRatedScenicPois(lat: number, lng: number, minRating: number) {
  if (!AMAP_WEB_KEY) return []

  const data = await amapGet<{ pois?: AmapPoi[] }>('/v3/place/around', {
    location: `${lng.toFixed(6)},${lat.toFixed(6)}`,
    types: '风景名胜',
    radius: '8000',
    offset: '15',
    extensions: 'all',
    sortrule: 'weight',
  })

  const rows = (data?.pois ?? [])
    .map((poi) => {
      const pos = poi.location ? parseAmapLngLat(poi.location) : null
      const rating = parsePoiRating(poi)
      const distance_m = poi.distance
        ? Math.round(Number(poi.distance))
        : pos
          ? Math.round(haversineM(lat, lng, pos.lat, pos.lng))
          : null
      return {
        name: poi.name ?? '未命名',
        type: poi.type ?? '',
        address: poi.address ?? '',
        rating,
        distance_m,
      }
    })
    .filter((row) => row.distance_m != null)

  if (minRating > 0) {
    return rows.filter((row) => row.rating != null && row.rating >= minRating)
  }
  return rows
}

async function amapGet<T>(path: string, params: Record<string, string>) {
  if (!AMAP_WEB_KEY) return null
  const qs = new URLSearchParams({ ...params, key: AMAP_WEB_KEY })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const res = await fetch(`https://restapi.amap.com${path}?${qs}`, {
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) return null
    const data = await res.json()
    if (data.status !== '1' && data.status !== 1) {
      console.warn('amap error:', data.info ?? data)
      return null
    }
    return data as T
  } catch (e) {
    clearTimeout(timer)
    console.warn('amap fetch failed:', e)
    return null
  }
}

function parseAmapLngLat(location: string) {
  const [lng, lat] = location.split(',').map(Number)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { lat, lng }
}

function amapPoiToMapHit(
  poi: AmapPoi,
  userLat: number,
  userLng: number,
  heading: number | null,
): MapHit | null {
  if (!poi.location || !poi.name) return null
  if (!poiLooksLikeGeoLandmark(poi)) return null
  const pos = parseAmapLngLat(poi.location)
  if (!pos) return null

  const distance_m = poi.distance
    ? Math.round(Number(poi.distance))
    : Math.round(haversineM(userLat, userLng, pos.lat, pos.lng))
  const bearing = bearingTo(userLat, userLng, pos.lat, pos.lng)

  return {
    name: poi.name,
    category: poi.type?.split(';')[0] ?? '地理要素',
    distance_m,
    direction: bearingLabel(bearing, heading),
    lat: pos.lat,
    lng: pos.lng,
    source: 'amap',
    amap_poi_id: poi.id ?? null,
    tags: {
      name: poi.name,
      type: poi.type ?? '',
      address: poi.address ?? '',
      tel: poi.tel ?? '',
      province: poi.pname ?? '',
      city: poi.cityname ?? '',
      district: poi.adname ?? '',
    },
  }
}

async function amapAroundGeoPois(lat: number, lng: number, radius: number) {
  const data = await amapGet<{ pois?: AmapPoi[] }>('/v3/place/around', {
    location: `${lng.toFixed(6)},${lat.toFixed(6)}`,
    types: '风景名胜|地名地址信息',
    radius: String(radius),
    offset: '20',
    extensions: 'all',
    sortrule: 'distance',
  })
  return data?.pois ?? []
}

async function amapRegeoContext(lat: number, lng: number) {
  const data = await amapGet<{
    regeocode?: {
      formatted_address?: string
      addressComponent?: Record<string, string>
      pois?: AmapPoi[]
    }
  }>('/v3/geocode/regeo', {
    location: `${lng.toFixed(6)},${lat.toFixed(6)}`,
    extensions: 'all',
    radius: '1000',
    poitype: '风景名胜|地名地址信息',
  })

  const rg = data?.regeocode
  if (!rg) return { text: null, geoPois: [] as AmapPoi[] }

  const lines: string[] = []
  if (rg.formatted_address) lines.push(`格式化地址：${rg.formatted_address}`)
  const ac = rg.addressComponent as Record<string, unknown> | undefined
  if (ac) {
    lines.push(
      `行政区：${[ac.province, ac.city, ac.district, ac.township].filter(Boolean).join('')}`,
    )
    const sn = ac.streetNumber as { street?: string; number?: string } | undefined
    if (sn?.street) {
      lines.push(`街道：${sn.street}${sn.number ?? ''}`)
    }
  }
  const geoPois = (rg.pois ?? []).filter(poiLooksLikeGeoLandmark).slice(0, 8)
  if (geoPois.length) {
    lines.push(
      '附近地理 POI：' +
        geoPois.map((p) => `${p.name}（${p.address ?? p.type ?? ''}）`).join('；'),
    )
  }
  return { text: lines.length ? lines.join('\n') : null, geoPois }
}

async function findAmapMapContext(
  lat: number,
  lng: number,
  heading: number | null,
): Promise<{ map_hit: MapHit | null; regeo: string | null }> {
  if (!AMAP_WEB_KEY) return { map_hit: null, regeo: null }

  const hasHeading = heading != null && Number.isFinite(heading)
  const nearUserP = amapAroundGeoPois(lat, lng, 2500)
  const ahead = hasHeading ? pointAhead(lat, lng, heading, 800) : null
  const nearAheadP = ahead
    ? amapAroundGeoPois(ahead.lat, ahead.lng, 3000)
    : Promise.resolve([] as AmapPoi[])
  const regeoP = amapRegeoContext(lat, lng)

  const [nearUser, nearAhead, regeo] = await Promise.all([
    nearUserP,
    nearAheadP,
    regeoP,
  ])

  const merged = [
    ...nearAhead.map((p) => amapPoiToMapHit(p, lat, lng, heading)).filter(Boolean),
    ...nearUser.map((p) => amapPoiToMapHit(p, lat, lng, heading)).filter(Boolean),
    ...regeo.geoPois.map((p) => amapPoiToMapHit(p, lat, lng, heading)).filter(Boolean),
  ] as MapHit[]

  const seen = new Set<string>()
  const unique: MapHit[] = []
  for (const r of merged) {
    const key = `${r.name}:${Math.round(r.lat * 1000)}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(r)
  }

  unique.sort((a, b) => {
    if (!hasHeading) return a.distance_m - b.distance_m
    const aScore = (a.direction.includes('前') ? 0 : 2) + a.distance_m / 1000
    const bScore = (b.direction.includes('前') ? 0 : 2) + b.distance_m / 1000
    return aScore - bScore
  })

  return { map_hit: unique[0] ?? null, regeo: regeo.text }
}

async function queryOverpass(lat: number, lng: number, radiusM: number) {
  const query = `
[out:json][timeout:8];
(
  way["waterway"~"river|canal|stream|drain"](around:${radiusM},${lat},${lng});
  relation["waterway"~"river|canal"](around:${radiusM},${lat},${lng});
);
out body tags center;
`
  const url = 'https://overpass.kumi.systems/api/interpreter'
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 3000)
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'LugeChat/1.0 (contact@luge.chat)',
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

function parseOsmWaterFeatures(
  overpassJson: { elements?: Array<Record<string, unknown>> },
  userLat: number,
  userLng: number,
  heading: number | null,
): MapHit[] {
  const elements = overpassJson.elements ?? []
  const rivers: MapHit[] = []

  for (const el of elements) {
    const tags = (el.tags ?? {}) as Record<string, string>
    const center = el.center as { lat: number; lon: number } | undefined
    const lat = center?.lat ?? (el.lat as number | undefined)
    const lng = center?.lon ?? (el.lon as number | undefined)
    if (lat == null || lng == null) continue

    const distance_m = haversineM(userLat, userLng, lat, lng)
    const bearing = bearingTo(userLat, userLng, lat, lng)

    rivers.push({
      name: pickOsmWaterName(tags),
      category: tags.waterway,
      distance_m: Math.round(distance_m),
      direction: bearingLabel(bearing, heading),
      lat,
      lng,
      tags,
      source: 'osm',
    })
  }

  rivers.sort((a, b) => {
    if (heading == null) return a.distance_m - b.distance_m
    const aForward = a.direction.includes('前') ? 0 : 1
    const bForward = b.direction.includes('前') ? 0 : 1
    if (aForward !== bForward) return aForward - bForward
    return a.distance_m - b.distance_m
  })

  return rivers
}

async function findMapContext(
  lat: number,
  lng: number,
  heading: number | null,
  log?: StepLogger,
) {
  const hasHeading = heading != null && Number.isFinite(heading)
  const supabase = adminClient()

  log?.mark('地理缓存检索', '开始')
  const cachedRows = await fetchNearbyGeoLandmarks(supabase, lat, lng)
  const cachedBest = pickBestGeoLandmark(cachedRows, lat, lng, heading, geoBearingHelpers)
  if (cachedBest) {
    const map_hit = geoLandmarkToMapHit(cachedBest, lat, lng, heading, geoBearingHelpers)
    log?.mark('地理缓存检索', `${map_hit.name}（命中 ${cachedBest.hit_count} 次）`)
    const regeo = await amapRegeoContext(lat, lng)
    log?.mark('地图检索完成', `${map_hit.name}（cache）`)
    return { map_hit, amapRegeo: regeo.text }
  }
  log?.mark('地理缓存检索', '未命中')

  log?.mark('高德地图检索', '开始')
  const amap = await findAmapMapContext(lat, lng, heading)
  if (amap.map_hit) {
    log?.mark('高德地图检索', amap.map_hit.name)
    log?.mark('地图检索完成', `${amap.map_hit.name}（amap）`)
    return { map_hit: amap.map_hit, amapRegeo: amap.regeo }
  }
  log?.mark('高德地图检索', '未命中')

  const osmEnabled = Deno.env.get('LUGE_OSM') === '1'
  if (!osmEnabled) {
    log?.mark('OSM 兜底', '已跳过（国内默认关闭，设 LUGE_OSM=1 开启）')
    log?.mark('地图检索完成', '未命中显著地理要素')
    return { map_hit: null, amapRegeo: amap.regeo }
  }

  log?.mark('OSM 兜底', '开始')
  const ahead = hasHeading ? pointAhead(lat, lng, heading, 600) : null
  const [nearUser, nearAhead] = await Promise.all([
    queryOverpass(lat, lng, 450),
    ahead ? queryOverpass(ahead.lat, ahead.lng, 550) : Promise.resolve(null),
  ])

  const merged = [
    ...(nearAhead ? parseOsmWaterFeatures(nearAhead, lat, lng, heading) : []),
    ...(nearUser ? parseOsmWaterFeatures(nearUser, lat, lng, heading) : []),
  ]

  const seen = new Set<string>()
  const unique: MapHit[] = []
  for (const r of merged) {
    const key = `${r.name}:${r.category}:${Math.round(r.lat * 1000)}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(r)
  }

  unique.sort((a, b) => {
    if (!hasHeading) return a.distance_m - b.distance_m
    const aScore = (a.direction.includes('前') ? 0 : 2) + a.distance_m / 1000
    const bScore = (b.direction.includes('前') ? 0 : 2) + b.distance_m / 1000
    return aScore - bScore
  })

  const mapHit = unique[0] ?? null
  log?.mark('OSM 兜底', mapHit ? mapHit.name : '未命中')
  log?.mark('地图检索完成', mapHit ? `${mapHit.name}（osm）` : '未命中显著地理要素')
  return { mapHit, amapRegeo: amap.regeo }
}

async function fetchWikipediaSummary(title: string) {
  const encoded = encodeURIComponent(title.replace(/ /g, '_'))
  for (const base of [
    `https://zh.wikipedia.org/api/rest_v1/page/summary/${encoded}`,
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`,
  ]) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 2000)
      const res = await fetch(base, {
        headers: { 'User-Agent': 'LugeChat/1.0 (contact@luge.chat)' },
        signal: controller.signal,
      })
      clearTimeout(timer)
      if (!res.ok) continue
      const data = await res.json()
      if (typeof data.extract === 'string' && data.extract.length > 40) {
        return data.extract.slice(0, 1200)
      }
    } catch {
      /* try next */
    }
  }
  return null
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

function buildWebContext(searchTopic: string, userMessage: string) {
  if (Deno.env.get('LUGE_WEB_SEARCH') !== '1') {
    return [
      '（未启用联网检索，请依据地图上下文、坐标提示与自身知识回答。）',
      `【用户提问】${userMessage}`,
    ].join('\n\n')
  }
  return null
}

async function webSearchSnippets(searchTopic: string, userMessage: string) {
  const skipped = buildWebContext(searchTopic, userMessage)
  if (skipped) return skipped

  const snippets: string[] = []
  const wikiTitle = searchTopic.replace(/未命名水体/, '').trim()
  if (wikiTitle) {
    const wiki = await fetchWikipediaSummary(wikiTitle)
    if (wiki) snippets.push(`【维基百科·${wikiTitle}】${wiki}`)
  }

  const ddgQ = encodeURIComponent(`${searchTopic} ${userMessage.slice(0, 40)} 地理 历史`)
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 2000)
    const res = await fetch(
      `https://api.duckduckgo.com/?q=${ddgQ}&format=json&no_html=1&skip_disambig=1`,
      { signal: controller.signal },
    )
    clearTimeout(timer)
    if (res.ok) {
      const data = await res.json()
      if (typeof data.Abstract === 'string' && data.Abstract.length > 20) {
        snippets.push(`【DuckDuckGo】${data.Abstract}`)
      }
      const topics = (data.RelatedTopics ?? []) as Array<{ Text?: string }>
      for (const t of topics.slice(0, 3)) {
        if (t.Text) snippets.push(t.Text.slice(0, 280))
      }
    }
  } catch {
    /* optional */
  }

  if (snippets.length === 0) {
    snippets.push('（联网检索未返回摘要，请主要依据坐标地理提示与自身知识回答，不确定处请说明。）')
  }

  snippets.push(`【用户提问】${userMessage}`)
  return snippets.join('\n\n')
}

async function askDeepseek(
  userContent: string,
  footprintMemory: string | null,
  recentMessages: ChatTurnMessage[],
  logPrompt: (label: string, messages: Array<{ role: string; content: string }>) => void,
) {
  if (!DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY is not configured')

  let system = footprintMemory
    ? `${SYSTEM_PROMPT}\n\n## 用户与此 POI 的历史足迹（供个性化回答）\n${footprintMemory}`
    : SYSTEM_PROMPT
  if (recentMessages.length > 0) {
    system = `${system}\n\n${RECENT_CHAT_NOTE}`
  }

  const messages = [
    { role: 'system', content: system },
    ...recentMessages.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userContent },
  ]
  logPrompt('主回答', messages)

  const res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: DEEPSEEK_ANSWER_MODEL,
      messages,
      temperature: 0.65,
      max_tokens: 800,
      thinking: { type: 'disabled' },
    }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg =
      (data?.error?.message as string | undefined) ||
      (typeof data.error === 'string' ? data.error : null) ||
      `deepseek error ${res.status}`
    throw new Error(msg)
  }

  const answer = data?.choices?.[0]?.message?.content
  // 绝不把 reasoning_content（思考链）给用户朗读
  const text = stripModelThinking(typeof answer === 'string' ? answer : '')
  if (!text) {
    throw new Error('deepseek returned empty response')
  }
  return text
}

const PROACTIVE_GUIDE_PROMPT = `你是路鸽的主动讲解调度员。用户正在自驾，没有主动提问。你只会收到当前位置、地图检索与可选的历史足迹。

任务：判断是否值得主动开口讲 **一件事**。默认必须 skip。

规则：
- 城市里 POI 很多，宁可不讲，也不要罗列；每次最多 speak 一个对象。
- 优先：附近/前方有辨识度的山川、河流、名胜、古镇、桥梁、垭口等；与用户历史足迹相关且值得重温的点。
- 若地图上下文含「沉淀讲解」，可吸收其要点，用自己的口语重新讲述，勿照读。
- 避免：楼盘、小区、商铺名；泛泛的「附近有很多公园」；重复无价值的常识。
- 若用户设置了景点评分门槛，打算讲「景点类 POI」时其 rating 必须达到门槛；河流、山川等无评分地标不受此限。
- 用户正在高速/郊野、窗外景观明显变化时，可更积极；纯市区通勤可更保守。
- speak 时 text 为 80～160 字口语化中文，适合 TTS，不要 markdown。

输出 JSON：{"action":"skip"|"speak","reason":"简短原因","text":"..."}
action=skip 时 text 为空字符串。只输出 JSON。`

async function proactiveGuideDecision(
  userContent: string,
  logPrompt: (label: string, messages: Array<{ role: string; content: string }>) => void,
) {
  if (!DEEPSEEK_API_KEY) {
    return { action: 'skip' as const, reason: 'no api key', text: '' }
  }

  const messages = [
    { role: 'system', content: PROACTIVE_GUIDE_PROMPT },
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
      max_tokens: 400,
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' },
    }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    return { action: 'skip' as const, reason: 'llm failed', text: '' }
  }

  const raw = data?.choices?.[0]?.message?.content
  if (typeof raw !== 'string' || !raw.trim()) {
    return { action: 'skip' as const, reason: 'empty llm', text: '' }
  }

  try {
    const parsed = JSON.parse(raw.replace(/```(?:json)?\s*([\s\S]*?)```/i, '$1').trim())
    const action = String(parsed.action ?? 'skip').toLowerCase()
    const text = stripModelThinking(String(parsed.text ?? ''))
    if (action === 'speak' && text.trim()) {
      return { action: 'speak' as const, reason: String(parsed.reason ?? ''), text: text.trim() }
    }
    return {
      action: 'skip' as const,
      reason: String(parsed.reason ?? 'not interesting'),
      text: '',
    }
  } catch {
    return { action: 'skip' as const, reason: 'bad json', text: '' }
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

function parseProactiveContext(body: Record<string, unknown>): ProactivePoiContext | null {
  const raw = body?.proactive_context
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const poi_name = typeof o.poi_name === 'string' ? o.poi_name.trim() : ''
  const lat = Number(o.lat)
  const lng = Number(o.lng)
  if (!poi_name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return {
    poi_name,
    amap_poi_id: typeof o.amap_poi_id === 'string' ? o.amap_poi_id : null,
    lat,
    lng,
    category: typeof o.category === 'string' ? o.category : undefined,
  }
}

function buildMapSection(mapHit: MapHit | null) {
  return mapHit
    ? [
        mapHit.source === 'cache'
          ? '数据源：路鸽地理缓存（此前问答沉淀）'
          : `数据源：${mapHit.source === 'amap' ? '高德地图' : 'OpenStreetMap'}`,
        `名称：${mapHit.name}`,
        `类型：${mapHit.category ?? '未知'}`,
        `相对位置：${mapHit.direction}，约 ${mapHit.distance_m} 米`,
        mapHit.cached_story ? `沉淀讲解：${mapHit.cached_story}` : '',
        `标签：${JSON.stringify(mapHit.tags)}`,
      ]
        .filter(Boolean)
        .join('\n')
    : '未在用户附近检索到明确的命名地理要素。'
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
  const minPoiRating = Math.max(0, Number(body?.min_poi_rating) || 0)

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

  dbg.mark('地图检索', '开始（缓存 + 高德全地理 POI）')
  const { map_hit: mapHit, amapRegeo } = await findMapContext(latitude, longitude, heading, dbg)

  dbg.mark('高德景点评分参考', minPoiRating > 0 ? `门槛 ≥${minPoiRating}` : '未启用')
  const scenicPois =
    minPoiRating > 0 ? await amapRatedScenicPois(latitude, longitude, minPoiRating) : []

  const geoHint = coordsGeoHint(latitude, longitude)

  let footprintHint = ''
  if (userId) {
    const supabase = adminClient()
    const nearby = await fetchNearbyFootprints(supabase, userId, latitude, longitude)
    if (nearby.length) {
      footprintHint = nearby
        .slice(0, 5)
        .map(
          (c, i) =>
            `${i + 1}. ${c.poi_name}（${c.title || '无标题'}）距此 ${Math.round(c.distance_m)}m，到访 ${c.visit_count} 次`,
        )
        .join('\n')
    }
  }

  const scenicHint =
    minPoiRating > 0
      ? scenicPois.length > 0
        ? scenicPois
            .slice(0, 6)
            .map(
              (p, i) =>
                `${i + 1}. ${p.name}（${p.type || '景点'}）距此 ${p.distance_m}m` +
                (p.rating != null ? `，评分 ${p.rating}` : '，无评分'),
            )
            .join('\n')
        : `（8km 内无评分 ≥ ${minPoiRating} 的景点）`
      : '（未启用景点评分门槛）'

  const userContent = [
    '## 用户位置',
    `纬度 ${latitude.toFixed(6)}，经度 ${longitude.toFixed(6)}`,
    heading != null ? `朝向约 ${Math.round(heading)}°` : '朝向未知',
    '',
    '## 用户设置',
    `景点评分门槛：${minPoiRating > 0 ? `${minPoiRating} 分以上（仅约束景点类 POI）` : '不限'}`,
    '',
    '## 坐标地理提示',
    geoHint,
    '',
    '## 高德逆地理',
    amapRegeo ?? '（未获取）',
    '',
    '## 地图检索（优先对象）',
    buildMapSection(mapHit),
    '',
    '## 高德景点 POI（评分参考，风景名胜）',
    scenicHint,
    '',
    '## 用户历史足迹（30km 内）',
    footprintHint || '（无）',
  ].join('\n')

  dbg.mark('主动讲解判定开始')
  const decision = await proactiveGuideDecision(userContent, dbg.logPrompt.bind(dbg))
  dbg.mark(
    '主动讲解判定完成',
    `${decision.action}${decision.reason ? ` · ${decision.reason}` : ''}`,
  )

  const payload: Record<string, unknown> = {
    proactive: true,
    skipped: decision.action !== 'speak',
    skip_reason: decision.action === 'skip' ? decision.reason : null,
    answer: decision.action === 'speak' ? decision.text : '',
    map_hit: decision.action === 'speak' ? mapHitToPayload(mapHit) : null,
    footprint: null,
    quota: {
      tier: quota.tier,
      remaining: quota.remaining,
      limit: quota.limit,
    },
  }

  if (includeDebugPayload) {
    payload.debug = {
      timeline: dbg.steps(),
      total_ms: dbg.total(),
      logged_in: Boolean(userId),
      user_id: userId,
    }
  }

  return payload
}

async function shouldAnswerMessage(
  userMessage: string,
  logPrompt: (label: string, messages: Array<{ role: string; content: string }>) => void,
) {
  if (!DEEPSEEK_API_KEY) {
    return { action: 'answer' as const, reason: 'no api key fallback' }
  }

  const messages = [
    { role: 'system', content: SHOULD_ANSWER_PROMPT },
    {
      role: 'user',
      content: [`用户输入：${userMessage.trim()}`, '', '请判断是否值得正式回答。'].join('\n'),
    },
  ]
  logPrompt('是否回答判定', messages)

  const res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: DEEPSEEK_JUDGE_MODEL,
      messages,
      temperature: 0.1,
      max_tokens: 120,
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' },
    }),
  })

  const data = await res.json().catch(() => ({}))
  const content = data?.choices?.[0]?.message?.content
  if (!res.ok || typeof content !== 'string') {
    console.warn('should-answer failed:', data)
    return { action: 'answer' as const, reason: 'judge failed fallback answer' }
  }

  try {
    const parsed = JSON.parse(content) as { action?: string; reason?: string }
    return {
      action: parsed.action === 'ignore' ? ('ignore' as const) : ('answer' as const),
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    }
  } catch {
    console.warn('should-answer bad json:', content)
    return { action: 'answer' as const, reason: 'judge parse fallback answer' }
  }
}

/** 去掉模型思考块，只保留面向用户的正文 */
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

function buildGeoContextForFootprint(
  latitude: number,
  longitude: number,
  heading: number | null,
  amapRegeo: string | null,
  mapHit: MapHit | null,
) {
  return [
    `用户 GPS：${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
    heading != null ? `朝向约 ${Math.round(heading)}°` : '朝向未知',
    '',
    '## 逆地理',
    amapRegeo ?? '（未获取）',
    '',
    '## 地图检索命中',
    mapHit
      ? `${mapHit.name}（${mapHit.category ?? '地理要素'}），${mapHit.direction}约 ${mapHit.distance_m}m，坐标 ${mapHit.lat.toFixed(5)}, ${mapHit.lng.toFixed(5)}`
      : '未命中显著命名地理要素',
    '',
    '## 坐标提示',
    coordsGeoHint(latitude, longitude),
  ].join('\n')
}

async function processLugeChat(
  req: Request,
  body: Record<string, unknown>,
  dbg: ReturnType<typeof createDbg>,
  includeDebugPayload: boolean,
) {
  const message = body?.message as string
  const latitude = Number(body?.latitude)
  const longitude = Number(body?.longitude)
  const headingRaw =
    body?.heading == null || body?.heading === ''
      ? null
      : Number(body.heading)
  const heading =
    headingRaw != null && Number.isFinite(headingRaw) ? headingRaw : null
  const proactiveContext = parseProactiveContext(body)

  dbg.mark('收到请求')

  const { userId, deviceKey } = await parseQuotaAuth(req, {
    device_id: body?.device_id as string | undefined,
  })
  dbg.mark('鉴权完成', userId ? `user=${userId.slice(0, 8)}…` : '游客')

  dbg.mark('是否回答判定开始')
  const answerDecision = await shouldAnswerMessage(message.trim(), dbg.logPrompt.bind(dbg))
  dbg.mark(
    '是否回答判定完成',
    `${answerDecision.action}${answerDecision.reason ? ` · ${answerDecision.reason}` : ''}`,
  )

  if (answerDecision.action === 'ignore') {
    dbg.mark('请求完成', '已忽略低意图输入')
    const ignoredPayload: Record<string, unknown> = {
      answer: '',
      ignored: true,
      ignore_reason: answerDecision.reason || 'low intent',
      map_hit: null,
      footprint: null,
      quota: null,
    }

    if (includeDebugPayload) {
      ignoredPayload.debug = {
        timeline: dbg.steps(),
        total_ms: dbg.total(),
        logged_in: Boolean(userId),
        user_id: userId,
        footprint_decision: { action: 'skip', reason: 'ignored before answer' },
        map_hit_name: null,
      }
    }

    return ignoredPayload
  }

  let quota: QuotaStatus
  try {
    quota = await consumeOneAsk(adminClient(), { userId, deviceKey })
  } catch (e) {
    if (e instanceof QuotaExhaustedError) throw e
    throw e
  }
  dbg.mark('额度扣减', `剩余 ${quota.remaining}/${quota.limit}`)

  const { map_hit: mapHit, amapRegeo } = await findMapContext(latitude, longitude, heading, dbg)

  const searchTopic = mapHit?.name ?? '当前位置周边'
  const geoHint = coordsGeoHint(latitude, longitude)

  const webSkipped = buildWebContext(searchTopic, message.trim())
  const webContext = webSkipped ?? await webSearchSnippets(searchTopic, message.trim())
  dbg.mark('联网摘要', webSkipped ? '已跳过' : `${webContext.length} 字`)

  const mapSection = buildMapSection(mapHit)

  const userPrompt = [
    '## 用户位置',
    `纬度 ${latitude.toFixed(6)}，经度 ${longitude.toFixed(6)}`,
    heading != null
      ? `朝向约 ${Math.round(heading)}°（可用于左右前方判断）`
      : '朝向未知（仅按附近检索，勿臆造左右前后）',
    '',
    '## 坐标地理提示（离线兜底）',
    geoHint,
    '',
    '## 高德逆地理（地址上下文）',
    amapRegeo ?? '（未获取）',
    '',
    '## 地图检索（周边地理要素）',
    mapHit
      ? mapSection
      : heading != null
        ? '未在用户前方检索到明确的命名地理要素，请结合坐标与地址上下文谨慎回答。'
        : '未在用户附近检索到明确的命名地理要素，请结合坐标与地址上下文谨慎回答。',
    '',
    '## 联网检索摘要',
    webContext,
    '',
    '## 用户问题',
    message.trim(),
  ].join('\n')

  let footprintMemory: string | null = null
  let footprintDecision: FootprintDecision = { action: 'skip', reason: 'not logged in' }
  let footprintMeta: {
    footprint_id: string | null
    visit_id: string | null
    write_error: string | null
  } = {
    footprint_id: null,
    visit_id: null,
    write_error: null,
  }

  if (userId) {
    const supabase = adminClient()
    const geoContext = buildGeoContextForFootprint(
      latitude,
      longitude,
      heading,
      amapRegeo,
      mapHit,
    )
    const candidates = await fetchNearbyFootprints(supabase, userId, latitude, longitude)
    dbg.mark('足迹候选加载', `${candidates.length} 条`)

    const classified = await classifyFootprint(
      message.trim(),
      geoContext,
      candidates,
      dbg.logPrompt.bind(dbg),
      proactiveContext,
    )
    footprintDecision = classified.decision
    const clfDebug = classified.debug
    const clfDetail = [
      classified.decision.action,
      'reason' in classified.decision && classified.decision.reason
        ? classified.decision.reason
        : 'poi_name' in classified.decision
          ? classified.decision.poi_name
          : '',
      clfDebug?.classify_ms != null ? `${clfDebug.classify_ms}ms` : '',
    ]
      .filter(Boolean)
      .join(' · ')
    dbg.mark('足迹分类', clfDetail)

    if (footprintDecision.action === 'match') {
      footprintMemory = await loadFootprintMemory(supabase, footprintDecision.footprint_id)
      dbg.mark('足迹记忆加载')
    }
  } else {
    dbg.mark('足迹跳过', '未登录')
  }

  dbg.mark('主回答 LLM 开始')
  const recentMessages = parseRecentMessages(body)
  if (recentMessages.length > 0) {
    dbg.mark('近期对话', `${recentMessages.length} 条`)
  }
  const answer = await askDeepseek(
    userPrompt,
    footprintMemory,
    recentMessages,
    dbg.logPrompt.bind(dbg),
  )
  dbg.mark('主回答 LLM 完成', `${answer.length} 字`)

  if (userId && footprintDecision.action !== 'skip') {
    const supabase = adminClient()
    footprintMeta = await applyFootprintDecision(
      supabase,
      userId,
      footprintDecision,
      {
        userMessage: message.trim(),
        assistantMessage: answer,
        userLat: latitude,
        userLng: longitude,
        heading,
      },
    )
    dbg.mark(
      '足迹写入',
      footprintMeta.write_error
        ? `失败: ${footprintMeta.write_error}`
        : `id=${footprintMeta.footprint_id?.slice(0, 8)}…`,
    )

    if (footprintMeta.visit_id) {
      try {
        dbg.mark('足迹摘要 LLM 开始')
        const summarized = await summarizeVisitAndFootprint(
          supabase,
          footprintMeta.visit_id,
          dbg.logPrompt.bind(dbg),
        )
        dbg.mark('足迹摘要 LLM 完成', summarized ? 'ok' : '失败')
      } catch (e) {
        const summarizeError = e instanceof Error ? e.message : String(e)
        dbg.mark('足迹摘要失败', summarizeError)
        console.warn('immediate footprint summarize failed:', e)
      }
    }
  }

  if (mapHit?.amap_poi_id && answer.trim() && userId) {
    const supabase = adminClient()
    const landmarkType = inferLandmarkType(mapHit.category, mapHit.tags)
    const signal = await recordGeoLandmarkSignal(supabase, {
      user_id: userId,
      signal_type: 'ask',
      amap_poi_id: mapHit.amap_poi_id,
      landmark_name: mapHit.name,
      landmark_type: landmarkType,
      lat: mapHit.lat,
      lng: mapHit.lng,
      ai_story: answer,
      metadata: {
        category: mapHit.category ?? '',
        last_source: mapHit.source,
        ...(mapHit.tags ?? {}),
      },
    })
    if (signal) {
      dbg.mark(
        '地理信号记录',
        signal.promoted
          ? `已升格 cache=${signal.cache_id?.slice(0, 8) ?? '?'}…`
          : `候选中 ${signal.promotion_score}/5 分（问${signal.ask_users}·藏${signal.favorite_users}）`,
      )
    }
  } else if (mapHit?.amap_poi_id && answer.trim() && !userId) {
    dbg.mark('地理信号记录', '跳过（未登录不计入升格）')
  }

  dbg.mark('请求完成')

  const payload: Record<string, unknown> = {
    answer,
    map_hit: mapHitToPayload(mapHit),
    footprint: footprintMeta.footprint_id
      ? {
          id: footprintMeta.footprint_id,
          visit_id: footprintMeta.visit_id,
          action: footprintDecision.action,
        }
      : null,
    quota: {
      tier: quota.tier,
      remaining: quota.remaining,
      limit: quota.limit,
    },
  }

  if (includeDebugPayload) {
    payload.debug = {
      timeline: dbg.steps(),
      total_ms: dbg.total(),
      logged_in: Boolean(userId),
      user_id: userId,
      footprint_decision: footprintDecision,
      map_hit_name: mapHit?.name ?? null,
    }
  }

  return payload
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
    const mode = body?.mode === 'proactive' ? 'proactive' : 'ask'
    const message = body?.message as string | undefined
    const latitude = Number(body?.latitude)
    const longitude = Number(body?.longitude)
    const headingRaw =
      body?.heading == null || body?.heading === ''
        ? null
        : Number(body.heading)
    const heading =
      headingRaw != null && Number.isFinite(headingRaw) ? headingRaw : null

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return json({ error: 'latitude and longitude are required' }, 400)
    }

    if (mode === 'ask' && !message?.trim()) {
      return json({ error: 'message is required' }, 400)
    }

    const wantDebug =
      body?.debug === true ||
      req.headers.get('x-luge-debug') === '1' ||
      Deno.env.get('LUGE_DEBUG') === '1'

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
            const payload =
              mode === 'proactive'
                ? await processProactiveGuide(req, body, dbg, false)
                : await processLugeChat(req, body, dbg, false)
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
    const payload =
      mode === 'proactive'
        ? await processProactiveGuide(req, body, dbg, false)
        : await processLugeChat(req, body, dbg, false)
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
