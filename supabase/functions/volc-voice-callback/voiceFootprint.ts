import {
  applyFootprintDecision,
  classifyFootprint,
  fetchNearbyFootprints,
  summarizeVisitAndFootprint,
  type ProactivePoiContext,
} from '../luge-chat/footprint.ts'
import {
  formatLandmarksForLlm,
  lookupNearbyLandmarks,
} from '../volc-voice-chat/nearbyLandmarks.ts'
import {
  adminClient,
  getSessionByRtcUserId,
  getSessionLoc,
  peekTopicPoi,
  type SessionLoc,
} from '../volc-voice-chat/sessionLoc.ts'
import { getRoundDialog, markFootprintDone, mergeRoundDialog } from './roundDialog.ts'

export function extractStageText(inner: Record<string, unknown>): string {
  const direct = ['Text', 'text', 'Content', 'content', 'ASRText', 'Answer', 'answer']
  for (const k of direct) {
    const v = inner[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  const stage = inner.Stage
  if (stage && typeof stage === 'object') {
    const s = stage as Record<string, unknown>
    for (const k of direct) {
      const v = s[k]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
  }
  const data = inner.data ?? inner.Data
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return extractStageText(data as Record<string, unknown>)
  }
  return ''
}

function rtcUserIdFromSubtitle(data: unknown): string | null {
  if (!Array.isArray(data)) return null
  for (const item of data) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    if (Number(row.mode) !== 0) continue
    const uid = row.userId ?? row.user_id
    if (typeof uid === 'string' && uid.trim() && !uid.startsWith('luge_')) {
      return uid.trim()
    }
  }
  for (const item of data) {
    if (!item || typeof item !== 'object') continue
    const uid = (item as Record<string, unknown>).userId
    if (typeof uid === 'string' && uid.trim() && !uid.startsWith('luge_')) {
      return uid.trim()
    }
  }
  return null
}

async function resolveTaskId(opts: {
  taskIdHint: string
  rtcUserId?: string | null
}): Promise<string> {
  const direct = opts.taskIdHint.trim()
  if (direct) return direct
  const rtc = opts.rtcUserId?.trim()
  if (!rtc) return ''
  const sess = await getSessionByRtcUserId(rtc)
  return sess?.task_id?.trim() ?? ''
}

/** 火山 RTS 字幕 → DB；字幕常晚于 answerFinish，且不带 TaskId */
export async function ingestSubtitlePayload(opts: {
  taskIdHint: string
  data: unknown
}): Promise<void> {
  if (!Array.isArray(opts.data) || opts.data.length === 0) return

  const rtcUserId = rtcUserIdFromSubtitle(opts.data)
  const taskId = await resolveTaskId({
    taskIdHint: opts.taskIdHint,
    rtcUserId,
  })
  if (!taskId) {
    console.warn(
      `[volc-voice-callback] subtitle skip: no task rtc=${rtcUserId ?? 'n/a'}`,
    )
    return
  }

  const touchedRounds = new Set<string>()

  for (const item of opts.data) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const mode = Number(row.mode)
    const roundRaw = row.roundId ?? row.round_id
    if (roundRaw == null || roundRaw === '') continue
    const roundId = String(roundRaw)
    const text = typeof row.text === 'string' ? row.text.trim() : ''
    if (!text) continue

    const definite = row.definite === true
    const paragraph = row.paragraph === true

    if (mode === 0 && definite) {
      await mergeRoundDialog({
        taskId,
        roundId,
        userText: text,
      })
      touchedRounds.add(roundId)
    } else if (mode === 1 && definite) {
      await mergeRoundDialog({
        taskId,
        roundId,
        assistantText: text,
        appendAssistant: !paragraph,
      })
      touchedRounds.add(roundId)
    }
  }

  for (const roundId of touchedRounds) {
    void tryCompleteVoiceFootprint({ taskId, roundId }).catch((e) =>
      console.warn('[volc-voice-callback] footprint after subtitle:', e),
    )
  }
  void sweepPendingFootprintsForTask(taskId).catch((e) =>
    console.warn('[volc-voice-callback] footprint sweep:', e),
  )
}

export async function stashAsrFinishText(opts: {
  taskId: string
  roundId: string
  text: string
}) {
  const text = opts.text.trim()
  if (!text || !opts.taskId) return
  await mergeRoundDialog({
    taskId: opts.taskId,
    roundId: opts.roundId,
    userText: text,
  })
  void tryCompleteVoiceFootprint({
    taskId: opts.taskId,
    roundId: opts.roundId,
  }).catch(() => {})
}

async function buildGeoContext(loc: SessionLoc): Promise<string> {
  const parts = [
    `用户 GPS：纬度 ${loc.lat.toFixed(6)}，经度 ${loc.lng.toFixed(6)}`,
    loc.heading != null ? `朝向约 ${Math.round(loc.heading)}°` : '朝向未知',
  ]
  if (loc.lat !== 0 || loc.lng !== 0) {
    try {
      const { landmarks, note } = await lookupNearbyLandmarks({
        lat: loc.lat,
        lng: loc.lng,
        heading: loc.heading,
      })
      parts.push(
        '',
        '## 周边地标',
        note,
        formatLandmarksForLlm(landmarks, {
          lat: loc.lat,
          lng: loc.lng,
          heading: loc.heading,
          note,
        }),
      )
    } catch {
      /* ignore */
    }
  }
  return parts.join('\n')
}

