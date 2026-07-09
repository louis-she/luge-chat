import Constants from 'expo-constants'
import { Platform } from 'react-native'
import { WECHAT_APP_ID, WECHAT_UNIVERSAL_LINK } from './config'

/** Expo Go 不含微信原生 SDK，需 Development Build */
export function isWechatLoginSupported() {
  return Constants.appOwnership !== 'expo' && Platform.OS !== 'web'
}

export async function initWechatSdk() {
  if (!isWechatLoginSupported()) return

  const { registerApp } = await import('expo-native-wechat')
  await registerApp({
    appid: WECHAT_APP_ID,
    universalLink: WECHAT_UNIVERSAL_LINK,
  })
}

export async function requestWechatAuthCode(): Promise<string> {
  if (!isWechatLoginSupported()) {
    throw new Error('微信登录需要安装含微信 SDK 的开发版或正式版 App（Expo Go 不支持）')
  }

  const { isWechatInstalled, sendAuthRequest } = await import('expo-native-wechat')

  const installed = await isWechatInstalled()
  if (!installed) {
    throw new Error('请先安装微信客户端')
  }

  const response = await sendAuthRequest({
    scope: 'snsapi_userinfo',
    state: 'lugechat',
  })

  const code = response.data?.code
  if (!code) throw new Error('未获取到微信授权码')
  return code
}
