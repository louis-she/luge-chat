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

export function buildTopicAnchorPrompt(poiName: string): string {
  const name = poiName.trim().slice(0, 40)
  return (
    `【话题锚定】刚才主动讲解的是「${name}」。` +
    `用户若说「它」「那里」「刚才那个」「这个地方」「什么时候建的」等，一律优先指「${name}」；` +
    `不要扯到更早的足迹或其他景点，除非用户明确换了话题。` +
    `后续回答不要行动号召，也不要默认用户正在开车。`
  )
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

/**
 * 自定义指令：与下一轮用户问题一并送入 LLM（不单独播报）。
 * 用于主动讲解后钉死「当前 POI」，避免追问扯到更早话题。
 * @see https://www.volcengine.com/docs/6348/2386107
 */
export async function sendExternalPromptsForLlm(opts: {
  appId: string
  roomId: string
  taskId: string
  prompt: string
}): Promise<void> {
  const accessKeyId = Deno.env.get('VOLC_OPENAPI_ACCESS_KEY_ID')?.trim()
  const secretKey = Deno.env.get('VOLC_OPENAPI_SECRET_KEY')?.trim()
  if (!accessKeyId || !secretKey) {
    throw new Error('VOLC_OPENAPI_* not configured')
  }

  const message = opts.prompt.trim().slice(0, 200)
  if (!message) return

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
      Command: 'ExternalPromptsForLLM',
      Message: message,
    },
  })
  const err = result.data?.ResponseMetadata?.Error
  if (!result.ok || err) {
    throw new Error(
      err?.Message ?? `ExternalPromptsForLLM failed HTTP ${result.status}`,
    )
  }
  console.log(
    `[volc-voice-chat] ExternalPromptsForLLM ok task=${opts.taskId} chars=${message.length}`,
  )
}
