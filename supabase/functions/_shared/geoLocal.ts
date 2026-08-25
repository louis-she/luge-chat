/**
 * 本地地理库查询层 —— 取代高德。
 *
 * 数据来自 OSM 一次性导入 + 用户问答沉淀，全部落在 PostGIS：
 *   geo_landmarks_cache  地物（点/线/面，河流存 LineString、湖泊保护区存 Polygon）
 *   geo_admin_areas      行政区边界（省/地级市/县/乡镇）
 *
 * 三个能力对应原来高德的三件事：
 *   localNearby       ← place/around
 *   localFuzzy        ← place/around 宽搜 + 近音救援
 *   resolveGeoContext ← geocode/regeo（本地行政区 + 天地图补省份/街道/道路）
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { tiandituRegeo } from './geoTianditu.ts'

export type LocalPoiType =
  | 'town'
  | 'river'
  | 'scenery'
  | 'bridge'
  | 'mountain'
  | 'other'

export const LOCAL_TYPE_LABEL: Record<LocalPoiType, string> = {
  town: '城镇',
  river: '河流',
  scenery: '风景名胜',
  bridge: '桥梁',
  mountain: '山脉',
  other: '地标',
}

const LOCAL_TYPES: LocalPoiType[] = [
  'town',
  'river',
  'scenery',
  'bridge',
  'mountain',
  'other',
]

export type LocalPoi = {
  id: string
  name: string
  landmarkType: LocalPoiType
  /** 中文类型名，直接给模型看 */
  typeLabel: string
  lat: number
  lng: number
  distanceM: number
  /** 沉淀过的讲解稿，OSM 底库为空 */
  story?: string
  /** OSM place 标签：city / town / village，用于场景与筛选 */
  place?: string
  /** 海拔（米），OSM ele */
  ele?: number
  /** 有维基条目的通常更值得讲 */
  hasWiki: boolean
}

function toType(value: unknown): LocalPoiType {
  const s = String(value ?? 'other') as LocalPoiType
  return LOCAL_TYPES.includes(s) ? s : 'other'
}

function rowToPoi(row: Record<string, unknown>): LocalPoi | null {
  const name = String(row.landmark_name ?? '').trim()
  const lat = Number(row.lat)
  const lng = Number(row.lng)
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null

  const meta = (row.metadata as Record<string, unknown>) ?? {}
  const landmarkType = toType(row.landmark_type)
  const eleRaw = Number(meta.ele)
  const story = String(row.ai_formatted_story ?? '').slice(0, 400)

  return {
    id: String(row.id ?? ''),
    name,
    landmarkType,
    typeLabel: LOCAL_TYPE_LABEL[landmarkType],
    lat,
    lng,
    distanceM: Math.round(Number(row.distance_m) || 0),
    story: story || undefined,
    place: meta.place != null ? String(meta.place) : undefined,
    ele: Number.isFinite(eleRaw) ? eleRaw : undefined,
    hasWiki: Boolean(meta.wikidata || meta.wikipedia),
  }
}

export async function localNearby(
  db: SupabaseClient,
  opts: {
    lat: number
    lng: number
    radiusM: number
    limit?: number
    /** 主动讲解不播报村庄；用户问路时仍需要 */
    skipVillage?: boolean
  },
): Promise<LocalPoi[]> {
  const { data, error } = await db.rpc('nearby_geo_landmarks', {
    p_lat: opts.lat,
    p_lng: opts.lng,
    p_radius_m: Math.round(opts.radiusM),
    p_limit: opts.limit ?? 8,
    p_skip_village: opts.skipVillage ?? false,
  })
  if (error) {
    console.warn('[geoLocal] nearby_geo_landmarks failed:', error.message)
    return []
  }
  return ((data ?? []) as Array<Record<string, unknown>>)
    .map(rowToPoi)
    .filter((p): p is LocalPoi => p != null)
}

/**
 * ASR 把地名听错时的宽召回。
 * 库侧只按 trigram 相似度排序、不设阈值（「澜沧江」听成「兰沧江」相似度仅 0.14），
 * 真身由调用方用近音规则从这批候选里挑。
 */
export async function localFuzzy(
  db: SupabaseClient,
  opts: {
    lat: number
    lng: number
    radiusM: number
    name: string
    limit?: number
  },
): Promise<LocalPoi[]> {
  const { data, error } = await db.rpc('fuzzy_geo_landmarks', {
    p_lat: opts.lat,
    p_lng: opts.lng,
    p_radius_m: Math.round(opts.radiusM),
    p_name: opts.name,
    p_limit: opts.limit ?? 20,
  })
  if (error) {
    console.warn('[geoLocal] fuzzy_geo_landmarks failed:', error.message)
    return []
  }
  return ((data ?? []) as Array<Record<string, unknown>>)
    .map(rowToPoi)
    .filter((p): p is LocalPoi => p != null)
}

export type LocalGeoScene = 'urban' | 'town' | 'wild'

type LocalContextRow = {
  province: string | null
  city: string | null
  county: string | null
  township: string | null
  scene: LocalGeoScene
  nearestPlaceName: string | null
  nearestPlaceKind: string | null
  nearestPlaceM: number | null
}

