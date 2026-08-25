/** 语音收藏当前话题 POI */

import {
  adminClient,
  ensureFootprintFavorited,
  type FootprintPoiType,
} from '../luge-chat/footprint.ts'
import { lookupNearbyLandmarks } from '../volc-voice-chat/nearbyLandmarks.ts'
import { peekTopicPoi, type SessionLoc } from '../volc-voice-chat/sessionLoc.ts'

function mapLandmarkType(raw: string | undefined): FootprintPoiType {
  const t = (raw ?? '').toLowerCase()
  if (t.includes('river') || t.includes('河') || t.includes('江')) return 'river'
  if (t.includes('bridge') || t.includes('桥')) return 'bridge'
  if (t.includes('mountain') || t.includes('山') || t.includes('峰')) return 'mountain'
  if (t.includes('town') || t.includes('镇') || t.includes('村')) return 'town'
  if (t.includes('city') || t.includes('市')) return 'city'
  if (t.includes('scenery') || t.includes('风景') || t.includes('景区')) return 'scenery'
  if (t.includes('statue') || t.includes('雕像')) return 'statue'
  const allowed: FootprintPoiType[] = [
    'city',
    'town',
    'river',
    'scenery',
    'bridge',
    'statue',
    'mountain',
    'other',
  ]
  return allowed.includes(t as FootprintPoiType) ? (t as FootprintPoiType) : 'other'
}

export async function favoriteCurrentTopicPoi(opts: {
  session: SessionLoc | null
  poiHint?: string
  utterance?: string
}): Promise<Record<string, unknown>> {
  const topic = peekTopicPoi(opts.session)
  const poiName = (opts.poiHint?.trim() || topic || '').trim()
  const lugeUserId = opts.session?.luge_user_id?.trim() || null

  if (!lugeUserId) {
    return {
      ok: false,
      status: 'need_login',
      poi_name: poiName || null,
      reply_hint:
        '用户未登录。请用一两句提醒：登录后才能收藏地点；不要假装已经收藏成功。',
    }
  }

  if (!poiName) {
    return {
      ok: false,
      status: 'need_topic',
      poi_name: null,
      reply_hint:
        '当前没有可收藏的话题景点。请用一两句问用户想收藏哪个地方，不要假装已收藏。',
    }
  }

  if (!opts.session || (opts.session.lat === 0 && opts.session.lng === 0)) {
    return {
      ok: false,
      status: 'error',
      poi_name: poiName,
      reply_hint: '还没有定位，暂时无法收藏。请让用户稍后再试。',
    }
  }

  let lat = opts.session.lat
  let lng = opts.session.lng
  let poiType: FootprintPoiType = 'other'
  try {
    const { landmarks } = await lookupNearbyLandmarks({
      lat: opts.session.lat,
      lng: opts.session.lng,
      heading: opts.session.heading,
      focus: poiName,
      geoRadiusPrefs: opts.session.geo_radius_prefs ?? null,
    })
    const hit =
      landmarks.find((l) => l.name.includes(poiName) || poiName.includes(l.name)) ??
      landmarks[0]
    if (hit) {
      lat = hit.lat
      lng = hit.lng
      poiType = mapLandmarkType(hit.type)
    }
  } catch {
    /* 坐标退化到用户 GPS */
  }

  const result = await ensureFootprintFavorited(adminClient(), lugeUserId, {
    poiName,
    poiType,
    latitude: lat,
    longitude: lng,
    userLat: opts.session.lat,
    userLng: opts.session.lng,
    heading: opts.session.heading,
    userMessage: opts.utterance,
  })

  return {
    ok: result.ok,
    status: result.status,
    poi_name: result.poi_name,
    footprint_id: result.footprint_id,
    already_favorited: result.already_favorited,
    created: result.created,
    ...(result.error ? { error: result.error } : {}),
    reply_hint: result.reply_hint,
  }
}
