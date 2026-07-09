export type LlmMessage = { role: string; content: string }

export type PromptLogger = (label: string, messages: LlmMessage[]) => void

const SEP = '─'.repeat(48)

/** 调试模式下打印完整 LLM prompt（服务端日志 + 可选 NDJSON 推送到客户端） */
export function createPromptLogger(
  enabled: boolean,
  onPrompt?: (evt: { label: string; role: string; content: string }) => void,
): PromptLogger {
  return (label, messages) => {
    if (!enabled) return
    for (const m of messages) {
      console.log(`[luge prompt] ${label} :: ${m.role}\n${SEP}\n${m.content}\n${SEP}`)
      onPrompt?.({ label, role: m.role, content: m.content })
    }
  }
}

export const noopPromptLogger: PromptLogger = () => {}
