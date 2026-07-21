/**
 * 火山 VoiceChat 回调：
 * - RTS 会话状态：answerFinish 扣次（RoundID 去重）；asrFinish 缓存用户句供足迹
 * - Function Calling：get_nearby_landmarks → UpdateVoiceChat Command=function
 */

import { callRtcOpenApi } from '../volc-voice-chat/openApi.ts'
import {
  formatLandmarksForLlm,
  lookupNearbyLandmarks,
} from '../volc-voice-chat/nearbyLandmarks.ts'
import { getSessionLoc } from '../volc-voice-chat/sessionLoc.ts'
import { VOICE_CHAT_API_VERSION } from '../volc-voice-chat/voiceChatConfig.ts'
import { chargeAnswerFinish } from './quotaCharge.ts'
import {
  extractStageText,
  ingestSubtitlePayload,
  stashAsrFinishText,
  sweepPendingFootprintsForTask,
  tryCompleteVoiceFootprint,
} from './voiceFootprint.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-signature, signature',
}

type ToolCall = {
  id: string
  name: string
  arguments: Record<string, unknown>
}

/** Type=information 回调里的 response_id，与 tool_call_id 配对回传 */
const fcHintByCall = new Map<string, { responseId?: string }>()

function fcHintKey(taskId: string, toolCallId: string) {
  return `${taskId}:${toolCallId}`
}

function stashFcInformation(payload: Record<string, unknown>) {
  const expanded = expandFcEnvelope(payload)
  const toolCallId =
    typeof expanded.tool_call_id === 'string' ? expanded.tool_call_id : ''
  const responseId =
    typeof expanded.response_id === 'string' ? expanded.response_id : ''
  const taskId = String(payload.TaskID ?? payload.TaskId ?? '')
  if (toolCallId && taskId) {
    fcHintByCall.set(fcHintKey(taskId, toolCallId), {
      responseId: responseId || undefined,
    })
  }
}

/** 控制回传 Content 体积，避免平台拒收或 LLM 不继续 */
function compactToolContent(content: string, maxLen = 1600): string {
  if (content.length <= maxLen) return content
  try {
    const o = JSON.parse(content) as {
      landmarks?: Array<Record<string, unknown>>
      note?: string
      ok?: boolean
    }
    if (Array.isArray(o.landmarks)) {
      o.landmarks = o.landmarks.slice(0, 4).map((l) => ({
        name: l.name,
        type: l.type,
        distance_m: l.distance_m,
        direction: l.direction,
      }))
      const trimmed = JSON.stringify(o)
      if (trimmed.length <= maxLen) return trimmed
    }
  } catch {
    /* ignore */
  }
  return content.slice(0, maxLen)
}

function decodeRtsMessage(b64: string): Record<string, unknown> | null {
  try {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const brace = bytes.indexOf(0x7b) // '{'
    if (brace < 0) return null
    const text = new TextDecoder().decode(bytes.subarray(brace))
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return null
  }
}

/** 解析 FC 的 Message：JSON 对象，或 tool_calls 数组字符串 */
function parseFcMessageString(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const tryParsed = (parsed: unknown): Record<string, unknown> | null => {
    if (Array.isArray(parsed)) {
      return { tool_calls: parsed }
    }
    return asRecord(parsed)
  }

  try {
    const direct = tryParsed(JSON.parse(trimmed))
    if (direct) return direct
  } catch {
    /* continue */
  }

  const fromRts = decodeRtsMessage(trimmed)
  if (fromRts) return fromRts

  try {
    return tryParsed(JSON.parse(atob(trimmed)))
  } catch {
    return null
  }
}

function stageOf(parsed: Record<string, unknown>): string {
  const stage = parsed.Stage
  if (stage && typeof stage === 'object') {
    const s = stage as Record<string, unknown>
    if (typeof s.Description === 'string') return s.Description
    if (typeof s.Code === 'number') return `code_${s.Code}`
  }
  if (typeof parsed.RunStage === 'string') return parsed.RunStage
  if (typeof parsed.Event === 'string') return parsed.Event
  if (typeof parsed.type === 'string') return parsed.type
  if (typeof parsed.Type === 'string') return parsed.Type
  return ''
}

function compactJson(v: unknown): string {
  try {
    return JSON.stringify(v).slice(0, 600)
  } catch {
    return String(v).slice(0, 600)
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      /* ignore */
    }
  }
  return {}
}

/**
 * 把 FC 外壳的 Message 展开进 payload，便于抽 tool_calls。
 * 保留外壳上的 RoomID/TaskID/AppID。
 */
