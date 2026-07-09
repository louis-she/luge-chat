/**
 * WechatOpenSDK 默认排除模拟器 arm64，导致 Apple Silicon 无法编模拟器。
 * 在 Podfile post_install 末尾清掉该设置。
 */
const { withDangerousMod } = require('expo/config-plugins')
const fs = require('fs')
const path = require('path')

const SNIPPET = `
    # [luge] WechatOpenSDK: allow arm64 simulator on Apple Silicon
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        config.build_settings['EXCLUDED_ARCHS[sdk=iphonesimulator*]'] = ''
      end
    end
    installer.aggregate_targets.each do |aggregate|
      aggregate.xcconfigs.each do |name, config_file|
        config_file.attributes.delete('EXCLUDED_ARCHS[sdk=iphonesimulator*]')
        config_file.save_as(aggregate.xcconfig_path(name))
      end
    end
    Dir.glob(File.join(installer.sandbox.root, 'Target Support Files', '**', '*.xcconfig')).each do |xcconfig_path|
      text = File.read(xcconfig_path)
      next unless text.include?('EXCLUDED_ARCHS[sdk=iphonesimulator*]')
      File.write(xcconfig_path, text.gsub(/^EXCLUDED_ARCHS\\[sdk=iphonesimulator\\*\\]\\s*=.*\\n/, ''))
    end
`

function withWechatSimArm64(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, 'Podfile')
      let podfile = fs.readFileSync(podfilePath, 'utf8')
      if (podfile.includes('[luge] WechatOpenSDK')) return cfg

      // Insert before the final `end` of post_install block's outer target end —
      // match react_native_post_install(...) block closing and inject after it.
      const anchor = 'react_native_post_install('
      const start = podfile.indexOf(anchor)
      if (start === -1) {
        console.warn('withWechatSimArm64: react_native_post_install not found, skip')
        return cfg
      }
      let depth = 0
      let closeIdx = -1
      for (let i = start; i < podfile.length; i++) {
        const ch = podfile[i]
        if (ch === '(') depth++
        else if (ch === ')') {
          depth--
          if (depth === 0) {
            closeIdx = i
            break
          }
        }
      }
      if (closeIdx === -1) {
        console.warn('withWechatSimArm64: could not find post_install close, skip')
        return cfg
      }
      const after = podfile.indexOf('\n', closeIdx) + 1
      podfile = podfile.slice(0, after) + SNIPPET + podfile.slice(after)
      fs.writeFileSync(podfilePath, podfile)
      return cfg
    },
  ])
}

module.exports = withWechatSimArm64
