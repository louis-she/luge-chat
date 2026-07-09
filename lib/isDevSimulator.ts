import { requireOptionalNativeModule } from 'expo-modules-core'
import { Platform } from 'react-native'

let cached: boolean | undefined

type ExpoDeviceModule = { isDevice: boolean }

function devSimulatorFromEnv(): boolean | undefined {
  const v = process.env.EXPO_PUBLIC_DEV_SIMULATOR_UI
  if (v === '1' || v === 'true') return true
  if (v === '0' || v === 'false') return false
  return undefined
}

function androidEmulatorHeuristic(): boolean | undefined {
  if (Platform.OS !== 'android') return undefined
  const model = Platform.constants.Model ?? ''
  return /sdk_gphone|emulator|Android SDK built for/i.test(model)
}

/**
 * 开发调试 UI（问路输入框、手动坐标、沙盒登录等）仅在模拟器显示；
 * 真机 Dev Build 仍连 dev schema，但不展示这些面板。
 */
export function isDevSimulator(): boolean {
  if (!__DEV__) return false
  if (cached !== undefined) return cached

  const fromEnv = devSimulatorFromEnv()
  if (fromEnv !== undefined) {
    cached = fromEnv
    return cached
  }

  const ExpoDevice = requireOptionalNativeModule<ExpoDeviceModule>('ExpoDevice')
  if (ExpoDevice != null) {
    cached = !ExpoDevice.isDevice
    return cached
  }

  // ExpoDevice 未编入当前 Dev Build：Android 可启发式识别，iOS 默认隐藏
  cached = androidEmulatorHeuristic() ?? false
  return cached
}
