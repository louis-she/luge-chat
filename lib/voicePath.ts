import { isDevSimulator } from './isDevSimulator'

/** 真机雷达页是否走火山 RTC（方案甲）；模拟器仍用 HTTP+本地 ASR */
export function isRtcVoicePath(): boolean {
  if (isDevSimulator()) return false
  const mode = process.env.EXPO_PUBLIC_LUGE_VOICE_PATH?.trim().toLowerCase()
  if (mode === 'legacy' || mode === 'http') return false
  return true
}
