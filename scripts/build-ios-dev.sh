#!/usr/bin/env bash
# iOS Development Build
# - 模拟器：可编译，但微信 SDK 不支持模拟器（仅真机）
# - 真机：需 Xcode 登录 Apple ID 并配置 Signing Team
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODE="${1:-device}" # device | simulator

if [[ ! -d ios/app.xcworkspace ]]; then
  echo "==> 生成 iOS 原生工程"
  npx expo prebuild --platform ios
fi

if ! grep -q "EXCLUDED_ARCHS\[sdk=iphonesimulator" ios/Podfile; then
  python3 - <<'PY'
from pathlib import Path
path = Path("ios/Podfile")
text = path.read_text()
needle = "    )\n  end\nend\n"
patch = """    )

    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        config.build_settings['EXCLUDED_ARCHS[sdk=iphonesimulator*]'] = 'i386'
      end
    end

    installer.aggregate_targets.each do |aggregate_target|
      aggregate_target.user_project.native_targets.each do |target|
        target.build_configurations.each do |config|
          config.build_settings['EXCLUDED_ARCHS[sdk=iphonesimulator*]'] = 'i386'
        end
      end
      aggregate_target.user_project.save
    end
  end
end
"""
if needle in text and "EXCLUDED_ARCHS[sdk=iphonesimulator" not in text:
    text = text.replace(needle, patch, 1)
    path.write_text(text)
    print("patched Podfile")
PY
  (cd ios && pod install)
fi

if [[ "$MODE" == "device" ]]; then
  echo "==> 真机 Development Build（微信登录必须走此路径）"
  echo "    1. 用数据线连接 iPhone"
  echo "    2. Xcode → Settings → Accounts 登录 Apple ID"
  echo "    3. 在 Xcode 中为 app target 选择 Team（Signing & Capabilities）"
  echo ""
  if ! security find-identity -v -p codesigning 2>/dev/null | grep -q "Apple Development"; then
    echo "⚠  未检测到 Apple Development 证书，正在打开 Xcode 工程…"
    open ios/app.xcworkspace
    echo "    请在 Xcode 中完成签名配置后重新运行: npm run build:ios"
    exit 1
  fi
  REACT_NATIVE_PACKAGER_HOSTNAME=127.0.0.1 npx expo run:ios --device --no-bundler
  exit 0
fi

echo "==> 模拟器 Build（不含微信原生能力，仅供 UI 调试）"
echo "    微信 SDK 的 libWechatOpenSDK 不支持 iOS 模拟器，模拟器包无法完整链接。"
echo "    如需测微信登录，请用: npm run build:ios"
exit 1
