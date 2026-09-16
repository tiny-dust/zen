#!/usr/bin/env bash
# dev 模式的 Dock 名称/图标来自 node_modules 里 Electron 原装 bundle（运行时 API 改不了 Dock 名）。
# 此脚本给该 bundle 打品牌补丁：CFBundleName/DisplayName → Zen、替换 icns、重签名。
# 重装 electron 后需重跑（pnpm brand:dev）。
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "$(uname)" != "Darwin" ]; then
  echo "brand:dev 仅用于 macOS，跳过"
  exit 0
fi

APP="node_modules/electron/dist/Electron.app"
PLIST="$APP/Contents/Info.plist"
ICNS_SRC="build/icon.icns"
ICNS_DST="$APP/Contents/Resources/electron.icns"

if [ ! -d "$APP" ]; then
  echo "未找到 $APP，先安装依赖"
  exit 1
fi

/usr/libexec/PlistBuddy -c "Set :CFBundleName Zen" "$PLIST" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Add :CFBundleName string Zen" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName Zen" "$PLIST" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string Zen" "$PLIST"

cp "$ICNS_SRC" "$ICNS_DST"

# 改动 bundle 后 ad-hoc 签名失效，必须重签，否则 Apple Silicon 上无法启动
codesign --force --deep --sign - "$APP"

echo "dev bundle 已打上 Zen 品牌（名称 + 图标）"
