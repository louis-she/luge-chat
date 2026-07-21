/**
 * Expo config plugin：火山 @volcengine/react-native-rtc 原生依赖源
 * - iOS：增加 volcengine-specs CocoaPods source
 * - Android：增加 ByteDance / Volcengine Maven 仓库
 * - iOS：后台音频（通话态）
 */
const {
  withPodfile,
  withProjectBuildGradle,
  withInfoPlist,
  createRunOncePlugin,
} = require('@expo/config-plugins')

const VOLC_SPEC = "source 'https://github.com/volcengine/volcengine-specs.git'"
const CDN_SPEC = "source 'https://cdn.cocoapods.org/'"
const MAVEN_URL = "maven { url 'https://artifact.bytedance.com/repository/Volcengine/' }"

function withVolcRtcPodSources(config) {
  return withPodfile(config, (cfg) => {
    let contents = cfg.modResults.contents
    if (!contents.includes('volcengine-specs')) {
      const sources = `${CDN_SPEC}\n${VOLC_SPEC}\n\n`
      contents = sources + contents
    }
    cfg.modResults.contents = contents
    return cfg
  })
}

function withVolcRtcMaven(config) {
  return withProjectBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') return cfg
    let contents = cfg.modResults.contents
    if (!contents.includes('artifact.bytedance.com/repository/Volcengine')) {
      contents = contents.replace(
        /allprojects\s*\{[\s\S]*?repositories\s*\{/,
        (match) => `${match}\n        ${MAVEN_URL}`,
      )
      // Expo 新模板可能用 settings.gradle / dependencyResolutionManagement
      if (!contents.includes('artifact.bytedance.com/repository/Volcengine')) {
        contents = contents.replace(
          /repositories\s*\{/,
          (match) => `${match}\n        ${MAVEN_URL}`,
        )
      }
    }
    cfg.modResults.contents = contents
    return cfg
  })
}

function withVolcRtcAudioBackground(config) {
  return withInfoPlist(config, (cfg) => {
    const modes = new Set(cfg.modResults.UIBackgroundModes ?? [])
    modes.add('audio')
    cfg.modResults.UIBackgroundModes = [...modes]
    if (!cfg.modResults.NSMicrophoneUsageDescription) {
      cfg.modResults.NSMicrophoneUsageDescription =
        '路鸽需要使用麦克风，以便与导游语音通话。'
    }
    return cfg
  })
}

function withVolcRtc(config) {
  config = withVolcRtcPodSources(config)
  config = withVolcRtcMaven(config)
  config = withVolcRtcAudioBackground(config)
  return config
}

module.exports = createRunOncePlugin(withVolcRtc, 'with-volc-rtc', '1.0.0')
