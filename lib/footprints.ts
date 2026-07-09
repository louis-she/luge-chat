import { createClient } from '@supabase/supabase-js'
import { SUPABASE_ANON_KEY, SUPABASE_DB_SCHEMA, SUPABASE_URL } from './config'

export type FootprintPoiType =
  | 'city'
  | 'town'
  | 'river'
  | 'scenery'
  | 'bridge'
  | 'statue'
  | 'mountain'
  | 'other'

export type FootprintVisit = {
  id: string
  started_at: string
  last_active_at: string
  archived_at: string | null
  visit_summary: string
  status: 'active' | 'archived'
  message_count: number
  start_lat: number | null
  start_lng: number | null
}

export type FootprintMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  created_at: string
}

export type UserFootprint = {
  id: string
  poi_name: string
  poi_type: FootprintPoiType
  title: string
  summary: string
  updated_at: string
  lat: number | null
  lng: number | null
  favorited_at: string | null
  visits: FootprintVisit[]
}

const POI_TYPE_LABELS: Record<FootprintPoiType, string> = {
  city: '城市',
  town: '城镇',
  river: '河流',
  scenery: '风景',
  bridge: '桥梁',
  statue: '雕塑',
  mountain: '山脉',
  other: '地标',
}

function parseEwkbHex(hex: string): { lat: number; lng: number } | null {
  const clean = hex.trim()
  if (!/^[0-9a-fA-F]+$/.test(clean) || clean.length < 42) return null
  try {
    const bytes = new Uint8Array(clean.length / 2)
    for (let i = 0; i < clean.length; i += 2) {
      bytes[i / 2] = parseInt(clean.slice(i, i + 2), 16)
    }
    const view = new DataView(bytes.buffer)
    const little = view.getUint8(0) === 1
    let offset = 1
    const type = view.getUint32(offset, little)
    offset += 4
    if ((type & 0x20000000) !== 0) offset += 4
    const lng = view.getFloat64(offset, little)
    offset += 8
    const lat = view.getFloat64(offset, little)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    return { lat, lng }
  } catch {
    return null
  }
}

function parsePointGeom(geom: unknown): { lat: number; lng: number } | null {
  if (!geom) return null
  if (typeof geom === 'object' && geom !== null) {
    const g = geom as { type?: string; coordinates?: number[] }
    if (g.type === 'Point' && Array.isArray(g.coordinates) && g.coordinates.length >= 2) {
      const [lng, lat] = g.coordinates
      if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng }
    }
  }
  if (typeof geom === 'string') {
    const trimmed = geom.trim()
    if (/^[0-9a-fA-F]+$/.test(trimmed)) {
      const fromEwkb = parseEwkbHex(trimmed)
      if (fromEwkb) return fromEwkb
    }
    const wkt = trimmed.replace(/^SRID=\d+;/i, '')
    const m = wkt.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i)
    if (m) {
      const lng = Number(m[1])
      const lat = Number(m[2])
      if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng }
    }
  }
  return null
}

function resolveFootprintCoords(
  geom: unknown,
  visits: FootprintVisit[],
): { lat: number; lng: number } | null {
  const fromGeom = parsePointGeom(geom)
  if (fromGeom) return fromGeom
  const latestVisit = [...visits]
    .filter((v) => v.start_lat != null && v.start_lng != null)
    .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())[0]
  if (latestVisit?.start_lat != null && latestVisit?.start_lng != null) {
    return { lat: latestVisit.start_lat, lng: latestVisit.start_lng }
  }
  return null
}

function mapVisitRow(v: {
  id: string
  footprint_id: string
  started_at: string
  last_active_at: string
  archived_at: string | null
  visit_summary: string
  status: 'active' | 'archived'
  start_location?: unknown
}): FootprintVisit {
  const start = parsePointGeom(v.start_location)
  return {
    id: v.id,
    started_at: v.started_at,
    last_active_at: v.last_active_at,
    archived_at: v.archived_at,
    visit_summary: v.visit_summary,
    status: v.status,
    message_count: 0,
    start_lat: start?.lat ?? null,
    start_lng: start?.lng ?? null,
  }
}

function clientWithAuth(accessToken: string) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    db: { schema: SUPABASE_DB_SCHEMA },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })
}

export async function fetchUserFootprints(accessToken: string): Promise<UserFootprint[]> {
  const supabase = clientWithAuth(accessToken)

  const { data: footprints, error } = await supabase
    .from('user_footprints')
    .select('id, poi_name, poi_type, title, summary, updated_at, favorited_at, geom')
    .order('updated_at', { ascending: false })
    .limit(50)

  if (error) throw new Error(error.message)
  if (!footprints?.length) return []

  const ids = footprints.map((f) => f.id)
  const visits = await fetchVisitsForFootprints(supabase, ids)
  return footprints.map((f) => {
    const footprintVisits = visits.get(f.id) ?? []
    const point = resolveFootprintCoords(f.geom, footprintVisits)
    return {
      id: f.id,
      poi_name: f.poi_name,
      poi_type: f.poi_type,
      title: f.title,
      summary: f.summary,
      updated_at: f.updated_at,
      favorited_at: f.favorited_at ?? null,
      lat: point?.lat ?? null,
      lng: point?.lng ?? null,
      visits: footprintVisits,
    }
  })
}

