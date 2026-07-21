import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config'
import { getDeviceId } from './deviceId'
import type { UserCoords } from './location'
import { getProactivePoiContext } from './proactiveContext'
import { isQuotaExhaustedError, type QuotaExhaustedPayload } from './quota'

import type { ChatTurnMessage } from './chatWindow'

export type LugeChatRequest = {
  message?: string
  mode?: 'ask' | 'proactive'
  latitude: number
  longitude: number
  heading?: number | null
  device_id: string
  debug?: boolean
  min_poi_rating?: number
  /** 当天已主动讲过的 POI 键（客户端上海日历日） */
  spoken_poi_keys?: string[]
  recent_messages?: ChatTurnMessage[]
  proactive_context?: {
    poi_name: string
    amap_poi_id?: string | null
    lat: number
    lng: number
    category?: string
  } | null
}

export type LugeChatDebugStep = {
  step: string
  ms: number
  total?: number
  detail?: string
}

export type LugeChatDebug = {
  timeline?: LugeChatDebugStep[]
  total_ms?: number
  logged_in?: boolean
  user_id?: string | null
  footprint_decision?: unknown
  map_hit_name?: string | null
}

export type LugeChatResponse = {
  answer: string
  ignored?: boolean
  ignore_reason?: string | null
  proactive?: boolean
  skipped?: boolean
  skip_reason?: string | null
  map_hit: {
    name: string
    category?: string
    distance_m?: number
    direction?: string
    source?: 'amap' | 'osm' | 'cache'
    lat?: number
    lng?: number
    amap_poi_id?: string | null
    osm_tags?: Record<string, string>
  } | null
  footprint?: {
    id: string
    visit_id: string | null
    action: 'match' | 'create' | 'skip'
  } | null
  quota?: {
    tier: string
    remaining: number
    limit: number
  }
  location_source?: string
  debug?: LugeChatDebug
}

export class LugeChatQuotaError extends Error {
  payload: QuotaExhaustedPayload

  constructor(payload: QuotaExhaustedPayload) {
    super('quota exhausted')
    this.payload = payload
  }
}

function logDebugPrompt(label: string, role: string, content: string) {
  const sep = '─'.repeat(48)
  console.log(`[luge prompt] ${label} :: ${role}\n${sep}\n${content}\n${sep}`)
}

function logDebugStep(step: LugeChatDebugStep) {
  const total = step.total != null ? ` Σ${step.total}ms` : ''
  const suffix = step.detail ? ` — ${step.detail}` : ''
  console.log(`[luge +${step.ms}ms${total}] ${step.step}${suffix}`)
}

export function printLugeChatDebugTimeline(debug: LugeChatDebug) {
  if (debug.timeline?.length) {
    let cumulative = 0
    for (const step of debug.timeline) {
      cumulative += step.ms
      logDebugStep({ ...step, total: cumulative })
    }
  }
  if (debug.total_ms != null) {
    console.log(`[luge] 服务端总耗时 ${debug.total_ms}ms`)
  }
  if (debug.footprint_decision) {
    console.log('[luge] 足迹判定', debug.footprint_decision)
  }
}

async function functionHeaders(accessToken?: string | null) {
  const deviceId = await getDeviceId()
  const token = accessToken?.trim() || SUPABASE_ANON_KEY
  return {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Luge-Device-Id': deviceId,
      Accept: __DEV__ ? 'application/x-ndjson, application/json' : 'application/json',
      ...(__DEV__ ? { 'X-Luge-Debug': '1' } : {}),
    },
    deviceId,
  }
}

