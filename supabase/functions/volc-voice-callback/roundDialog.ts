import { adminClient } from '../volc-voice-chat/sessionLoc.ts'

export type RoundDialog = {
  task_id: string
  round_id: string
  user_text: string | null
  assistant_text: string | null
  footprint_done_at: string | null
}

export async function mergeRoundDialog(opts: {
  taskId: string
  roundId: string
  userText?: string | null
  assistantText?: string | null
  appendAssistant?: boolean
}): Promise<RoundDialog | null> {
  const taskId = opts.taskId.trim()
  const roundId = opts.roundId.trim()
  if (!taskId || roundId === '') return null

  const db = adminClient()
  const { data: existing } = await db
    .from('voice_chat_round_dialog')
    .select('task_id,round_id,user_text,assistant_text,footprint_done_at')
    .eq('task_id', taskId)
    .eq('round_id', roundId)
    .maybeSingle()

  let userText = existing?.user_text ?? null
  let assistantText = existing?.assistant_text ?? null

  const incomingUser = opts.userText?.trim()
  if (incomingUser) {
    if (!userText || incomingUser.length >= userText.length) {
      userText = incomingUser
    }
  }

  const incomingAsst = opts.assistantText?.trim()
  if (incomingAsst) {
    if (opts.appendAssistant && assistantText) {
      assistantText = `${assistantText}${incomingAsst}`
    } else if (!assistantText || incomingAsst.length >= assistantText.length) {
      assistantText = incomingAsst
    }
  }

  const row = {
    task_id: taskId,
    round_id: roundId,
    user_text: userText,
    assistant_text: assistantText,
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await db
    .from('voice_chat_round_dialog')
    .upsert(row, { onConflict: 'task_id,round_id' })
    .select('task_id,round_id,user_text,assistant_text,footprint_done_at')
    .single()

  if (error) {
    console.warn('[roundDialog] upsert failed:', error.message)
    return null
  }
  return data as RoundDialog
}

export async function markFootprintDone(taskId: string, roundId: string) {
  await adminClient()
    .from('voice_chat_round_dialog')
    .update({
      footprint_done_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('task_id', taskId)
    .eq('round_id', roundId)
}

export async function getRoundDialog(
  taskId: string,
  roundId: string,
): Promise<RoundDialog | null> {
  const { data } = await adminClient()
    .from('voice_chat_round_dialog')
    .select('task_id,round_id,user_text,assistant_text,footprint_done_at')
    .eq('task_id', taskId)
    .eq('round_id', roundId)
    .maybeSingle()
  return (data as RoundDialog) ?? null
}
