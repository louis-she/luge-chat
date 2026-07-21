import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config'
import { getDeviceId } from './deviceId'
import { isQuotaExhaustedError, type QuotaExhaustedPayload } from './quota'

export type VolcRtcSession = {
  app_id: string
  room_id: string
  user_id: string
  token: string
  expire_at: number
  bot_user_id?: string
}

export type VolcVoiceChatTask = {
  ok: boolean
  room_id: string
  user_id: string
  task_id: string
  bot_user_id: string
  request_id?: string | null
}

export class VolcVoiceQuotaError extends Error {
  payload: QuotaExhaustedPayload

  constructor(payload: QuotaExhaustedPayload) {
    super('quota exhausted')
    this.payload = payload
  }
}

async function volcRequestHeaders(accessToken?: string | null) {
  const deviceId = await getDeviceId()
  const token = accessToken?.trim() || SUPABASE_ANON_KEY
  return {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Luge-Device-Id': deviceId,
    },
    deviceId,
  }
}

async function postVolcVoiceChat(
  body: Record<string, unknown>,
  opts?: { timeoutMs?: number; accessToken?: string | null },
): Promise<Record<string, unknown>> {
  if (!SUPABASE_ANON_KEY) {
    throw new Error('缺少 EXPO_PUBLIC_SUPABASE_ANON_KEY')
  }
  const timeoutMs = opts?.timeoutMs ?? 20_000
  const { headers, deviceId } = await volcRequestHeaders(opts?.accessToken)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/volc-voice-chat`, {
      method: 'POST',
      headers,
      signal: ctrl.signal,
      body: JSON.stringify({ ...body, device_id: deviceId }),
    })
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) {
      if (res.status === 402 && isQuotaExhaustedError(data)) {
        throw new VolcVoiceQuotaError(data)
      }
      const msg =
        (typeof data.error === 'string' && data.error) ||
        (typeof data.hint === 'string' && data.hint) ||
        `volc-voice-chat HTTP ${res.status}`
      throw new Error(msg)
    }
    return data
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error(`volc-voice-chat 超时（${timeoutMs}ms）`)
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

/** 向服务端申请 RTC 进房凭证 */
export async function createVolcRtcSession(opts?: {
  roomId?: string
  userId?: string
  timeoutMs?: number
  accessToken?: string | null
}): Promise<VolcRtcSession> {
  const data = await postVolcVoiceChat(
    {
      action: 'session',
      room_id: opts?.roomId,
      user_id: opts?.userId,
    },
    { timeoutMs: opts?.timeoutMs ?? 12_000, accessToken: opts?.accessToken },
  )
  if (
    typeof data.app_id !== 'string' ||
    typeof data.room_id !== 'string' ||
    typeof data.user_id !== 'string' ||
    typeof data.token !== 'string'
  ) {
    throw new Error('volc-voice-chat session response incomplete')
  }
  return {
    app_id: data.app_id,
    room_id: data.room_id,
    user_id: data.user_id,
    token: data.token,
    expire_at: typeof data.expire_at === 'number' ? data.expire_at : 0,
    bot_user_id:
      typeof data.bot_user_id === 'string' ? data.bot_user_id : undefined,
  }
}

/** 进房成功后拉起火山 AI 智能体（ASR+LLM+TTS） */
export async function startVolcVoiceChat(opts: {
  roomId: string
  userId: string
  taskId?: string
  accessToken?: string | null
}): Promise<VolcVoiceChatTask> {
  const data = await postVolcVoiceChat(
    {
      action: 'start',
      room_id: opts.roomId,
      user_id: opts.userId,
      task_id: opts.taskId,
    },
    { timeoutMs: 25_000, accessToken: opts.accessToken },
  )
  if (typeof data.task_id !== 'string') {
    throw new Error('start VoiceChat: missing task_id')
  }
  return {
    ok: data.ok !== false,
    room_id: typeof data.room_id === 'string' ? data.room_id : opts.roomId,
    user_id: typeof data.user_id === 'string' ? data.user_id : opts.userId,
    task_id: data.task_id,
    bot_user_id:
      typeof data.bot_user_id === 'string' ? data.bot_user_id : 'luge_guide',
    request_id:
      typeof data.request_id === 'string' || data.request_id === null
        ? (data.request_id as string | null)
        : null,
  }
}

export async function stopVolcVoiceChat(opts: {
  roomId: string
  taskId: string
  accessToken?: string | null
}): Promise<void> {
  try {
    await postVolcVoiceChat(
      {
        action: 'stop',
        room_id: opts.roomId,
        task_id: opts.taskId,
      },
      { timeoutMs: 12_000, accessToken: opts.accessToken },
    )
  } catch (e) {
    console.warn('[volc-voice] stop failed', e)
  }
}

/** 上报会话 GPS，供服务端 Function Calling 查周边 */
export async function reportVolcVoiceLocation(opts: {
  roomId: string
  taskId?: string
  userId?: string
  lat: number
  lng: number
  heading?: number | null
  accessToken?: string | null
}): Promise<void> {
  await postVolcVoiceChat(
    {
      action: 'location',
      room_id: opts.roomId,
      task_id: opts.taskId,
      user_id: opts.userId,
      lat: opts.lat,
      lng: opts.lng,
      heading: opts.heading ?? null,
    },
    { timeoutMs: 8_000, accessToken: opts.accessToken },
  )
}

/** V6 主动讲解：火山 ExternalTextToSpeech（需已 StartVoiceChat） */
export async function speakExternalVolcVoice(opts: {
  roomId: string
  taskId: string
  text: string
  interruptMode?: number
  accessToken?: string | null
}): Promise<void> {
  await postVolcVoiceChat(
    {
      action: 'external_tts',
      room_id: opts.roomId,
      task_id: opts.taskId,
      text: opts.text,
      interrupt_mode: opts.interruptMode ?? 2,
    },
    { timeoutMs: 25_000, accessToken: opts.accessToken },
  )
}