export async function fetchFootprintById(
  accessToken: string,
  footprintId: string,
): Promise<UserFootprint | null> {
  const supabase = clientWithAuth(accessToken)

  const { data: footprint, error } = await supabase
    .from('user_footprints')
    .select('id, poi_name, poi_type, title, summary, updated_at, favorited_at, geom')
    .eq('id', footprintId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!footprint) return null

  const visits = await fetchVisitsForFootprints(supabase, [footprint.id])
  const footprintVisits = visits.get(footprint.id) ?? []
  const point = resolveFootprintCoords(footprint.geom, footprintVisits)
  return {
    id: footprint.id,
    poi_name: footprint.poi_name,
    poi_type: footprint.poi_type,
    title: footprint.title,
    summary: footprint.summary,
    updated_at: footprint.updated_at,
    favorited_at: footprint.favorited_at ?? null,
    lat: point?.lat ?? null,
    lng: point?.lng ?? null,
    visits: footprintVisits,
  }
}

async function fetchVisitsForFootprints(
  supabase: ReturnType<typeof clientWithAuth>,
  footprintIds: string[],
) {
  if (!footprintIds.length) return new Map<string, FootprintVisit[]>()

  const { data: visits, error: visitErr } = await supabase
    .from('footprint_visits')
    .select(
      'id, footprint_id, started_at, last_active_at, archived_at, visit_summary, status, start_location',
    )
    .in('footprint_id', footprintIds)
    .order('started_at', { ascending: false })

  if (visitErr) throw new Error(visitErr.message)

  const visitIds = (visits ?? []).map((v) => v.id)
  const messageCountByVisit = new Map<string, number>()
  if (visitIds.length) {
    const { data: messages, error: msgErr } = await supabase
      .from('footprint_messages')
      .select('footprint_visit_id')
      .in('footprint_visit_id', visitIds)
    if (msgErr) throw new Error(msgErr.message)
    for (const m of messages ?? []) {
      messageCountByVisit.set(
        m.footprint_visit_id,
        (messageCountByVisit.get(m.footprint_visit_id) ?? 0) + 1,
      )
    }
  }

  const byFootprint = new Map<string, FootprintVisit[]>()
  for (const v of visits ?? []) {
    const list = byFootprint.get(v.footprint_id) ?? []
    const visit = mapVisitRow(v)
    visit.message_count = messageCountByVisit.get(v.id) ?? 0
    list.push(visit)
    byFootprint.set(v.footprint_id, list)
  }
  return byFootprint
}

export function formatFootprintRoute(updatedAt: string) {
  const d = new Date(updatedAt)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  const dateLabel = sameDay
    ? '今日'
    : d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
  return `路途中 · ${dateLabel}`
}

export function footprintLastActiveAt(fp: UserFootprint) {
  const latest = fp.visits.reduce<string | null>((max, v) => {
    const t = v.last_active_at || v.started_at
    return !max || t > max ? t : max
  }, null)
  return latest ?? fp.updated_at
}

export function footprintDialogRounds(fp: UserFootprint) {
  const userMsgs = fp.visits.reduce(
    (n, v) => n + Math.floor(v.message_count / 2),
    0,
  )
  return userMsgs
}

export function footprintDisplayBody(fp: UserFootprint) {
  const withSummary = fp.visits.filter((v) => v.visit_summary.trim())
  if (withSummary.length <= 1) {
    const latestVisitSummary = withSummary[0]?.visit_summary.trim()
    return (
      latestVisitSummary ||
      fp.summary.trim() ||
      fp.title.trim() ||
      fp.poi_name ||
      '路鸽还在整理这段回忆…'
    )
  }
  return fp.summary.trim() || '多次路过，点开查看时间线'
}

export function footprintPoiTypeLabel(type: FootprintPoiType) {
  return POI_TYPE_LABELS[type] ?? POI_TYPE_LABELS.other
}

export function formatCoordinates(lat: number | null, lng: number | null) {
  if (lat == null || lng == null) return '坐标待补充'
  return `${lat.toFixed(6)}°N, ${lng.toFixed(6)}°E`
}

export function formatVisitDateTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function isFootprintFavorited(fp: UserFootprint) {
  return fp.favorited_at != null
}

export async function setFootprintFavorite(
  accessToken: string,
  footprintId: string,
  favorited: boolean,
): Promise<string | null> {
  const supabase = clientWithAuth(accessToken)
  const { data, error } = await supabase.rpc('set_footprint_favorite', {
    p_footprint_id: footprintId,
    p_favorited: favorited,
  })
  if (error) throw new Error(error.message)
  return typeof data === 'string' ? data : null
}

export async function setFootprintTitle(
  accessToken: string,
  footprintId: string,
  title: string,
): Promise<string> {
  const trimmed = title.trim()
  if (!trimmed) throw new Error('标题不能为空')

  const supabase = clientWithAuth(accessToken)
  const { data, error } = await supabase.rpc('set_footprint_title', {
    p_footprint_id: footprintId,
    p_title: trimmed,
  })
  if (error) throw new Error(error.message)
  if (typeof data !== 'string' || !data.trim()) throw new Error('保存失败')
  return data.trim()
}

export async function fetchVisitMessages(
  accessToken: string,
  visitId: string,
): Promise<FootprintMessage[]> {
  const supabase = clientWithAuth(accessToken)
  const { data, error } = await supabase
    .from('footprint_messages')
    .select('id, role, content, created_at')
    .eq('footprint_visit_id', visitId)
    .order('created_at', { ascending: true })

  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    created_at: row.created_at,
  }))
}

export function sortedVisits(fp: UserFootprint) {
  return [...fp.visits].sort(
    (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
  )
}
