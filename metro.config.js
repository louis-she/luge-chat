const { getDefaultConfig } = require('expo/metro-config')

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname)

// 勿用 host: 'localhost'，在 macOS 上可能只绑 IPv6(::1)，模拟器访问 127.0.0.1 会 502
config.server = {
  ...config.server,
  host: '0.0.0.0',
}

module.exports = config
