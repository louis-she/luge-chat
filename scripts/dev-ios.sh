#!/usr/bin/env bash
# 开发启动：临时关闭系统代理（Clash），避免模拟器 502；退出时恢复
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SERVICE="${LUGE_NET_SERVICE:-Wi-Fi}"
PROXY_WAS_ON=0
SECURE_WAS_ON=0
SOCKS_WAS_ON=0

restore_proxy() {
  if [[ "$PROXY_WAS_ON" == "1" ]]; then
    networksetup -setwebproxystate "$SERVICE" on 2>/dev/null || true
  fi
  if [[ "$SECURE_WAS_ON" == "1" ]]; then
    networksetup -setsecurewebproxystate "$SERVICE" on 2>/dev/null || true
  fi
  if [[ "$SOCKS_WAS_ON" == "1" ]]; then
    networksetup -setsocksfirewallproxystate "$SERVICE" on 2>/dev/null || true
  fi
}

if networksetup -getwebproxy "$SERVICE" 2>/dev/null | grep -q "Enabled: Yes"; then
  PROXY_WAS_ON=1
  networksetup -setwebproxystate "$SERVICE" off
fi
if networksetup -getsecurewebproxy "$SERVICE" 2>/dev/null | grep -q "Enabled: Yes"; then
  SECURE_WAS_ON=1
  networksetup -setsecurewebproxystate "$SERVICE" off
fi
if networksetup -getsocksfirewallproxy "$SERVICE" 2>/dev/null | grep -q "Enabled: Yes"; then
  SOCKS_WAS_ON=1
  networksetup -setsocksfirewallproxystate "$SERVICE" off
fi

trap restore_proxy EXIT INT TERM

echo "==> 已临时关闭 $SERVICE 系统代理（Clash），退出 npm 后自动恢复"
echo "==> 启动 Expo Go（模拟器）；真机 Dev Build 请用: npm run start:dev"

ARGS=("$@")
if [[ " ${ARGS[*]} " != *" --dev-client "* && [[ " ${ARGS[*]} " != *" --go "* ]]; then
  ARGS=(--go "${ARGS[@]}")
fi

REACT_NATIVE_PACKAGER_HOSTNAME=127.0.0.1 \
EXPO_PUBLIC_DEV_SIMULATOR_UI=1 \
NO_PROXY="localhost,127.0.0.1,::1,192.168.0.0/16,10.0.0.0/8" \
npx expo start -c "${ARGS[@]}"
