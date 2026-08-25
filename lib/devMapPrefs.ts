import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

const STORAGE_KEY = 'lugechat.dev_map_auto_recenter'

/** 默认开：拖动/讲解后自动切回「当前位置」 */
let cache: boolean | undefined

async function readRaw(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null
  }
  return SecureStore.getItemAsync(STORAGE_KEY)
}

async function writeRaw(value: string) {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(STORAGE_KEY, value)
    return
  }
  await SecureStore.setItemAsync(STORAGE_KEY, value)
}

export async function loadMapAutoRecenter(): Promise<boolean> {
  if (cache !== undefined) return cache
  const raw = await readRaw()
  if (raw === '0' || raw === 'false') cache = false
  else cache = true
  return cache
}

export function peekMapAutoRecenter(): boolean {
  return cache !== undefined ? cache : true
}

export async function saveMapAutoRecenter(on: boolean): Promise<void> {
  cache = on
  await writeRaw(on ? '1' : '0')
}