/** 把 session 上的话题锚定交给足迹分类器（否则「它的上游…」会被当成无地理对象而 skip） */
async function resolveProactiveContext(
  loc: SessionLoc,
): Promise<ProactivePoiContext | null> {
  const name = peekTopicPoi(loc)
  if (!name) return null

  let lat = loc.lat
  let lng = loc.lng
  let category: string | undefined
  try {
    const { landmarks } = await lookupNearbyLandmarks({
      lat: loc.lat,
      lng: loc.lng,
      heading: loc.heading,
      focus: name,
    })
    const hit =
      landmarks.find(
        (l) => l.name.includes(name) || name.includes(l.name),
      ) ?? landmarks[0]
    if (hit) {
      lat = hit.lat
      lng = hit.lng
      category = hit.type
    }
  } catch {
    /* 坐标退化到用户 GPS；分类器仍能靠专名建档 */
  }

  return { poi_name: name, lat, lng, category }
}

/** 用户句 + 助手句齐备后写足迹（可多次触发，幂等） */
export async function tryCompleteVoiceFootprint(opts: {
  taskId: string
  roundId: string
  roomId?: string
  assistantHint?: string
}) {
  const taskId = opts.taskId.trim()
  const roundId = opts.roundId.trim()
  if (!taskId || roundId === '') return

  if (opts.assistantHint?.trim()) {
    await mergeRoundDialog({
      taskId,
      roundId,
      assistantText: opts.assistantHint.trim(),
      appendAssistant: false,
    })
  }

  const dialog = await getRoundDialog(taskId, roundId)
  if (!dialog || dialog.footprint_done_at) return

  const userMessage = dialog.user_text?.trim() ?? ''
  const assistantMessage =
    dialog.assistant_text?.trim() ||
    opts.assistantHint?.trim() ||
    ''

  if (!userMessage) {
    console.log(
      `[volc-voice-callback] footprint pending user text task=${taskId} round=${roundId}`,
    )
    return
  }
  if (!assistantMessage) {
    console.log(
      `[volc-voice-callback] footprint pending assistant text task=${taskId} round=${roundId}`,
    )
    return
  }

  const loc = await getSessionLoc({ taskId, roomId: opts.roomId })
  const lugeUserId = loc?.luge_user_id
  if (!lugeUserId) {
    console.warn(
      `[volc-voice-callback] footprint skip: no luge user task=${taskId}`,
    )
    return
  }
  if (!loc) return

  const supabase = adminClient()
  const candidates = await fetchNearbyFootprints(
    supabase,
    lugeUserId,
    loc.lat,
    loc.lng,
  )
  const geoContext = await buildGeoContext(loc)
  const proactiveContext = await resolveProactiveContext(loc)
  if (proactiveContext) {
    console.log(
      `[volc-voice-callback] footprint topic=${proactiveContext.poi_name} round=${roundId}`,
    )
  }
  const classified = await classifyFootprint(
    userMessage,
    geoContext,
    candidates,
    undefined,
    proactiveContext,
  )
  if (classified.decision.action === 'skip') {
    console.log(
      `[volc-voice-callback] footprint skip decision=${classified.decision.reason ?? 'skip'}`,
    )
    await markFootprintDone(taskId, roundId)
    return
  }

  const meta = await applyFootprintDecision(
    supabase,
    lugeUserId,
    classified.decision,
    {
      userMessage,
      assistantMessage,
      userLat: loc.lat,
      userLng: loc.lng,
      heading: locHeading(loc),
    },
  )
  if (meta.write_error) {
    console.warn('[volc-voice-callback] footprint write:', meta.write_error)
    return
  }

  await markFootprintDone(taskId, roundId)
  console.log(
    `[volc-voice-callback] footprint written id=${meta.footprint_id?.slice(0, 8) ?? 'none'} visit=${meta.visit_id?.slice(0, 8) ?? 'none'} action=${classified.decision.action}`,
  )
  if (meta.visit_id) {
    void summarizeVisitAndFootprint(supabase, meta.visit_id).catch((e) =>
      console.warn('[volc-voice-callback] footprint summarize:', e),
    )
  }
}

/** @deprecated 使用 tryCompleteVoiceFootprint */
export async function maybeWriteVoiceFootprint(opts: {
  loc: SessionLoc
  taskId: string
  roundId: string
  assistantMessage: string
}) {
  await tryCompleteVoiceFootprint({
    taskId: opts.taskId,
    roundId: opts.roundId,
    assistantHint: opts.assistantMessage,
  })
}

function locHeading(loc: SessionLoc): number | null {
  return loc.heading != null && Number.isFinite(loc.heading) ? loc.heading : null
}

/** 同一 task 下所有「问+答齐全但未写足迹」的轮次（answerFinish round 与字幕 round 可能不一致） */
export async function sweepPendingFootprintsForTask(taskId: string) {
  const id = taskId.trim()
  if (!id) return
  const { data, error } = await adminClient()
    .from('voice_chat_round_dialog')
    .select('round_id')
    .eq('task_id', id)
    .is('footprint_done_at', null)
    .not('user_text', 'is', null)
    .not('assistant_text', 'is', null)

  if (error) {
    console.warn('[volc-voice-callback] sweep query:', error.message)
    return
  }
  for (const row of data ?? []) {
    const roundId = String(row.round_id)
    await tryCompleteVoiceFootprint({ taskId: id, roundId })
  }
}
