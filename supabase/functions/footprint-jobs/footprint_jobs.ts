import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

const DEEPSEEK_API_KEY = Deno.env.get('DEEPSEEK_API_KEY')
const DEEPSEEK_BASE_URL = Deno.env.get('DEEPSEEK_BASE_URL') ?? 'https://api.deepseek.com'
const DEEPSEEK_MODEL = Deno.env.get('DEEPSEEK_MODEL') ?? 'deepseek-v4-flash'
const DB_SCHEMA = Deno.env.get('AUTH_DB_SCHEMA') ?? Deno.env.get('SANDBOX_DB_SCHEMA') ?? 'dev'

export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: DB_SCHEMA },
    },
  )
}

async function summarizeVisitAndFootprint(supabase: SupabaseClient, visitId: string) {
  const { data: visit, error: visitErr } = await supabase
    .from('footprint_visits')
    .select('id, footprint_id, started_at, visit_summary, llm_notes')
    .eq('id', visitId)
    .single()

  if (visitErr || !visit) return false

  const { data: footprint } = await supabase
    .from('user_footprints')
    .select('id, poi_name, poi_type, title, summary, llm_notes')
    .eq('id', visit.footprint_id)
    .single()

  if (!footprint) return false

  const { data: messages } = await supabase
    .from('footprint_messages')
    .select('role, content, created_at')
    .eq('footprint_visit_id', visitId)
    .order('created_at', { ascending: true })

  const dialog = (messages ?? [])
    .map((m) => `${m.role === 'user' ? '用户' : '路鸽'}：${m.content}`)
    .join('\n')

  if (!dialog.trim() || !DEEPSEEK_API_KEY) return false

  const SUMMARIZE_SYSTEM = `你是路鸽足迹归档助手。根据对话生成 JSON，不要 markdown 代码块。

字段：
- visit_summary：本次访问 80-150 字用户可见摘要
- visit_llm_notes：本次隐藏笔记，含时间线与用户兴趣点
- footprint_title：POI 卡片标题，10 字内。必须反映用户真正关心的地理对象，优先采用用户提问中的叫法（例：用户反复问「北湖」应写「成都北湖公园」，不要写楼盘名、小区名，也不要沿用首次回答的旁支主题）。若用户兴趣已偏离旧标题，应更新标题
- footprint_summary：跨访问 POI 总述 100-200 字
- footprint_llm_notes_append：追加到 POI 隐藏笔记的一段话，含本次访问时间`

  const summarizeUser = [
    `POI：${footprint.poi_name}（${footprint.poi_type}）`,
    `已有 POI 标题：${footprint.title || '无'}`,
    `本次访问开始：${visit.started_at}`,
    `已有 POI 总述：${footprint.summary || '无'}`,
    `已有 POI 隐藏笔记：${footprint.llm_notes || '无'}`,
    '',
    '## 本次对话',
    dialog,
  ].join('\n')

  const messages = [
    { role: 'system', content: SUMMARIZE_SYSTEM },
    { role: 'user', content: summarizeUser },
  ]
  const sep = '─'.repeat(48)
  for (const m of messages) {
    console.log(`[luge prompt] 足迹摘要(定时) :: ${m.role}\n${sep}\n${m.content}\n${sep}`)
  }

  const res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages,
      temperature: 0.4,
      max_tokens: 900,
      response_format: { type: 'json_object' },
    }),
  })

  const raw = await res.json().catch(() => ({}))
  const text = raw?.choices?.[0]?.message?.content
  if (!res.ok || typeof text !== 'string') return false

  let parsed: Record<string, string> = {}
  try {
    parsed = JSON.parse(text)
  } catch {
    return false
  }

  const visitSummary = parsed.visit_summary?.trim() ?? ''
  const visitNotes = parsed.visit_llm_notes?.trim() ?? ''
  const fpTitle = parsed.footprint_title?.trim() ?? footprint.title
  const fpSummary = parsed.footprint_summary?.trim() ?? footprint.summary
  const fpNotesAppend = parsed.footprint_llm_notes_append?.trim() ?? ''

  const mergedVisitNotes = [visit.llm_notes, visitNotes].filter(Boolean).join('\n\n')
  const mergedFpNotes = [footprint.llm_notes, fpNotesAppend].filter(Boolean).join('\n\n')

  await supabase
    .from('footprint_visits')
    .update({
      visit_summary: visitSummary || visit.visit_summary,
      llm_notes: mergedVisitNotes,
      needs_summary: false,
    })
    .eq('id', visitId)

  await supabase
    .from('user_footprints')
    .update({
      title: fpTitle || footprint.poi_name,
      summary: fpSummary,
      llm_notes: mergedFpNotes,
    })
    .eq('id', footprint.id)

  return true
}

async function archiveVisit(supabase: SupabaseClient, visitId: string) {
  await supabase
    .from('footprint_visits')
    .update({
      status: 'archived',
      archived_at: new Date().toISOString(),
      needs_summary: false,
    })
    .eq('id', visitId)
}

export async function runFootprintJobs(supabase: SupabaseClient) {
  const now = Date.now()
  const debounceBefore = new Date(now - 10 * 60 * 1000).toISOString()
  const archiveBefore = new Date(now - 24 * 60 * 60 * 1000).toISOString()

  const { data: toSummarize } = await supabase
    .from('footprint_visits')
    .select('id')
    .eq('status', 'active')
    .eq('needs_summary', true)
    .lt('last_active_at', debounceBefore)
    .limit(20)

  let summarized = 0
  for (const row of toSummarize ?? []) {
    if (await summarizeVisitAndFootprint(supabase, row.id)) summarized++
  }

  const { data: toArchive } = await supabase
    .from('footprint_visits')
    .select('id, needs_summary')
    .eq('status', 'active')
    .lt('last_active_at', archiveBefore)
    .limit(20)

  let archived = 0
  for (const row of toArchive ?? []) {
    if (row.needs_summary) {
      await summarizeVisitAndFootprint(supabase, row.id)
    }
    await archiveVisit(supabase, row.id)
    archived++
  }

  return { summarized, archived }
}
