/**
 * RTC 软旁路：意图预检 + ASR 口误纠错（非闸门，结果只回传给火山 LLM）。
 */

const DEEPSEEK_API_KEY = Deno.env.get('DEEPSEEK_API_KEY')
const DEEPSEEK_BASE_URL = Deno.env.get('DEEPSEEK_BASE_URL') ?? 'https://api.deepseek.com'
const DEEPSEEK_MODEL = Deno.env.get('DEEPSEEK_MODEL') ?? 'deepseek-v4-flash'
const DEEPSEEK_JUDGE_MODEL = Deno.env.get('DEEPSEEK_JUDGE_MODEL') ?? DEEPSEEK_MODEL

const FILLER_PHRASES = new Set([
  '嗯',
  '嗯嗯',
  '啊',
  '啊啊',
  '哦',
  '哦哦',
  '呃',
  '呃呃',
  '欸',
  '诶',
  '唉',
  '哎',
  '哈',
  '哈哈',
  '嘿',
  '喂',
  '好的',
  '好吧',
  '行',
  '行吧',
  '可以',
  '收到',
  '没事',
  '然后',
  '那个',
])

export type NormalizeUtteranceResult = {
  ok: true
  action: 'answer' | 'ignore'
  original: string
  corrected_text: string
  focus_poi: string | null
  reason: string
  local_filler?: boolean
  reply_hint: string
}

function normalizeVoiceText(text: string) {
  return text
    .trim()
    .replace(/[，。！？、,.!?~～…\s]/g, '')
}

function isLocalFiller(text: string): boolean {
  const n = normalizeVoiceText(text)
  if (!n) return true
  if (FILLER_PHRASES.has(n)) return true
  if (n.length <= 1) return true
  return false
}

function ignorePayload(original: string, reason: string, local = false): NormalizeUtteranceResult {
  return {
    ok: true,
    action: 'ignore',
    original,
    corrected_text: original,
    focus_poi: null,
    reason,
    local_filler: local || undefined,
    reply_hint:
      '这是语气词/误触发，不需要回答用户问题。请保持沉默或最多用极短语气（如「嗯」）带过，不要展开介绍景点，不要反问「想了解什么」。',
  }
}

const SYSTEM_PROMPT = `你是路鸽语音导游的「听写纠错与意图预检」器。火山 ASR 常把地名听错，也会把车内噪音收成「嗯」。

输出 JSON：
{"action":"answer"|"ignore","corrected_text":"...","focus_poi":"...|null","reason":"..."}

规则：
1. ignore：纯语气词/附和/无意图短碎句（嗯/啊/哦/好的/行/收到）、明显旁人闲聊片段、与导游无关的噪音识别。不确定时也优先 ignore。
2. answer：明确问路、追问、指代刚讲过的景点、打招呼唤醒等。
3. corrected_text：在保留用户原意的前提下，把听错的专名改成上下文里最可能的正确地名（如话题锚定「卡子拉山」，用户说「嘎子拉山垭口海拔」→ corrected_text 用「卡子拉山垭口海拔多少」这类自然问句）。不要擅自加用户没问的内容。
4. focus_poi：若能确定在问哪个景点专名，填正确专名；泛问周边可 null。
5. 指代：「它/那里/刚才那个」优先对齐话题锚定或最近 assistant 讲过的景点。
6. 只输出 JSON，不要 markdown。
7. 字段值里不要用英文双引号；专名用中文即可。reason 控制在 20 字内。`

function extractJsonObject(raw: string): string | null {
  let s = raw.trim()
  if (!s) return null
  // ```json ... ```
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence?.[1]) s = fence[1].trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  s = s.slice(start, end + 1)
  // 常见脏字符：中文引号、尾逗号
  s = s
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, '$1')
  return s
}

