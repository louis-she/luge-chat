const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-luge-device-id',
}

const TTS_URL = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional'

/** 与客户端 lib/ttsVoices.ts 保持一致 */
const ALLOWED_SPEAKERS = new Set([
  'zh_female_vv_uranus_bigtts',
  'zh_female_xiaohe_uranus_bigtts',
  'zh_male_liufei_uranus_bigtts',
  'zh_male_m191_uranus_bigtts',
])

const DEFAULT_RESOURCE_ID = 'seed-tts-2.0'
const DEFAULT_SPEAKER = 'zh_female_vv_uranus_bigtts'

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function parseNdjsonOrConcatJson(text: string): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = []
  const trimmed = text.trim()
  if (!trimmed) return events

  const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length > 1) {
    for (const line of lines) {
      try {
        events.push(JSON.parse(line))
      } catch {
        /* fall through to brace parser */
      }
    }
    if (events.length) return events
  }

  let depth = 0
  let start = -1
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (ch === '{') {
      if (depth === 0) start = i
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0 && start >= 0) {
        try {
          events.push(JSON.parse(trimmed.slice(start, i + 1)))
        } catch {
          /* skip malformed chunk */
        }
        start = -1
      }
    }
  }
  return events
}

async function volcanoTts(text: string, speakerId: string): Promise<Uint8Array> {
  const apiKey = Deno.env.get('VOLCANO_TTS_API_KEY')
  if (!apiKey) throw new Error('VOLCANO_TTS_API_KEY is not configured')

  // 本服务仅支持 2.0 音色；忽略容器中可能残留的旧 1.0 环境变量
  const resourceId = DEFAULT_RESOURCE_ID
  const speaker = ALLOWED_SPEAKERS.has(speakerId) ? speakerId : DEFAULT_SPEAKER

  const res = await fetch(TTS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
      'X-Api-Resource-Id': resourceId,
    },
    body: JSON.stringify({
      user: { uid: 'lugechat' },
      req_params: {
        text: text.slice(0, 1024),
        speaker,
        audio_params: {
          format: 'mp3',
          sample_rate: 24000,
          speech_rate: 0,
        },
      },
    }),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`volcano tts http ${res.status}: ${errText.slice(0, 200)}`)
  }

  const raw = await res.text()
  const events = parseNdjsonOrConcatJson(raw)
  const audioChunks: Uint8Array[] = []
  let lastError = ''

  for (const evt of events) {
    const code = Number(evt.code)
    if (code === 0 && typeof evt.data === 'string' && evt.data) {
      audioChunks.push(decodeBase64(evt.data))
      continue
    }
    if (code === 20000000) break
    if (code && code !== 0) {
      lastError = String(evt.message ?? evt.code)
    }
  }

  if (!audioChunks.length) {
    console.warn('volcano tts raw preview:', raw.slice(0, 400))
    throw new Error(lastError || 'volcano tts returned no audio')
  }
  return concatBytes(audioChunks)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json({ error: 'method not allowed' }, 405)
  }

  try {
    const body = await req.json().catch(() => ({}))
    const text = typeof body?.text === 'string' ? body.text.trim() : ''
    if (!text) return json({ error: 'text is required' }, 400)

    const speaker =
      typeof body?.speaker === 'string' ? body.speaker.trim() : ''

    const t0 = Date.now()
    const audio = await volcanoTts(text, speaker)
    console.log(
      `[tts] speaker=${speaker || 'default'} ${text.length} chars → ${audio.length} bytes in ${Date.now() - t0}ms`,
    )

    return json({
      format: 'mp3',
      sample_rate: 24000,
      audio_base64: bytesToBase64(audio),
    })
  } catch (err) {
    console.error('tts error:', err)
    const msg = err instanceof Error ? err.message : 'tts failed'
    return json({ error: msg }, 500)
  }
})
