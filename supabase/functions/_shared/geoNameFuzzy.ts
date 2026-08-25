/**
 * 中文地名近音/近形匹配：ASR 常把地名听错一两个字（卡子拉山 → 嘎子拉山）。
 *
 * 不引拼音表，靠两条硬约束控误伤：
 * 1. 类别尾字必须相同 —— 折多山 ≠ 折多河
 * 2. 专名核心 ≥3 字且编辑距离 ≤1 —— 短名（稻城/道城）不做纠错
 */

/** 地理类别尾字：类别不同一律不算同一个地方 */
const CLASS_TAIL = new Set([
  '山', '峰', '岭', '岗', '坡', '垭',
  '河', '江', '湖', '海', '溪', '沟', '泉', '瀑', '潭', '库', '坝',
  '桥', '隧', '洞', '道',
  '镇', '乡', '村', '寨', '城', '县', '市', '州',
  '关', '口', '岛', '湾', '塔', '寺', '庙', '宫', '观', '园', '站', '场',
])

/** 「垭口 / 景区 / 观景台」等修饰后缀：同一个地方的不同说法，不参与专名比对 */
const MODIFIER_SUFFIX = [
  '风景名胜区',
  '国家森林公园',
  '自然保护区',
  '国家地质公园',
  '风景区',
  '景区',
  '景点',
  '观景平台',
  '观景台',
  '服务区',
  '收费站',
  '停车场',
  '游客中心',
  '垭口',
]

/** 去标点、剥修饰后缀，留下可比对的名字 */
export function normalizeGeoName(raw: string): string {
  let s = (raw ?? '').trim().replace(/[\s·・.,，。、“”"'()（）]/g, '')
  for (;;) {
    const hit = MODIFIER_SUFFIX.find(
      (suf) => s.length > suf.length && s.endsWith(suf),
    )
    if (!hit) break
    s = s.slice(0, s.length - hit.length)
  }
  return s
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    prev = cur
  }
  return prev[b.length]
}

function splitCore(s: string): { core: string; tail: string } {
  if (s.length >= 2 && CLASS_TAIL.has(s[s.length - 1])) {
    return { core: s.slice(0, -1), tail: s[s.length - 1] }
  }
  return { core: s, tail: '' }
}

/** asked = 用户所说（可能被听错），candidate = 地图/缓存里的名字 */
export function isLikelySameGeoName(asked: string, candidate: string): boolean {
  const a = normalizeGeoName(asked)
  const b = normalizeGeoName(candidate)
  if (a.length < 2 || b.length < 2) return false
  if (a === b) return true
  if (a.length >= 3 && b.includes(a)) return true
  if (b.length >= 3 && a.includes(b)) return true

  const sa = splitCore(a)
  const sb = splitCore(b)
  if (sa.tail && sb.tail && sa.tail !== sb.tail) return false
  if (sa.core.length < 3 || sb.core.length < 3) return false
  if (Math.abs(sa.core.length - sb.core.length) > 1) return false
  return levenshtein(sa.core, sb.core) <= 1
}