function expandFcEnvelope(payload: Record<string, unknown>): Record<string, unknown> {
  const msg = payload.Message ?? payload.message
  if (typeof msg !== 'string' || !msg.trim()) return payload

  const nested = parseFcMessageString(msg)
  if (!nested) {
    console.warn(
      `[volc-voice-callback] FC Message decode fail preview=${msg.slice(0, 120)}`,
    )
    return payload
  }

  return {
    ...nested,
    ...payload,
    tool_calls: nested.tool_calls ?? payload.tool_calls,
    ToolCalls: nested.ToolCalls ?? payload.ToolCalls,
  }
}

function extractToolCalls(payload: Record<string, unknown>): ToolCall[] {
  const candidates: unknown[] = []
  const pushArr = (v: unknown) => {
    if (Array.isArray(v)) candidates.push(...v)
  }

  pushArr(payload.tool_calls)
  pushArr(payload.ToolCalls)

  const data = asRecord(payload.data) ?? asRecord(payload.Data)
  if (data) {
    pushArr(data.tool_calls)
    pushArr(data.ToolCalls)
  }

  const out: ToolCall[] = []
  for (const item of candidates) {
    const row = asRecord(item)
    if (!row) continue
    const fn =
      asRecord(row.function) ??
      asRecord(row.Function) ??
      asRecord(row.FunctionCall) ??
      row
    const name =
      (typeof fn.name === 'string' && fn.name) ||
      (typeof fn.Name === 'string' && fn.Name) ||
      (typeof row.name === 'string' && row.name) ||
      ''
    if (!name) continue
    const id =
      (typeof row.id === 'string' && row.id) ||
      (typeof row.ID === 'string' && row.ID) ||
      (typeof row.ToolCallID === 'string' && row.ToolCallID) ||
      (typeof row.tool_call_id === 'string' && row.tool_call_id) ||
      `call_${crypto.randomUUID().slice(0, 12)}`
    const args = parseArgs(
      fn.arguments ?? fn.Arguments ?? row.arguments ?? row.Arguments,
    )
    out.push({ id, name, arguments: args })
  }
  return out
}

function isFcEnvelope(payload: Record<string, unknown>): boolean {
  const hasIds =
    !!(payload.RoomID || payload.RoomId || payload.room_id) &&
    !!(payload.TaskID || payload.TaskId || payload.task_id)
  const hasMessage = typeof (payload.Message ?? payload.message) === 'string'
  const typeStr = String(payload.Type ?? payload.type ?? '').toLowerCase()
  if (hasIds && hasMessage && !payload.Stage) return true
  if (/function|tool|fc/.test(typeStr)) return true
  return false
}

function looksLikeFunctionCall(payload: Record<string, unknown>): boolean {
  const typeStr = String(payload.Type ?? payload.type ?? '').toLowerCase()
  // 仅通知「将要调工具」，参数在后续 Type=tool_calls 里
  if (typeStr === 'information') return false
  if (typeStr === 'tool_calls') return true
  if (extractToolCalls(expandFcEnvelope(payload)).length > 0) return true
  const stage = stageOf(payload).toLowerCase()
  if (/function|tool.?call|fc/.test(stage)) return true
  return false
}

async function executeTool(
  call: ToolCall,
  session: { lat: number; lng: number; heading: number | null } | null,
): Promise<string> {
  if (call.name !== 'get_nearby_landmarks') {
    return JSON.stringify({
      ok: false,
      error: `unknown tool: ${call.name}`,
    })
  }

  if (!session || (session.lat === 0 && session.lng === 0)) {
    return JSON.stringify({
      ok: false,
      error: 'no_session_location',
      hint: '客户端尚未上报 GPS',
    })
  }

  const radiusRaw = call.arguments.radius_m ?? call.arguments.radiusM
  const radiusM =
    typeof radiusRaw === 'number'
      ? radiusRaw
      : typeof radiusRaw === 'string'
        ? Number(radiusRaw)
        : undefined
  const focus =
    typeof call.arguments.focus === 'string'
      ? call.arguments.focus
      : typeof call.arguments.query === 'string'
        ? call.arguments.query
        : undefined

  const { landmarks, note } = await lookupNearbyLandmarks({
    lat: session.lat,
    lng: session.lng,
    heading: session.heading,
    radiusM: Number.isFinite(radiusM) ? radiusM : undefined,
    focus,
  })

  console.log(
    `[volc-voice-callback] FC get_nearby_landmarks hits=${landmarks.length} note=${note}`,
  )

  return formatLandmarksForLlm(landmarks, {
    lat: session.lat,
    lng: session.lng,
    heading: session.heading,
    note,
  })
}

