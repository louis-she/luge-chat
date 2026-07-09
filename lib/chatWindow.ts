/** 路鸽单次运行期间的近期对话（滑动窗口，供多轮追问上下文） */

export type ChatTurnMessage = {
  role: 'user' | 'assistant'
  content: string
}

export const CHAT_WINDOW_MAX_MESSAGES = 20
const MAX_CONTENT_LEN = 2000

export function trimChatMessages(messages: ChatTurnMessage[]): ChatTurnMessage[] {
  return messages
    .slice(-CHAT_WINDOW_MAX_MESSAGES)
    .map((m) => ({
      role: (m.role === 'assistant' ? 'assistant' : 'user') as ChatTurnMessage['role'],
      content: m.content.trim().slice(0, MAX_CONTENT_LEN),
    }))
    .filter((m) => m.content.length > 0)
}

export function createChatWindow() {
  let messages: ChatTurnMessage[] = []

  return {
    clear() {
      messages = []
    },
    snapshot(): ChatTurnMessage[] {
      return trimChatMessages(messages)
    },
    appendRound(user: string, assistant: string) {
      push({ role: 'user', content: user })
      push({ role: 'assistant', content: assistant })
    },
    appendProactive(assistantText: string) {
      push({ role: 'user', content: '（路鸽主动讲解）' })
      push({ role: 'assistant', content: assistantText })
    },
  }

  function push(m: ChatTurnMessage) {
    const trimmed = {
      role: m.role,
      content: m.content.trim().slice(0, MAX_CONTENT_LEN),
    } as ChatTurnMessage
    if (!trimmed.content) return
    messages.push(trimmed)
    if (messages.length > CHAT_WINDOW_MAX_MESSAGES) {
      messages = messages.slice(-CHAT_WINDOW_MAX_MESSAGES)
    }
  }
}
