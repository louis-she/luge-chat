#!/usr/bin/env bash
# 在本机 Xcode 26 上，npx expo run:ios 常因两件事失败：
# 1) CoreDevice 列不出模拟器 UDID
# 2) WechatOpenSDK 的 arm64 是真机切片，无法链到 Apple Silicon 模拟器
#
# 因此原生登录（Apple / 微信）请用真机。本脚本：
# - 有已连接真机 → 编真机并安装
# - 否则 → 编 generic iphoneos（可稍后用 Xcode 装到手机）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DERIVED="$ROOT/.expo/ios-derived"
BUNDLE_ID="com.shexiaoshu.lugechat"
TEAM_ID="${DEVELOPMENT_TEAM:-9UJ72U7F8J}"

if [[ ! -d ios/app.xcworkspace ]]; then
  echo "→ 未找到 ios/，先 prebuild"
  npx expo prebuild --platform ios
fi

# 已连接的真机（优先 devicectl，xctrace 常会误匹配旧 UDID）
DEVICE_ID="$(xcrun devicectl list devices 2>/dev/null | awk '/connected/ {print $NF; exit}' || true)"
if [[ -z "${DEVICE_ID:-}" ]]; then
  DEVICE_ID="$(xcrun xctrace list devices 2>/dev/null | grep -v Simulator | sed -n 's/.*(\([A-F0-9-]\{36\}\))$/\1/p' | head -1 || true)"
fi

echo "→ 构建真机包（iphoneos / arm64）"
echo "  说明：含微信 SDK，不能装到模拟器；Apple / 微信登录请用真机。"

xcodebuild \
  -workspace ios/app.xcworkspace \
  -scheme app \
  -configuration Debug \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$DERIVED" \
  -allowProvisioningUpdates \
  -allowProvisioningDeviceRegistration \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  CODE_SIGN_IDENTITY='Apple Development' \
  CODE_SIGN_STYLE=Automatic \
  COCOAPODS_PARALLEL_CODE_SIGN=true \
  COMPILER_INDEX_STORE_ENABLE=NO \
  build

APP="$(find "$DERIVED/Build/Products/Debug-iphoneos" -name 'app.app' -type d | head -1)"
if [[ -z "$APP" || ! -d "$APP" ]]; then
  echo "未找到构建产物 app.app" >&2
  exit 1
fi

echo "✓ 已构建: $APP"

if [[ -n "${DEVICE_ID:-}" ]]; then
  echo "→ 安装到真机 $DEVICE_ID"
  xcrun devicectl device install app --device "$DEVICE_ID" "$APP" 2>/dev/null \
    || ios-deploy --id "$DEVICE_ID" --bundle "$APP" 2>/dev/null \
    || echo "自动安装失败：请用 Xcode 打开 ios/app.xcworkspace，选你的 iPhone，点 Run"
else
  echo
  echo "未检测到已连接的 iPhone。"
  echo "请：1) 数据线连接手机并信任此电脑"
  echo "    2) 打开 ios/app.xcworkspace，顶部选你的 iPhone，点 Run"
  echo "    3) 另开终端跑: npm run start:dev"
fi