async function sendFunctionCallResult(opts: {
  appId: string
  roomId: string
  taskId: string
  results: Array<{ ToolCallID: string; Content: string }>
}): Promise<void> {
  const accessKeyId = Deno.env.get('VOLC_OPENAPI_ACCESS_KEY_ID')?.trim()
  const secretKey = Deno.env.get('VOLC_OPENAPI_SECRET_KEY')?.trim()
  if (!accessKeyId || !secretKey) {
    throw new Error('VOLC_OPENAPI_* not configured')
  }

  for (const row of opts.results) {
    const hint = fcHintByCall.get(fcHintKey(opts.taskId, row.ToolCallID))
    const msgObj: Record<string, string> = {
      ToolCallID: row.ToolCallID,
      Content: compactToolContent(row.Content),
    }
    if (hint?.responseId) msgObj.response_id = hint.responseId

    const message = JSON.stringify(msgObj)
    // 路测确认：Command=function + 单对象 Message 可继续 TTS；FunctionCallResult 作兼容兜底
    const commands = ['function', 'FunctionCallResult'] as const
    let sent = false
    let lastErr = 'UpdateVoiceChat failed'

    for (const command of commands) {
      const result = await callRtcOpenApi<{
        ResponseMetadata?: { Error?: { Code?: string; Message?: string } }
      }>({
        accessKeyId,
        secretKey,
        action: 'UpdateVoiceChat',
        version: VOICE_CHAT_API_VERSION,
        body: {
          AppId: opts.appId,
          RoomId: opts.roomId,
          TaskId: opts.taskId,
          Command: command,
          Message: message,
        },
      })

      const err = result.data?.ResponseMetadata?.Error
      if (result.ok && !err) {
        console.log(
          `[volc-voice-callback] FC result ok command=${command} call=${row.ToolCallID.slice(0, 18)} msgLen=${message.length}`,
        )
        fcHintByCall.delete(fcHintKey(opts.taskId, row.ToolCallID))
        sent = true
        break
      }
      lastErr = err?.Message
        ? `${command}: ${err.Code ?? 'Error'} ${err.Message}`
        : `${command}: HTTP ${result.status}`
      console.warn(`[volc-voice-callback] FC result retry: ${lastErr}`)
    }

    if (!sent) {
      throw new Error(lastErr)
    }
  }
}

async function handleFunctionCalling(
  payload: Record<string, unknown>,
): Promise<boolean> {
  const expanded = expandFcEnvelope(payload)
  const toolCalls = extractToolCalls(expanded)

  const roomId = String(
    expanded.RoomId ??
      expanded.room_id ??
      expanded.RoomID ??
      payload.RoomID ??
      '',
  )
  const taskId = String(
    expanded.TaskId ??
      expanded.task_id ??
      expanded.TaskID ??
      payload.TaskID ??
      '',
  )
  const appId =
    String(
      expanded.AppId ??
        expanded.app_id ??
        expanded.AppID ??
        payload.AppID ??
        '',
    ) ||
    Deno.env.get('VOLC_RTC_APP_ID')?.trim() ||
    ''

  const typeStr = String(expanded.Type ?? expanded.type ?? '')

  if (toolCalls.length === 0) {
    console.warn(
      `[volc-voice-callback] FC envelope but no tools type=${typeStr} room=${roomId} task=${taskId} payload=${compactJson(expanded)}`,
    )
    return true
  }

  if (!roomId || !taskId || !appId) {
    console.error(
      `[volc-voice-callback] FC missing ids room=${roomId} task=${taskId} app=${!!appId} payload=${compactJson(expanded)}`,
    )
    return true
  }

  console.log(
    `[volc-voice-callback] FC type=${typeStr} tools=${toolCalls.map((t) => `${t.name}(${t.id})`).join(',')} room=${roomId} task=${taskId}`,
  )

  const loc = await getSessionLoc({ roomId, taskId })
  const session = loc
    ? { lat: loc.lat, lng: loc.lng, heading: loc.heading }
    : null

  const results: Array<{ ToolCallID: string; Content: string }> = []
  for (const call of toolCalls) {
    const content = await executeTool(call, session)
    results.push({ ToolCallID: call.id, Content: content })
  }

  try {
    await sendFunctionCallResult({ appId, roomId, taskId, results })
  } catch (e) {
    console.error('[volc-voice-callback] FunctionCallResult failed:', e)
  }
  return true
}

function taskIdFrom(inner: Record<string, unknown>): string {
  const v = inner.TaskId ?? inner.TaskID ?? inner.task_id
  return typeof v === 'string' ? v.trim() : ''
}

function roomIdFrom(inner: Record<string, unknown>): string {
  const v = inner.RoomId ?? inner.RoomID ?? inner.room_id
  return typeof v === 'string' ? v.trim() : ''
}

function roundIdFrom(inner: Record<string, unknown>): string {
  const v = inner.RoundID ?? inner.RoundId ?? inner.round_id
  if (v == null || v === '') return ''
  return String(v)
}

/** 字幕回调常不带 TaskId，用最近一次同房间的 task 补全 */
const taskByRoom = new Map<string, string>()
let lastTaskId = ''