async function readNdjsonLugeChat(
  res: Response,
  t0: number,
): Promise<LugeChatResponse> {
  const reader = res.body?.getReader()
  if (!reader) {
    throw new Error('无法读取调试流')
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let result: LugeChatResponse | null = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      const evt = JSON.parse(line) as Record<string, unknown>
      if (evt.event === 'step') {
        logDebugStep({
          step: String(evt.step),
          ms: Number(evt.ms),
          total: Number(evt.total),
          detail: typeof evt.detail === 'string' ? evt.detail : undefined,
        })
      } else if (evt.event === 'prompt') {
        logDebugPrompt(
          String(evt.label ?? 'LLM'),
          String(evt.role ?? 'unknown'),
          String(evt.content ?? ''),
        )
      } else if (evt.event === 'done') {
        result = evt as unknown as LugeChatResponse
      } else if (evt.event === 'error') {
        if (evt.status === 402 && isQuotaExhaustedError(evt)) {
          throw new LugeChatQuotaError(evt as QuotaExhaustedPayload)
        }
        const msg =
          (typeof evt.error === 'string' && evt.error) ||
          (typeof evt.message === 'string' && evt.message) ||
          '路鸽没能回答这个问题'
        throw new Error(msg)
      }
    }
  }

  if (!result) {
    throw new Error('调试流未返回结果')
  }

  console.log(`[luge] 请求往返 ${Date.now() - t0}ms`)
  return result
}

export async function askLugeGuide(
  message: string,
  coords: UserCoords,
  accessToken?: string | null,
  recentMessages?: ChatTurnMessage[],
): Promise<LugeChatResponse> {
  const { headers, deviceId } = await functionHeaders(accessToken)
  const proactiveContext = getProactivePoiContext()
  const body: LugeChatRequest = {
    message,
    latitude: coords.latitude,
    longitude: coords.longitude,
    heading: coords.heading,
    device_id: deviceId,
    debug: __DEV__,
    recent_messages:
      recentMessages && recentMessages.length > 0 ? recentMessages : undefined,
    proactive_context: proactiveContext
      ? {
          poi_name: proactiveContext.poi_name,
          amap_poi_id: proactiveContext.amap_poi_id ?? null,
          lat: proactiveContext.lat,
          lng: proactiveContext.lng,
          category: proactiveContext.category,
        }
      : null,
  }

  const t0 = Date.now()
  const res = await fetch(`${SUPABASE_URL}/functions/v1/luge-chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  const contentType = res.headers.get('content-type') ?? ''
  if (__DEV__ && contentType.includes('application/x-ndjson')) {
    return readNdjsonLugeChat(res, t0)
  }

  const data = await res.json().catch(() => ({}))
  if (__DEV__) {
    console.log(`[luge] 请求往返 ${Date.now() - t0}ms`)
  }
  if (res.status === 402 && isQuotaExhaustedError(data)) {
    throw new LugeChatQuotaError(data)
  }
  if (!res.ok) {
    const msg =
      (typeof data.error === 'string' && data.error) ||
      (typeof data.msg === 'string' && data.msg) ||
      '路鸽没能回答这个问题'
    throw new Error(msg)
  }

  const result = data as LugeChatResponse
  if (__DEV__ && result.debug) {
    printLugeChatDebugTimeline(result.debug)
  }
  return result
}

export async function proactiveLugeGuide(
  coords: UserCoords,
  accessToken?: string | null,
  options?: { spokenPoiKeys?: string[] },
): Promise<LugeChatResponse> {
  const { headers, deviceId } = await functionHeaders(accessToken)
  const body: LugeChatRequest = {
    mode: 'proactive',
    latitude: coords.latitude,
    longitude: coords.longitude,
    heading: coords.heading,
    device_id: deviceId,
    debug: __DEV__,
    spoken_poi_keys: options?.spokenPoiKeys ?? [],
  }

  const t0 = Date.now()
  const res = await fetch(`${SUPABASE_URL}/functions/v1/luge-chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  const contentType = res.headers.get('content-type') ?? ''
  if (__DEV__ && contentType.includes('application/x-ndjson')) {
    return readNdjsonLugeChat(res, t0)
  }

  const data = await res.json().catch(() => ({}))
  if (__DEV__) {
    console.log(`[luge proactive] 请求往返 ${Date.now() - t0}ms`)
  }
  if (res.status === 402 && isQuotaExhaustedError(data)) {
    throw new LugeChatQuotaError(data)
  }
  if (!res.ok) {
    const msg =
      (typeof data.error === 'string' && data.error) ||
      (typeof data.msg === 'string' && data.msg) ||
      '主动讲解暂时不可用'
    throw new Error(msg)
  }

  const result = data as LugeChatResponse
  if (__DEV__ && result.debug) {
    printLugeChatDebugTimeline(result.debug)
  }
  return result
}