function parseJudgeJson(raw: string): {
  action?: string
  corrected_text?: string
  focus_poi?: string | null
  reason?: string
} | null {
  const blob = extractJsonObject(raw)
  if (!blob) return null
  try {
    return JSON.parse(blob) as {
      action?: string
      corrected_text?: string
      focus_poi?: string | null
      reason?: string
    }
  } catch {
    // 截断/未转义时：用宽松字段抽取兜底
    const action = blob.match(/"action"\s*:\s*"(answer|ignore)"/)?.[1]
    const corrected =
      blob.match(/"corrected_text"\s*:\s*"((?:\\.|[^"\\])*)"/)?.[1] ??
      blob.match(/"corrected_text"\s*:\s*"([^"]*)/)?.[1]
    const focus =
      blob.match(/"focus_poi"\s*:\s*null/) != null
        ? null
        : blob.match(/"focus_poi"\s*:\s*"((?:\\.|[^"\\])*)"/)?.[1] ??
          blob.match(/"focus_poi"\s*:\s*"([^"]*)/)?.[1]
    const reason =
      blob.match(/"reason"\s*:\s*"((?:\\.|[^"\\])*)"/)?.[1] ??
      blob.match(/"reason"\s*:\s*"([^"]*)/)?.[1]
    if (!action && !corrected) return null
    return {
      action: action ?? 'answer',
      corrected_text: corrected?.replace(/\\"/g, '"'),
      focus_poi: focus === undefined ? null : focus?.replace(/\\"/g, '"') ?? null,
      reason: reason?.replace(/\\"/g, '"'),
    }
  }
}

export async function normalizeUserUtterance(opts: {
  utterance: string
  topicPoi?: string | null
  recentDialog?: Array<{ role: 'user' | 'assistant'; text: string }>
}): Promise<NormalizeUtteranceResult> {
  const original = opts.utterance.trim()
  if (!original) return ignorePayload('', 'empty', true)
  if (isLocalFiller(original)) {
    return ignorePayload(original, 'local filler', true)
  }

  if (!DEEPSEEK_API_KEY) {
    return {
      ok: true,
      action: 'answer',
      original,
      corrected_text: original,
      focus_poi: opts.topicPoi?.trim() || null,
      reason: 'no deepseek key; pass-through',
      reply_hint: answerHint(original, opts.topicPoi?.trim() || null),
    }
  }

  const recent = (opts.recentDialog ?? [])
    .filter((d) => d.text.trim())
    .slice(-8)
    .map((d) => `${d.role}: ${d.text.trim().slice(0, 180)}`)
    .join('\n')

  const userContent = [
    opts.topicPoi?.trim() ? `话题锚定：${opts.topicPoi.trim()}` : '话题锚定：（无）',
    '',
    '近期对话：',
    recent || '（无）',
    '',
    `本轮 ASR：${original}`,
    '',
    '请判定 action，并给出 corrected_text / focus_poi。',
  ].join('\n')

  try {
    const res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: DEEPSEEK_JUDGE_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        temperature: 0.1,
        max_tokens: 280,
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' },
      }),
    })
    const data = await res.json().catch(() => ({}))
    const content = data?.choices?.[0]?.message?.content
    if (!res.ok || typeof content !== 'string') {
      console.warn('[normalizeUtterance] deepseek failed:', data)
      return passThrough(original, opts.topicPoi, 'judge failed fallback')
    }
    const parsed = parseJudgeJson(content)
    if (!parsed) {
      console.warn(
        '[normalizeUtterance] bad json preview=',
        content.replace(/\s+/g, ' ').slice(0, 220),
      )
      return passThrough(original, opts.topicPoi, 'judge parse fallback')
    }
    const action = parsed.action === 'ignore' ? 'ignore' : 'answer'
    const corrected =
      typeof parsed.corrected_text === 'string' && parsed.corrected_text.trim()
        ? parsed.corrected_text.trim()
        : original
    const focus =
      typeof parsed.focus_poi === 'string' && parsed.focus_poi.trim()
        ? parsed.focus_poi.trim()
        : null
    const reason =
      typeof parsed.reason === 'string' ? parsed.reason : ''

    if (action === 'ignore') {
      return ignorePayload(original, reason || 'model ignore')
    }
    return {
      ok: true,
      action: 'answer',
      original,
      corrected_text: corrected,
      focus_poi: focus,
      reason,
      reply_hint: answerHint(corrected, focus, original),
    }
  } catch (e) {
    console.warn('[normalizeUtterance] error:', e)
    return passThrough(original, opts.topicPoi, 'judge exception fallback')
  }
}

function passThrough(
  original: string,
  topicPoi: string | null | undefined,
  reason: string,
): NormalizeUtteranceResult {
  const focus = topicPoi?.trim() || null
  return {
    ok: true,
    action: 'answer',
    original,
    corrected_text: original,
    focus_poi: focus,
    reason,
    reply_hint: answerHint(original, focus),
  }
}

function answerHint(
  corrected: string,
  focusPoi: string | null,
  original?: string,
): string {
  const parts = [
    `请按用户真实意图回答。规范化后的用户话：「${corrected}」。`,
  ]
  if (original && original !== corrected) {
    parts.push(
      `ASR 原文是「${original}」，已纠错；回答时使用纠正后的专名，不要说没查到原文那个错名，也不要提识别有误。`,
    )
  }
  if (focusPoi) {
    parts.push(
      `当前焦点景点：${focusPoi}。若需查周边/海拔等事实，再调用 get_nearby_landmarks，focus 用「${focusPoi}」或纠正后的专名。`,
    )
  } else {
    parts.push(
      '若问题涉及附近地标/山水桥镇，先调用 get_nearby_landmarks 再答。',
    )
  }
  return parts.join('')
}