function rememberSessionIds(inner: Record<string, unknown>) {
  const taskId = taskIdFrom(inner)
  const roomId = roomIdFrom(inner)
  if (taskId) lastTaskId = taskId
  if (taskId && roomId) taskByRoom.set(roomId, taskId)
}

function enrichFromEnvelope(
  inner: Record<string, unknown>,
  envelope: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...inner }
  if (!taskIdFrom(out)) {
    const t = envelope.TaskID ?? envelope.TaskId
    if (typeof t === 'string' && t.trim()) out.TaskId = t.trim()
  }
  if (!roomIdFrom(out)) {
    const r = envelope.RoomID ?? envelope.RoomId
    if (typeof r === 'string' && r.trim()) out.RoomId = r.trim()
  }
  return out
}

function resolveTaskId(inner: Record<string, unknown>): string {
  const direct = taskIdFrom(inner)
  if (direct) return direct
  const roomId = roomIdFrom(inner)
  if (roomId) {
    const fromRoom = taskByRoom.get(roomId)
    if (fromRoom) return fromRoom
  }
  return lastTaskId
}

async function handleRtsStage(inner: Record<string, unknown>) {
  rememberSessionIds(inner)
  const stage = stageOf(inner)
  const round = roundIdFrom(inner)
  const taskId = resolveTaskId(inner)
  const roomId = roomIdFrom(inner)

  if (stage === 'subtitle') {
    await ingestSubtitlePayload({ taskIdHint: taskId, data: inner.data })
    return
  }

  if (stage === 'asrFinish' && taskId && round !== '') {
    const text = extractStageText(inner)
    if (text) await stashAsrFinishText({ taskId, roundId: round, text })
  }

  if (stage === 'answerFinish' && taskId && round !== '') {
    await chargeAnswerFinish({ taskId, roundId: round, roomId })
    void tryCompleteVoiceFootprint({
      taskId,
      roundId: round,
      roomId,
      assistantHint: extractStageText(inner),
    }).catch((e) => console.warn('[volc-voice-callback] footprint async:', e))
    void sweepPendingFootprintsForTask(taskId).catch((e) =>
      console.warn('[volc-voice-callback] footprint sweep:', e),
    )
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const raw = await req.text().catch(() => '')
  try {
    const envelope = JSON.parse(raw) as {
      message?: string
      binary?: boolean
      signature?: string
      // 有的 FC 回调可能直接是外壳 JSON（无再包一层 message）
      Message?: string
      Type?: string
      RoomID?: string
      TaskID?: string
      AppID?: string
    }
    const expected = Deno.env.get('VOLC_VOICE_CALLBACK_SECRET')?.trim()
    const sig = envelope.signature ?? (envelope as { Signature?: string }).Signature
    if (expected && sig && sig !== expected) {
      console.warn('[volc-voice-callback] signature mismatch')
    }

    let inner: Record<string, unknown> | null = null
    if (typeof envelope.message === 'string' && envelope.message) {
      inner = decodeRtsMessage(envelope.message)
      if (!inner) inner = parseFcMessageString(envelope.message)
    } else if (envelope.Type || envelope.Message || envelope.RoomID) {
      // 直传 FC 外壳
      inner = asRecord(envelope)
    } else {
      inner = asRecord(JSON.parse(raw))
    }

    if (!inner) {
      console.log(
        `[volc-voice-callback] undecoded bytes=${raw.length} preview=${raw.slice(0, 120)}`,
      )
    } else {
      inner = enrichFromEnvelope(inner, envelope as Record<string, unknown>)
    }

    if (!inner) {
      /* already logged */
    } else if (looksLikeFunctionCall(inner)) {
      await handleFunctionCalling(inner)
    } else if (
      isFcEnvelope(inner) &&
      String(inner.Type ?? inner.type ?? '').toLowerCase() === 'information'
    ) {
      stashFcInformation(inner)
    } else {
      await handleRtsStage(inner)
      const stage = stageOf(inner)
      const err = inner.ErrorInfo as
        | { ErrorCode?: number; Reason?: string }
        | undefined
      const round = inner.RoundID ?? inner.RoundId ?? null
      if (err?.Reason) {
        console.error(
          `[volc-voice-callback] ERROR stage=${stage} round=${round} code=${err.ErrorCode} reason=${err.Reason}`,
        )
      } else if (
        typeof inner.type === 'string' ||
        typeof inner.data !== 'undefined'
      ) {
        console.log(
          `[volc-voice-callback] stage=${stage || '(none)'} round=${round} payload=${compactJson(inner)}`,
        )
      } else {
        console.log(
          `[volc-voice-callback] stage=${stage || '(none)'} round=${round} task=${inner.TaskId ?? inner.TaskID ?? ''} keys=${Object.keys(inner).join(',')}`,
        )
      }
    }
  } catch {
    console.log(`[volc-voice-callback] parse fail bytes=${raw.length}`)
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
