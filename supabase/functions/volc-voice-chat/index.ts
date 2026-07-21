/**
 * 火山 RTC Token + StartVoiceChat / StopVoiceChat / location（方案甲 V3）
 *
 * 环境变量：
 *   VOLC_RTC_APP_ID / VOLC_RTC_APP_KEY
 *   VOLC_OPENAPI_ACCESS_KEY_ID / VOLC_OPENAPI_SECRET_KEY
 *   VOLC_VOICE_CALLBACK_SECRET
 */

import { sendExternalTextToSpeech } from './externalTts.ts'
import { callRtcOpenApi } from './openApi.ts'
import { mintRtcAccessToken } from './rtcToken.ts'
import { touchSessionTask, upsertSessionLoc } from './sessionLoc.ts'
import {
  getQuotaStatus,
  parseQuotaAuth,
  QuotaExhaustedError,
} from '../luge-chat/quota.ts'
import { adminClient } from './sessionLoc.ts'
import {
  VOICE_CHAT_API_VERSION,
  buildStartVoiceChatBody,
  LUGE_BOT_USER_ID,
} from './voiceChatConfig.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-luge-device-id',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function shortId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
}

function requireEnv(name: string): string {
  const v = Deno.env.get(name)?.trim()
  if (!v) throw new Error(`${name} is not configured`)
  return v
}

type VolcMeta = {
  ResponseMetadata?: {
    Error?: { Code?: string; Message?: string }
    RequestId?: string
  }
  Result?: unknown
}

