/**
 * 语音主路径：火山 RTC（真机「打电话」）。
 * HTTP `luge-chat` ask / 本地 ASR 已下线；主动讲解仍走 luge-chat mode=proactive。
 */
export function isRtcVoicePath(): boolean {
  return true
}
