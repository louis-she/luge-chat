import * as SecureStore from 'expo-secure-store'

const STORAGE_KEY = 'luge_proactive_spoken_v1'

type DaySpoken = {
  day: string
  /** 规范化名称 / 高德 poi id */
  keys: string[]
}

function shanghaiDay(now = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(now))
}

/** 与后端去重键尽量一致：去掉空白与常见后缀噪音 */
export function proactiveSpokenKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/(旅游区|风景区|景区|公园|度假区)$/u, '')
}

let cache: DaySpoken | null | undefined

async function readStore(): Promise<DaySpoken | null> {
  if (cache !== undefined) return cache
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY)
    if (!raw) {
      cache = null
      return null
    }
    const parsed = JSON.parse(raw) as DaySpoken
    if (!parsed?.day || !Array.isArray(parsed.keys)) {
      cache = null
      return null
    }
    cache = { day: parsed.day, keys: parsed.keys.map(String) }
    return cache
  } catch {
    cache = null
    return null
  }
}

async function writeStore(next: DaySpoken) {
  cache = next
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(next))
}

/** 当天已主动讲过的 POI 键（上海时区日历日） */
export async function loadSpokenPoiKeysToday(): Promise<string[]> {
  const day = shanghaiDay()
  const stored = await readStore()
  if (!stored || stored.day !== day) return []
  return [...stored.keys]
}

export async function rememberProactiveSpoken(opts: {
  name: string
  amapPoiId?: string | null
}) {
  const day = shanghaiDay()
  const stored = await readStore()
  const prev = stored?.day === day ? stored.keys : []
  const add = new Set(prev)
  const nameKey = proactiveSpokenKey(opts.name)
  if (nameKey) add.add(nameKey)
  if (opts.amapPoiId?.trim()) add.add(`id:${opts.amapPoiId.trim()}`)
  await writeStore({ day, keys: [...add] })
}