function volcErrorMessage(data: VolcMeta, fallback: string): string {
  const err = data?.ResponseMetadata?.Error
  if (err?.Message) return `${err.Code ?? 'Error'}: ${err.Message}`
  return fallback
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ error: 'method not allowed' }, 405)
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const action = typeof body.action === 'string' ? body.action : 'session'

    const appId = Deno.env.get('VOLC_RTC_APP_ID')?.trim()
    const appKey = Deno.env.get('VOLC_RTC_APP_KEY')?.trim()
    if (!appId || !appKey) {
      return json(
        {
          error: 'volc RTC not configured',
          hint: '配置 VOLC_RTC_APP_ID / VOLC_RTC_APP_KEY',
        },
        503,
      )
    }

    if (action === 'session') {
      const roomId =
        typeof body.room_id === 'string' && body.room_id
          ? body.room_id
          : shortId('room')
      const userId =
        typeof body.user_id === 'string' && body.user_id
          ? body.user_id
          : shortId('user')

      const expireSeconds =
        typeof body.expire_seconds === 'number' && body.expire_seconds > 60
          ? Math.min(body.expire_seconds, 60 * 60 * 48)
          : 60 * 60 * 24
      const expireAt = Math.floor(Date.now() / 1000) + expireSeconds

      const token = await mintRtcAccessToken({
        appId,
        appKey,
        roomId,
        userId,
        expireAt,
      })

      return json({
        app_id: appId,
        room_id: roomId,
        user_id: userId,
        token,
        expire_at: expireAt,
        bot_user_id: LUGE_BOT_USER_ID,
      })
    }

    if (action === 'start') {
      const roomId = typeof body.room_id === 'string' ? body.room_id.trim() : ''
      const userId = typeof body.user_id === 'string' ? body.user_id.trim() : ''
      if (!roomId || !userId) {
        return json({ error: 'room_id and user_id required' }, 400)
      }

      const { userId: lugeUserId, deviceKey } = await parseQuotaAuth(req, {
        device_id: body.device_id as string | undefined,
      })
      try {
        const status = await getQuotaStatus(adminClient(), {
          userId: lugeUserId,
          deviceKey,
        })
        if (!status.can_ask) {
          return json(
            {
              code: 'QUOTA_EXHAUSTED',
              tier: status.tier,
              register_bonus: status.register_bonus,
              error: 'quota exhausted',
            },
            402,
          )
        }
      } catch (e) {
        if (e instanceof QuotaExhaustedError) {
          return json(
            {
              code: 'QUOTA_EXHAUSTED',
              tier: e.tier,
              register_bonus: e.register_bonus,
              error: 'quota exhausted',
            },
            402,
          )
        }
        throw e
      }

      const taskId =
        typeof body.task_id === 'string' && body.task_id.trim()
          ? body.task_id.trim()
          : shortId('task')

      const accessKeyId = requireEnv('VOLC_OPENAPI_ACCESS_KEY_ID')
      const secretKey = requireEnv('VOLC_OPENAPI_SECRET_KEY')
      const callbackSecret =
        Deno.env.get('VOLC_VOICE_CALLBACK_SECRET')?.trim() || 'luge_volc_cb'

      const startBody = buildStartVoiceChatBody({
        appId,
        roomId,
        taskId,
        targetUserId: userId,
        callbackSecret,
      })

      console.log(
        `[volc-voice-chat] StartVoiceChat (console ASR StreamMode=2) room=${roomId} task=${taskId} target=${userId}`,
      )

      let result = await callRtcOpenApi<VolcMeta>({
        accessKeyId,
        secretKey,
        action: 'StartVoiceChat',
        version: VOICE_CHAT_API_VERSION,
        body: startBody,
      })

      // 同 Room/Task 已启动时先停再启
      const errMsg = result.data?.ResponseMetadata?.Error
        ? volcErrorMessage(result.data, '')
        : ''
      if (errMsg && /already|has been started|任务已|Already/i.test(errMsg)) {
        console.warn('StartVoiceChat retry after stop:', errMsg)
        await callRtcOpenApi({
          accessKeyId,
          secretKey,
          action: 'StopVoiceChat',
          version: VOICE_CHAT_API_VERSION,
          body: { AppId: appId, RoomId: roomId, TaskId: taskId },
        })
        result = await callRtcOpenApi<VolcMeta>({
          accessKeyId,
          secretKey,
          action: 'StartVoiceChat',
          version: VOICE_CHAT_API_VERSION,
          body: startBody,
        })
      }

      if (!result.ok || result.data?.ResponseMetadata?.Error) {
        console.error('StartVoiceChat error', JSON.stringify(result.data))
        return json(
          {
            error: volcErrorMessage(result.data, 'StartVoiceChat failed'),
            detail: result.data,
            task_id: taskId,
          },
          502,
        )
      }

      await touchSessionTask({
        roomId,
        taskId,
        userId,
        lugeUserId,
        deviceKey,
      })

      return json({
        ok: true,
        room_id: roomId,
        user_id: userId,
        task_id: taskId,
        bot_user_id: LUGE_BOT_USER_ID,
        request_id: result.data?.ResponseMetadata?.RequestId ?? null,
      })
    }

    if (action === 'location') {
      const roomId = typeof body.room_id === 'string' ? body.room_id.trim() : ''
      const lat = typeof body.lat === 'number' ? body.lat : Number(body.lat)
      const lng = typeof body.lng === 'number' ? body.lng : Number(body.lng)
      if (!roomId || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        return json({ error: 'room_id, lat, lng required' }, 400)
      }
      const taskId =
        typeof body.task_id === 'string' ? body.task_id.trim() : undefined
      const userId =
        typeof body.user_id === 'string' ? body.user_id.trim() : undefined
      const headingRaw =
        typeof body.heading === 'number'
          ? body.heading
          : body.heading != null
            ? Number(body.heading)
            : null
      const heading =
        headingRaw != null && Number.isFinite(headingRaw) ? headingRaw : null

      const { userId: lugeUserId, deviceKey } = await parseQuotaAuth(req, {
        device_id: body.device_id as string | undefined,
      })

      await upsertSessionLoc({
        roomId,
        taskId,
        userId,
        lugeUserId,
        deviceKey,
        lat,
        lng,
        heading,
      })
      console.log(
        `[volc-voice-chat] location room=${roomId} task=${taskId ?? ''} lat=${lat.toFixed(5)} lng=${lng.toFixed(5)} heading=${heading ?? 'n/a'}`,
      )
      return json({ ok: true, room_id: roomId, lat, lng, heading })
    }

    if (action === 'external_tts') {
      const roomId = typeof body.room_id === 'string' ? body.room_id.trim() : ''
      const taskId = typeof body.task_id === 'string' ? body.task_id.trim() : ''
      const text = typeof body.text === 'string' ? body.text.trim() : ''
      if (!roomId || !taskId || !text) {
        return json({ error: 'room_id, task_id, text required' }, 400)
      }
      const interruptMode =
        typeof body.interrupt_mode === 'number'
          ? Math.min(3, Math.max(1, Math.round(body.interrupt_mode)))
          : 2
      await sendExternalTextToSpeech({
        appId,
        roomId,
        taskId,
        text,
        interruptMode,
      })
      return json({ ok: true, room_id: roomId, task_id: taskId })
    }

    if (action === 'repair_footprints') {
      const auth = req.headers.get('Authorization') ?? ''
      const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      if (!service || auth !== `Bearer ${service}`) {
        return json({ error: 'forbidden' }, 403)
      }
      const taskId =
        typeof body.task_id === 'string' ? body.task_id.trim() : ''
      if (!taskId) return json({ error: 'task_id required' }, 400)
      const { sweepPendingFootprintsForTask } = await import(
        '../volc-voice-callback/voiceFootprint.ts'
      )
      await sweepPendingFootprintsForTask(taskId)
      return json({ ok: true, task_id: taskId })
    }

    if (action === 'stop') {
      const roomId = typeof body.room_id === 'string' ? body.room_id.trim() : ''
      const taskId = typeof body.task_id === 'string' ? body.task_id.trim() : ''
      if (!roomId || !taskId) {
        return json({ error: 'room_id and task_id required' }, 400)
      }

      const accessKeyId = requireEnv('VOLC_OPENAPI_ACCESS_KEY_ID')
      const secretKey = requireEnv('VOLC_OPENAPI_SECRET_KEY')

      const result = await callRtcOpenApi<VolcMeta>({
        accessKeyId,
        secretKey,
        action: 'StopVoiceChat',
        version: VOICE_CHAT_API_VERSION,
        body: { AppId: appId, RoomId: roomId, TaskId: taskId },
      })

      if (!result.ok || result.data?.ResponseMetadata?.Error) {
        // 停止失败多数可忽略（任务已结束）
        const msg = volcErrorMessage(result.data, 'StopVoiceChat failed')
        console.warn('StopVoiceChat:', msg)
        return json({
          ok: false,
          warning: msg,
          room_id: roomId,
          task_id: taskId,
        })
      }

      return json({ ok: true, room_id: roomId, task_id: taskId })
    }

    return json({ error: `unknown action: ${action}` }, 400)
  } catch (err) {
    console.error('volc-voice-chat error:', err)
    const msg = err instanceof Error ? err.message : 'internal error'
    return json({ error: msg }, 500)
  }
})
