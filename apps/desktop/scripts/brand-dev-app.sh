#!/usr/bin/env bash
# dev 模式的 Dock 名称/图标来自 node_modules 里 Electron 原装 bundle（运行时 API 改不了 Dock 名）。
# 此脚本给该 bundle 打品牌补丁：CFBundleName/DisplayName → Zen、替换 icns、重签名，
# 并用 lsregister 重新注册 + killall Dock 刷新缓存（否则 macOS 仍显示缓存的 Electron）。
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
# 换用独立 Bundle ID：com.github.Electron 的旧注册（名称/图标）被系统缓存，
# 全新身份会触发全新的 LaunchServices 注册，彻底摆脱 Electron 残留
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.zen.desktop.dev" "$PLIST"

cp "$ICNS_SRC" "$ICNS_DST"

# 改动 bundle 后 ad-hoc 签名失效，必须重签，否则 Apple Silicon 上无法启动
codesign --force --deep --sign - "$APP"

# pnpm 装的 electron 是符号链接：解析出真实路径再刷新 LaunchServices / Dock 缓存
REAL_APP="$(cd "$(dirname "$APP")" && pwd -P)/Electron.app"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
"$LSREGISTER" -f "$REAL_APP" 2>/dev/null || echo "lsregister 刷新失败（不影响其他步骤）"
killall Dock 2>/dev/null || true

echo "dev bundle 已打上 Zen 品牌（名称 + 图标 + 缓存刷新）"
echo "如 Dock 仍显示 Electron：完全退出运行中的 app（Cmd+Q）后重新 pnpm dev"
