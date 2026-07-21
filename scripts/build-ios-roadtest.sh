#!/usr/bin/env bash
# 路测用 Release 真机构建：JS 打进安装包，不连电脑也能打开（无需 Metro）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env.local ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

if [[ -z "${EXPO_PUBLIC_SUPABASE_ANON_KEY:-}" ]]; then
  echo "缺少 EXPO_PUBLIC_SUPABASE_ANON_KEY，请先配置 .env.local（见 .env.example）" >&2
  exit 1
fi

export EXPO_PUBLIC_SUPABASE_DB_SCHEMA="${EXPO_PUBLIC_SUPABASE_DB_SCHEMA:-dev}"

TEAM_ID="${DEVELOPMENT_TEAM:-9UJ72U7F8J}"
DERIVED="$ROOT/.expo/ios-derived-release"

if [[ ! -d ios/app.xcworkspace ]]; then
  echo "→ 生成 iOS 原生工程"
  npx expo prebuild --platform ios
fi

if ! security find-identity -v -p codesigning 2>/dev/null | grep -q "Apple Development"; then
  echo "⚠ 未检测到 Apple Development 证书，请先在 Xcode 登录 Apple ID 并配置签名" >&2
  open ios/app.xcworkspace
  exit 1
fi

# Xcode 识别的真机 UDID（数据线连接时）；无线配对时可能为空
XCODE_DEVICE_ID="$(xcrun xctrace list devices 2>/dev/null \
  | grep -v Simulator \
  | grep -Eo '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}' \
  | grep -v '^78517647' \
  | head -1 || true)"

echo "==> 路测 Release 构建（JS 内嵌，断开电脑可独立运行）"
echo "    schema: $EXPO_PUBLIC_SUPABASE_DB_SCHEMA"
echo "    api: ${EXPO_PUBLIC_SUPABASE_URL:-https://api.luge.chat}"

echo "→ 编译 Release（iphoneos）…"
xcodebuild \
  -workspace ios/app.xcworkspace \
  -scheme app \
  -configuration Release \
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

APP="$(find "$DERIVED/Build/Products/Release-iphoneos" -name 'app.app' -type d | head -1)"
if [[ -z "$APP" || ! -d "$APP" ]]; then
  echo "未找到 Release 产物 app.app" >&2
  exit 1
fi

echo "✓ 已构建: $APP"

if [[ -n "${XCODE_DEVICE_ID:-}" ]]; then
  echo "→ 安装到真机 $XCODE_DEVICE_ID"
  if xcrun devicectl device install app --device "$XCODE_DEVICE_ID" "$APP" 2>/dev/null; then
    echo "✓ 已安装到手机"
  elif command -v ios-deploy >/dev/null 2>&1 && ios-deploy --id "$XCODE_DEVICE_ID" --bundle "$APP"; then
    echo "✓ 已安装到手机（ios-deploy）"
  else
  echo "自动安装失败，请用 Xcode：打开 ios/app.xcworkspace → 选 iPhone → Run（Scheme 选 Release）"
  fi
else
  echo ""
  echo "未检测到已通过 Xcode 连接的真机（当前可能仅无线配对）。"
  echo "请任选其一："
  echo "  1) USB 连接 iPhone 后重新运行: npm run build:ios:roadtest"
  echo "  2) Xcode 打开 ios/app.xcworkspace → 顶部选你的 iPhone → Product → Run"
  echo "     （Edit Scheme → Run → Build Configuration 选 Release）"
  echo ""
  echo "产物路径: $APP"
fi

echo ""
echo "说明：这是 Release 包，不依赖 Metro。删掉旧的 Debug 开发包后装此版本即可路测。"
