import * as AppleAuthentication from 'expo-apple-authentication'
import { Platform } from 'react-native'

export type AppleAuthCredential = {
  identityToken: string
  fullName: string | null
  email: string | null
}

export async function isAppleLoginSupported(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false
  return AppleAuthentication.isAvailableAsync()
}

/** 调起系统 Apple 登录，返回 identityToken 供后端校验 */
export async function requestAppleCredential(): Promise<AppleAuthCredential> {
  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
  })

  if (!credential.identityToken) {
    throw new Error('Apple 未返回 identityToken')
  }

  const parts = [credential.fullName?.familyName, credential.fullName?.givenName]
    .filter(Boolean)
    .join('')

  return {
    identityToken: credential.identityToken,
    fullName: parts || null,
    email: credential.email,
  }
}
