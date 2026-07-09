/**
 * 避免 Xcode 把目标解析成「Designed for iPhone」的 Mac，
 * 并显式声明仅支持 iphoneos / iphonesimulator。
 */
const { withXcodeProject } = require('expo/config-plugins')

const SETTINGS = {
  SUPPORTED_PLATFORMS: '"iphoneos iphonesimulator"',
  SUPPORTS_MACCATALYST: 'NO',
  SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD: 'NO',
  SUPPORTS_XR_DESIGNED_FOR_IPHONE_IPAD: 'NO',
}

function withIosSimulatorDestinations(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults
    const configs = project.pbxXCBuildConfigurationSection()
    for (const key of Object.keys(configs)) {
      const entry = configs[key]
      if (typeof entry !== 'object' || !entry.buildSettings) continue
      const bs = entry.buildSettings
      if (bs.PRODUCT_BUNDLE_IDENTIFIER || bs.INFOPLIST_FILE) {
        Object.assign(bs, SETTINGS)
        delete bs.MACOSX_DEPLOYMENT_TARGET
      }
    }
    return cfg
  })
}

module.exports = withIosSimulatorDestinations
