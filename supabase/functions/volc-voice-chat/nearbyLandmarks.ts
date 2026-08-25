import {
  localFuzzy,
  localNearby,
  resolveGeoContext,
  type LocalPoi,
} from '../_shared/geoLocal.ts'
import {
  bearingLabel,
  bearingTo,
  directionPriority,
  formatDistanceSpoken,
  DISTANCE_MUST_SAY_M,
} from '../_shared/geoBearing.ts'
import {
  classifyGeoIntent,
  isGenericGeoFocus,
  resolveGeoSearchRadius,
  type GeoRadiusPrefs,
} from '../_shared/geoSearchRadius.ts'
import {
  isLikelySameGeoName,
  normalizeGeoName,
} from '../_shared/geoNameFuzzy.ts'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { adminClient } from './sessionLoc.ts'

export type NearbyLandmark = {
  name: string
  type: string
  distance_m: number
  direction: string
  lat: number
  lng: number
  story?: string
  source: 'local'
}

function toLandmark(
  poi: LocalPoi,
  lat: number,
  lng: number,
  heading: number | null,
): NearbyLandmark {
  return {
    name: poi.name,
    type: poi.typeLabel,
    distance_m: poi.distanceM,
    direction: bearingLabel(bearingTo(lat, lng, poi.lat, poi.lng), heading),
    lat: poi.lat,
    lng: poi.lng,
    story: poi.story,
    source: 'local',
  }
}

/** 名字对得上：完全相同，或一方包含另一方（「贡嘎」↔「贡嘎山」） */
function nameHits(focus: string, name: string): boolean {
  const a = normalizeGeoName(focus)
  const b = normalizeGeoName(name)
  if (!a || !b) return false
  return a === b || a.includes(b) || b.includes(a)
}

/**
 * 用户点名问某个地物时的检索。
 * 不能只在「最近 8 条」里按名字过滤 —— 用户问的澜沧江可能排在几十条之后。
 * 走库侧的相似度检索，在整个半径内按名字找。
 */
async function lookupByName(opts: {
  db: SupabaseClient
  lat: number
  lng: number
  radiusM: number
  heading: number | null
  focus: string
}): Promise<{
  landmarks: NearbyLandmark[]
  fuzzyFocus: { asked: string; matched: string } | null
}> {
  const { db, lat, lng, radiusM, heading, focus } = opts
  const candidates = await localFuzzy(db, {
    lat,
    lng,
    radiusM,
    name: focus,
    limit: 20,
  })
  if (!candidates.length) return { landmarks: [], fuzzyFocus: null }

  const exact = candidates.filter((p) => nameHits(focus, p.name))
  if (exact.length) {
    return {
      landmarks: exact.slice(0, 5).map((p) => toLandmark(p, lat, lng, heading)),
      fuzzyFocus: null,
    }
  }

  // 名字对不上 → 大概率 ASR 听错了一两个字，用近音规则从候选里挑真身
  const homophone = candidates.filter((p) => isLikelySameGeoName(focus, p.name))
  if (homophone.length) {
    return {
      landmarks: homophone
        .slice(0, 5)
        .map((p) => toLandmark(p, lat, lng, heading)),
      fuzzyFocus: { asked: focus, matched: homophone[0].name },
    }
  }
  return { landmarks: [], fuzzyFocus: null }
}

