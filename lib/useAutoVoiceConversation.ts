import { useEffect } from 'react'

type VoiceApi = {
  isListening: boolean
  startListening: () => Promise<boolean>
}

/** 真机：路鸽空闲时自动开麦，无需点图标 */
export function useAutoVoiceConversation(opts: {
  enabled: boolean
  ready: boolean
  busy: boolean
  blocked: boolean
  isListening: boolean
  startListening: () => Promise<boolean>
}) {
  const { enabled, ready, busy, blocked, isListening, startListening } = opts

  useEffect(() => {
    if (!enabled || !ready || busy || blocked || isListening) return

    const t = setTimeout(() => {
      if (busy) return
      void startListening()
    }, 800)

    return () => clearTimeout(t)
  }, [enabled, ready, busy, blocked, isListening, startListening])
}
