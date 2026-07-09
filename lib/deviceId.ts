import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

const DEVICE_KEY = 'lugechat.device_id'

function randomId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/** 游客设备标识，持久化在 SecureStore / localStorage */
export async function getDeviceId(): Promise<string> {
  if (Platform.OS === 'web') {
    const key = 'lugechat_device_id'
    const existing = globalThis.localStorage?.getItem(key)
    if (existing) return existing
    const id = randomId()
    globalThis.localStorage?.setItem(key, id)
    return id
  }

  const existing = await SecureStore.getItemAsync(DEVICE_KEY)
  if (existing) return existing
  const id = randomId()
  await SecureStore.setItemAsync(DEVICE_KEY, id)
  return id
}