/** 查周边：场景×语意定半径；专名走名字检索，泛问取最近若干条 */
export async function lookupNearbyLandmarks(opts: {
  lat: number
  lng: number
  heading?: number | null
  /** 模型传的半径仅作参考；实际以 resolveGeoSearchRadius 为准 */
  radiusM?: number
  focus?: string
  /** 高级设置同步上来的权重；缺省用默认 */
  geoRadiusPrefs?: Partial<GeoRadiusPrefs> | null
}): Promise<{
  landmarks: NearbyLandmark[]
  note: string
  radiusM: number
  /** 用户说的名字没精确匹配、靠近音捞回来时的对照 */
  fuzzyFocus?: { asked: string; matched: string } | null
}> {
  if (
    !Number.isFinite(opts.lat) ||
    !Number.isFinite(opts.lng) ||
    (opts.lat === 0 && opts.lng === 0)
  ) {
    return {
      landmarks: [],
      note: '暂无有效 GPS，无法查周边。请客户端先上报位置。',
      radiusM: 0,
    }
  }

  const heading =
    opts.heading != null && Number.isFinite(opts.heading) ? opts.heading : null
  const db = adminClient()

  const ctx = await resolveGeoContext(db, opts.lat, opts.lng)
  const intent = classifyGeoIntent(opts.focus)
  const decision = resolveGeoSearchRadius({
    scene: ctx.scene,
    intent,
    prefs: opts.geoRadiusPrefs,
  })
  const radiusM = decision.radiusM

  const askedName = opts.focus?.trim() ?? ''
  const specific = Boolean(askedName) && !isGenericGeoFocus(askedName)

  let landmarks: NearbyLandmark[] = []
  let fuzzyFocus: { asked: string; matched: string } | null = null
  let note = ''

  if (specific) {
    const byName = await lookupByName({
      db,
      lat: opts.lat,
      lng: opts.lng,
      radiusM,
      heading,
      focus: askedName,
    })
    landmarks = byName.landmarks
    fuzzyFocus = byName.fuzzyFocus
    if (fuzzyFocus) {
      note = `「${askedName}」无精确匹配，近音命中「${fuzzyFocus.matched}」；${decision.formula}`
    } else if (landmarks.length) {
      note = `专名命中 ${landmarks.length} 条；${decision.formula}`
    }
  }

  if (landmarks.length === 0) {
    const nearby = await localNearby(db, {
      lat: opts.lat,
      lng: opts.lng,
      radiusM,
      limit: 8,
    })
    landmarks = nearby.map((p) => toLandmark(p, opts.lat, opts.lng, heading))
    note = landmarks.length
      ? `${specific ? `「${askedName}」未命中，改取周边 ` : '周边命中 '}${landmarks.length} 条；${decision.formula}`
      : `本地库 ${Math.round(radiusM / 1000)}km 内无结果；${decision.formula}`
  }

  landmarks = [...landmarks].sort((a, b) => {
    const d = directionPriority(a.direction) - directionPriority(b.direction)
    if (d !== 0) return d
    return a.distance_m - b.distance_m
  })

  return { landmarks, note, radiusM, fuzzyFocus }
}

/** 把周边结果压成给火山 LLM 的工具回传 JSON（FC Content） */
export function formatLandmarksForLlm(
  landmarks: NearbyLandmark[],
  meta: {
    lat: number
    lng: number
    heading: number | null
    note: string
    fuzzyFocus?: { asked: string; matched: string } | null
  },
): string {
  const headingKnown = meta.heading != null && Number.isFinite(meta.heading)
  if (landmarks.length === 0) {
    return JSON.stringify({
      ok: false,
      user_location: {
        lat: meta.lat,
        lng: meta.lng,
        heading: meta.heading,
        heading_known: headingKnown,
      },
      note: meta.note,
      landmarks: [],
      reply_hint:
        '附近没有与用户所问相符的地标。' +
        '但语音识别可能把地名听错一两个字：若用户说的名字与【话题锚定】或你刚讲过的地标发音相近，请按那个地标回答，不要说没查到。' +
        '确实无关时，用一两句短话告知即可，不要解释原因或推荐其它景点。',
    })
  }
  const fuzzyHint = meta.fuzzyFocus
    ? `用户说的「${meta.fuzzyFocus.asked}」在地图上没有精确匹配，最接近的是「${meta.fuzzyFocus.matched}」（发音相近，几乎肯定是语音识别听错）。` +
      `请直接按 landmarks 里的对象回答，全程使用地图上的正确名称；不要说没查到，也不要提识别有误或检索过程。`
    : ''
  return JSON.stringify({
    ok: true,
    user_location: {
      lat: meta.lat,
      lng: meta.lng,
      heading: meta.heading,
      heading_known: headingKnown,
    },
    note: meta.note,
    ...(meta.fuzzyFocus ? { fuzzy_match: meta.fuzzyFocus } : {}),
    landmarks: landmarks.map((l) => ({
      name: l.name,
      type: l.type,
      distance_m: l.distance_m,
      distance_spoken: formatDistanceSpoken(l.distance_m),
      direction: l.direction,
      ...(l.story ? { story: l.story } : {}),
      source: l.source,
    })),
    reply_hint:
      fuzzyHint +
      `方位与距离（H1/H2）：介绍地标时优先用条目里的 direction（相对车头：左前/右前/正前/左侧/右侧/左后/右后/正后方），不要改用「西南方」等绝对方位，除非同时补相对方位。` +
      `距离超过约 ${DISTANCE_MUST_SAY_M} 米时必须带上 distance_spoken（如「右前方约 800 米」）；正后方/左后/右后更要说清，避免用户白扭头。` +
      `heading_known=false 或 direction=附近时，只说「附近」+距离，不要臆造左右。` +
      `只介绍命中对象；勿行动号召；勿默认用户在开车；勿臆造无关旧足迹。`,
  })
}
