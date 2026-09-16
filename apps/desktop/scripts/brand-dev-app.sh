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

# 终端直接 exec 的进程，Dock 会回退显示可执行文件名：把 MacOS/Electron 改名 Zen，
# 同步 CFBundleExecutable 与 electron 启动器依赖的 path.txt（无换行）
if [ -f "$APP/Contents/MacOS/Electron" ]; then
  mv "$APP/Contents/MacOS/Electron" "$APP/Contents/MacOS/Zen"
fi
/usr/libexec/PlistBuddy -c "Set :CFBundleExecutable Zen" "$PLIST"
if [ -f "node_modules/electron/path.txt" ]; then
  printf '%s' "Electron.app/Contents/MacOS/Zen" > "node_modules/electron/path.txt"
fi

cp "$ICNS_SRC" "$ICNS_DST"

# 名称与图标都会被 icon services 按「bundle 身份」缓存：把 Bundle ID 与 CFBundleVersion
# 绑定到 icns 指纹——改名或换图标都会形成全新身份，系统缓存必然重建，不会发旧图标。
# dev 的 userData 路径在代码里显式指定，身份变化不影响数据。
ICNS_STAMP=$(stat -f %m "$ICNS_SRC")
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.zen.desktop.dev.$ICNS_STAMP" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion 44.3.$ICNS_STAMP" "$PLIST"

# 改动 bundle 后 ad-hoc 签名失效，必须重签，否则 Apple Silicon 上无法启动
codesign --force --deep --sign - "$APP"

# pnpm 装的 electron 是符号链接：解析出真实路径再刷新 LaunchServices / Dock 缓存
REAL_APP="$(cd "$(dirname "$APP")" && pwd -P)/Electron.app"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
"$LSREGISTER" -f "$REAL_APP" 2>/dev/null || echo "lsregister 刷新失败（不影响其他步骤）"
killall Dock 2>/dev/null || true

echo "dev bundle 已打上 Zen 品牌（名称 + 图标 + 缓存刷新）"
echo "如 Dock 仍显示 Electron：完全退出运行中的 app（Cmd+Q）后重新 pnpm dev"
