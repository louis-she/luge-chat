import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

const DB_SCHEMA =
  Deno.env.get('AUTH_DB_SCHEMA') ?? Deno.env.get('SANDBOX_DB_SCHEMA') ?? 'dev'

export type SessionLoc = {
  room_id: string
  task_id: string
  user_id: string | null
  luge_user_id: string | null
  device_key: string | null
  lat: number
  lng: number
  heading: number | null
  geo_radius_prefs?: Record<string, number> | null
  topic_poi?: string | null
  updated_at?: string
}

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

export async function upsertSessionLoc(input: {
  roomId: string
  taskId?: string
  userId?: string
  lugeUserId?: string | null
  deviceKey?: string | null
  lat: number
  lng: number
  heading?: number | null
  geoRadiusPrefs?: Record<string, number> | null
}): Promise<void> {
  const row: Record<string, unknown> = {
    room_id: input.roomId,
    task_id: input.taskId?.trim() || '',
    user_id: input.userId?.trim() || null,
    luge_user_id: input.lugeUserId?.trim() || null,
    device_key: input.deviceKey?.trim() || null,
    lat: input.lat,
    lng: input.lng,
    heading:
      input.heading != null && Number.isFinite(input.heading)
        ? input.heading
        : null,
    updated_at: new Date().toISOString(),
  }
  if (input.geoRadiusPrefs && typeof input.geoRadiusPrefs === 'object') {
    row.geo_radius_prefs = input.geoRadiusPrefs
  }
  const existing = await getSessionLoc({ roomId: input.roomId })
  if (existing) {
    if (row.luge_user_id == null) row.luge_user_id = existing.luge_user_id
    if (row.device_key == null) row.device_key = existing.device_key
    if (row.geo_radius_prefs == null && existing.geo_radius_prefs) {
      row.geo_radius_prefs = existing.geo_radius_prefs
    }
  }
  const { error } = await adminClient()
    .from('voice_chat_session_loc')
    .upsert(row, { onConflict: 'room_id' })
  if (error) throw new Error(`upsert session loc: ${error.message}`)
}

export async function getSessionLoc(opts: {
  roomId?: string
  taskId?: string
}): Promise<SessionLoc | null> {
  const db = adminClient()
  if (opts.roomId) {
    const { data, error } = await db
      .from('voice_chat_session_loc')
      .select(
        'room_id,task_id,user_id,luge_user_id,device_key,lat,lng,heading,geo_radius_prefs,topic_poi,updated_at',
      )
      .eq('room_id', opts.roomId)
      .maybeSingle()
    if (error) {
      console.warn('[sessionLoc] get by room failed:', error.message)
      return null
    }
    if (data) return data as SessionLoc
  }
  if (opts.taskId) {
    const { data, error } = await db
      .from('voice_chat_session_loc')
      .select(
        'room_id,task_id,user_id,luge_user_id,device_key,lat,lng,heading,geo_radius_prefs,topic_poi,updated_at',
      )
      .eq('task_id', opts.taskId)
      .order('updated_at', { ascending: false })
      .limit(1)
    if (error) {
      console.warn('[sessionLoc] get by task failed:', error.message)
      return null
    }
    const row = Array.isArray(data) ? data[0] : data
    if (row) return row as SessionLoc
  }
  return null
}

/** 字幕里的 Volc RTC user_id → 当前会话 task */
export async function getSessionByRtcUserId(
  rtcUserId: string,
): Promise<SessionLoc | null> {
  const id = rtcUserId.trim()
  if (!id) return null
  const { data, error } = await adminClient()
    .from('voice_chat_session_loc')
    .select(
      'room_id,task_id,user_id,luge_user_id,device_key,lat,lng,heading,geo_radius_prefs,topic_poi,updated_at',
    )
    .eq('user_id', id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    console.warn('[sessionLoc] get by rtc user failed:', error.message)
    return null
  }
  return (data as SessionLoc) ?? null
}

/** StartVoiceChat 时记下 room↔task，位置可稍后补 */
export async function touchSessionTask(opts: {
  roomId: string
  taskId: string
  userId?: string
  lugeUserId?: string | null
  deviceKey?: string | null
}): Promise<void> {
  const existing = await getSessionLoc({ roomId: opts.roomId })
  if (existing) {
    const { error } = await adminClient()
      .from('voice_chat_session_loc')
      .update({
        task_id: opts.taskId,
        user_id: opts.userId?.trim() || existing.user_id,
        luge_user_id: opts.lugeUserId?.trim() || existing.luge_user_id,
        device_key: opts.deviceKey?.trim() || existing.device_key,
        updated_at: new Date().toISOString(),
      })
      .eq('room_id', opts.roomId)
    if (error) console.warn('[sessionLoc] touch task failed:', error.message)
    return
  }
  // 尚无 GPS：用占位坐标，等客户端 location 上报覆盖
  try {
    await upsertSessionLoc({
      roomId: opts.roomId,
      taskId: opts.taskId,
      userId: opts.userId,
      lugeUserId: opts.lugeUserId,
      deviceKey: opts.deviceKey,
      lat: 0,
      lng: 0,
      heading: null,
    })
  } catch (e) {
    console.warn('[sessionLoc] touch insert failed:', e)
  }
}

/** 主动讲解锚定的 POI（写入 session 行，供 callback isolate 读取） */
export async function rememberTopicPoi(
  opts: { roomId?: string; taskId?: string },
  poiName: string,
): Promise<void> {
  const poi = poiName.trim().slice(0, 40)
  if (!poi) return
  const db = adminClient()
  const patch = { topic_poi: poi, updated_at: new Date().toISOString() }
  if (opts.roomId?.trim()) {
    const { error } = await db
      .from('voice_chat_session_loc')
      .update(patch)
      .eq('room_id', opts.roomId.trim())
    if (error) console.warn('[sessionLoc] remember topic by room:', error.message)
    return
  }
  if (opts.taskId?.trim()) {
    const { error } = await db
      .from('voice_chat_session_loc')
      .update(patch)
      .eq('task_id', opts.taskId.trim())
    if (error) console.warn('[sessionLoc] remember topic by task:', error.message)
  }
}

export function peekTopicPoi(session: SessionLoc | null | undefined): string | null {
  const poi = session?.topic_poi?.trim()
  return poi || null
}
