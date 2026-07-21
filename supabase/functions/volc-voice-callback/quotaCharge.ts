import {
  consumeOneAsk,
  QuotaExhaustedError,
  type QuotaStatus,
} from '../luge-chat/quota.ts'
import {
  adminClient,
  getSessionLoc,
  type SessionLoc,
} from '../volc-voice-chat/sessionLoc.ts'

export async function chargeAnswerFinish(opts: {
  taskId: string
  roundId: string
  roomId?: string
}): Promise<{ charged: boolean; quota?: QuotaStatus; reason?: string }> {
  const taskId = opts.taskId.trim()
  const roundId = opts.roundId.trim()
  if (!taskId || roundId === '') {
    return { charged: false, reason: 'missing task or round' }
  }

  const loc: SessionLoc | null = await getSessionLoc({
    taskId,
    roomId: opts.roomId,
  })
  const lugeUserId = loc?.luge_user_id ?? null
  const deviceKey = loc?.device_key ?? null

  if (!lugeUserId && !deviceKey) {
    console.warn(
      `[volc-voice-callback] answerFinish charge skip: no quota identity task=${taskId} room=${opts.roomId ?? ''}`,
    )
    return { charged: false, reason: 'no quota identity on session' }
  }

  const db = adminClient()
  const { error: insErr } = await db.from('voice_chat_round_charges').insert({
    task_id: taskId,
    round_id: roundId,
    room_id: opts.roomId?.trim() || null,
  })

  if (insErr) {
    if (/duplicate|unique/i.test(insErr.message)) {
      return { charged: false, reason: 'duplicate round' }
    }
    console.warn('[volc-voice-callback] round charge insert:', insErr.message)
    return { charged: false, reason: 'insert failed' }
  }

  try {
    const quota = await consumeOneAsk(db, {
      userId: lugeUserId,
      deviceKey,
    })
    await db
      .from('voice_chat_round_charges')
      .update({ tier: quota.tier })
      .eq('task_id', taskId)
      .eq('round_id', roundId)

    console.log(
      `[volc-voice-callback] answerFinish charged task=${taskId} round=${roundId} tier=${quota.tier} remaining=${quota.remaining}`,
    )
    return { charged: true, quota }
  } catch (e) {
    if (e instanceof QuotaExhaustedError) {
      console.warn(
        `[volc-voice-callback] answerFinish quota exhausted task=${taskId} round=${roundId} tier=${e.tier}`,
      )
      await db
        .from('voice_chat_round_charges')
        .update({ tier: e.tier })
        .eq('task_id', taskId)
        .eq('round_id', roundId)
      return { charged: false, reason: 'quota exhausted' }
    }
    console.error('[volc-voice-callback] answerFinish consume failed:', e)
    return { charged: false, reason: 'consume error' }
  }
}