export type GeoContext = LocalContextRow & {
  /** 所在/最近道路，只有天地图给得出 */
  road: string | null
  roadDistanceM: number | null
  /** 行政区与道路的来源；POI 撞库始终是本地库 */
  source: 'tianditu+local' | 'local'
  /** 拼好的位置上下文，直接进 prompt */
  text: string | null
}

const EMPTY_LOCAL: LocalContextRow = {
  province: null,
  city: null,
  county: null,
  township: null,
  scene: 'wild',
  nearestPlaceName: null,
  nearestPlaceKind: null,
  nearestPlaceM: null,
}

const SCENE_LABEL: Record<LocalGeoScene, string> = {
  urban: '城区',
  town: '乡镇',
  wild: '野外/郊野',
}

function formatMeters(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} 公里` : `${Math.round(m)} 米`
}

function buildContextText(ctx: Omit<GeoContext, 'text'>): string | null {
  const lines: string[] = []
  const path = [ctx.province, ctx.city, ctx.county, ctx.township]
    .filter(Boolean)
    .join('')
  if (path) lines.push(`行政区：${path}`)
  if (ctx.road) {
    lines.push(
      ctx.roadDistanceM != null && ctx.roadDistanceM > 300
        ? `最近道路：${ctx.road}（约 ${formatMeters(ctx.roadDistanceM)}）`
        : `所在道路：${ctx.road}`,
    )
  }
  if (ctx.nearestPlaceName && ctx.nearestPlaceM != null) {
    lines.push(
      `最近聚落：${ctx.nearestPlaceName}（约 ${formatMeters(ctx.nearestPlaceM)}）`,
    )
  }
  lines.push(`环境：${SCENE_LABEL[ctx.scene]}`)
  return lines.length ? lines.join('\n') : null
}

/**
 * 天地图的 poi_distance 是「离最近兴趣点多远」，实测是比行政区可靠得多的
 * 人烟密度信号：成都天府广场 1m、康定城区 124m、昌都 242m、然乌湖 702m、
 * 折多山垭口 1147m、可可西里 1941m —— 单调得像专门为场景判定设计的。
 * road_distance 再兜一道：离最近道路 3 公里以上，不管周围有什么都是野外。
 */
function sceneFromTianditu(
  poiDistanceM: number | null,
  roadDistanceM: number | null,
): LocalGeoScene | null {
  if (roadDistanceM != null && roadDistanceM > 3000) return 'wild'
  if (poiDistanceM == null) return null
  if (poiDistanceM <= 300) return 'urban'
  if (poiDistanceM <= 1000) return 'town'
  return 'wild'
}

async function localContextRow(
  db: SupabaseClient,
  lat: number,
  lng: number,
): Promise<LocalContextRow> {
  const { data, error } = await db.rpc('resolve_geo_context', {
    p_lat: lat,
    p_lng: lng,
  })
  if (error) {
    console.warn('[geoLocal] resolve_geo_context failed:', error.message)
    return EMPTY_LOCAL
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | Record<string, unknown>
    | undefined
  if (!row) return EMPTY_LOCAL

  const scene = (['urban', 'town', 'wild'] as const).includes(
    row.scene as LocalGeoScene,
  )
    ? (row.scene as LocalGeoScene)
    : 'wild'

  return {
    province: (row.province as string) || null,
    city: (row.city as string) || null,
    county: (row.county as string) || null,
    township: (row.township as string) || null,
    scene,
    nearestPlaceName: (row.nearest_place_name as string) || null,
    nearestPlaceKind: (row.nearest_place_kind as string) || null,
    nearestPlaceM:
      row.nearest_place_m != null ? Number(row.nearest_place_m) : null,
  }
}

/**
 * 坐标 → 行政区 + 道路 + 城/镇/野场景。
 *
 * 两个来源并行跑，各取所长：天地图补我们 OSM 缺的（西藏等省份、只覆盖 65.7%
 * 的乡镇街道、完全没有的道路），本地库出「最近聚落」并在天地图挂掉时兜底。
 * 天地图超时 1.2s 自动放弃，不阻塞语音链路。
 */
export async function resolveGeoContext(
  db: SupabaseClient,
  lat: number,
  lng: number,
): Promise<GeoContext> {
  const [localRes, tdtRes] = await Promise.allSettled([
    localContextRow(db, lat, lng),
    tiandituRegeo(lat, lng),
  ])

  const local = localRes.status === 'fulfilled' ? localRes.value : EMPTY_LOCAL
  const tdt = tdtRes.status === 'fulfilled' ? tdtRes.value : null

  if (!tdt) {
    const fallback: Omit<GeoContext, 'text'> = {
      ...local,
      road: null,
      roadDistanceM: null,
      source: 'local',
    }
    return { ...fallback, text: buildContextText(fallback) }
  }

  const merged: Omit<GeoContext, 'text'> = {
    province: tdt.province ?? local.province,
    city: tdt.city ?? local.city,
    county: tdt.county ?? local.county,
    township: tdt.town ?? local.township,
    scene:
      sceneFromTianditu(tdt.poiDistanceM, tdt.roadDistanceM) ?? local.scene,
    nearestPlaceName: local.nearestPlaceName,
    nearestPlaceKind: local.nearestPlaceKind,
    nearestPlaceM: local.nearestPlaceM,
    road: tdt.road,
    roadDistanceM: tdt.roadDistanceM,
    source: 'tianditu+local',
  }
  return { ...merged, text: buildContextText(merged) }
}
