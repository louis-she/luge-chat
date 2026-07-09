export const BUBBLE_FADE_MS = 320

/** 气泡停留时长：按字数估算阅读时间 */
export function bubbleVisibleMs(text: string) {
  return Math.min(9000, Math.max(3200, text.length * 85))
}
