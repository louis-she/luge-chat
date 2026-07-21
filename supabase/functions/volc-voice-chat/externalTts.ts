import { callRtcOpenApi } from './openApi.ts'
import { VOICE_CHAT_API_VERSION } from './voiceChatConfig.ts'

/** 火山 ExternalTextToSpeech 单条 Message 上限约 200 字 */
export function chunkSpeechText(text: string, maxLen = 200): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  if (trimmed.length <= maxLen) return [trimmed]

  const chunks: string[] = []
  let rest = trimmed
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf('。', maxLen)
    if (cut < maxLen * 0.35) cut = rest.lastIndexOf('，', maxLen)
    if (cut < maxLen * 0.35) cut = rest.lastIndexOf(' ', maxLen)
    if (cut < 8) cut = maxLen
    chunks.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) chunks.push(rest)
  return chunks
}

export async function sendExternalTextToSpeech(opts: {
  appId: string
  roomId: string
  taskId: string
  text: string
  /** 1 打断立即播；2 等当前轮结束；3 忙则丢弃 */
  interruptMode?: number
}): Promise<void> {
  const accessKeyId = Deno.env.get('VOLC_OPENAPI_ACCESS_KEY_ID')?.trim()
  const secretKey = Deno.env.get('VOLC_OPENAPI_SECRET_KEY')?.trim()
  if (!accessKeyId || !secretKey) {
    throw new Error('VOLC_OPENAPI_* not configured')
  }

  const interruptMode = opts.interruptMode ?? 2
  const parts = chunkSpeechText(opts.text)
  if (parts.length === 0) return

  for (let i = 0; i < parts.length; i++) {
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
        Command: 'ExternalTextToSpeech',
        Message: parts[i],
        InterruptMode: interruptMode,
      },
    })
    const err = result.data?.ResponseMetadata?.Error
    if (!result.ok || err) {
      throw new Error(err?.Message ?? `ExternalTextToSpeech failed HTTP ${result.status}`)
    }
  }
  console.log(
    `[volc-voice-chat] ExternalTTS ok task=${opts.taskId} parts=${parts.length} chars=${opts.text.length}`,
  )
}
