#!/usr/bin/env bash
# dev 模式的 Dock 名称/图标来自 node_modules 里 Electron 原装 bundle（运行时 API 改不了 Dock 名）。
# 此脚本给该 bundle 打品牌补丁：CFBundleName/DisplayName → Zen Dev（与生产 Zen 区分，
# 避免安装生产包时与开发包混淆）、替换 icns、重签名，
# 并把 Electron.app 整包改名为 Zen Dev.app（否则 tooltip/路径仍会回退成 Electron），
# 再用 lsregister 重新注册 + killall Dock 刷新缓存。
# 重装 electron 后需重跑（pnpm brand:dev / predev 会自动执行）。
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "$(uname)" != "Darwin" ]; then
  echo "brand:dev 仅用于 macOS，跳过"
  exit 0
fi

DIST="node_modules/electron/dist"
SRC_APP="$DIST/Electron.app"
BRANDED_APP="$DIST/Zen Dev.app"
LEGACY_APP="$DIST/Zen.app"
# 优先原装 Electron.app（electron 重装后会再次出现）；否则重入 Zen Dev.app；
# 旧的 Zen.app（历史品牌名）就地迁移
if [ -d "$SRC_APP" ]; then
  APP="$SRC_APP"
elif [ -d "$BRANDED_APP" ]; then
  APP="$BRANDED_APP"
elif [ -d "$LEGACY_APP" ]; then
  APP="$LEGACY_APP"
else
  echo "未找到 $SRC_APP / $BRANDED_APP / $LEGACY_APP，先安装依赖"
  exit 1
fi

PLIST="$APP/Contents/Info.plist"
ICNS_SRC="build/icon.icns"
ICNS_DST="$APP/Contents/Resources/electron.icns"

/usr/libexec/PlistBuddy -c "Set :CFBundleName Zen Dev" "$PLIST" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Add :CFBundleName string Zen Dev" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName Zen Dev" "$PLIST" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string Zen Dev" "$PLIST"

# 终端直接 exec 的进程，Dock 会回退显示可执行文件名：把可执行文件改名 Zen Dev
if [ -f "$APP/Contents/MacOS/Electron" ]; then
  mv "$APP/Contents/MacOS/Electron" "$APP/Contents/MacOS/Zen Dev"
elif [ -f "$APP/Contents/MacOS/Zen" ]; then
  mv "$APP/Contents/MacOS/Zen" "$APP/Contents/MacOS/Zen Dev"
fi
/usr/libexec/PlistBuddy -c "Set :CFBundleExecutable Zen Dev" "$PLIST"

cp "$ICNS_SRC" "$ICNS_DST"

# 名称与图标都会被 icon services 按「bundle 身份」缓存：把 Bundle ID 与 CFBundleVersion
# 绑定到 icns 指纹——改名或换图标都会形成全新身份，系统缓存必然重建，不会发旧图标。
# dev 的 userData 路径在代码里显式指定，身份变化不影响数据。
ICNS_STAMP=$(stat -f %m "$ICNS_SRC")
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.zen.desktop.dev.$ICNS_STAMP" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion 44.3.$ICNS_STAMP" "$PLIST"

# 改动 bundle 后 ad-hoc 签名失效，必须重签，否则 Apple Silicon 上无法启动
codesign --force --deep --sign - "$APP"

# 整包改名：Dock tooltip /「显示简介」路径都会跟 .app 文件名走。
# 必须在 codesign 之后执行，签名按 bundle 内容计算，改名不影响已签好的内容。
# 若 electron 重装又解出 Electron.app，用新包覆盖旧的 Zen Dev.app；旧 Zen.app 一并迁移。
if [ "$APP" = "$SRC_APP" ] || [ "$APP" = "$LEGACY_APP" ]; then
  rm -rf "$BRANDED_APP"
  mv "$APP" "$BRANDED_APP"
  APP="$BRANDED_APP"
  PLIST="$APP/Contents/Info.plist"
fi

# electron CLI / electron-vite 都从 path.txt 解析可执行文件，必须与 bundle 名同步
if [ -f "node_modules/electron/path.txt" ]; then
  printf '%s' "Zen Dev.app/Contents/MacOS/Zen Dev" > "node_modules/electron/path.txt"
fi

# pnpm 装的 electron 是符号链接：解析出真实路径再刷新 LaunchServices / Dock 缓存
REAL_APP="$(cd "$(dirname "$APP")" && pwd -P)/$(basename "$APP")"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
DIST_REAL="$(cd "$DIST" && pwd -P)"
# 清掉旧的 Electron.app / Zen.app / Helper 注册（改名后目录已不在，仍可能残留 LS 记录）
for stale in \
  "$DIST_REAL/Electron.app" \
  "$DIST_REAL/Electron.app/Contents/Frameworks/Electron Helper.app" \
  "$DIST_REAL/Electron.app/Contents/Frameworks/Electron Helper (Renderer).app" \
  "$DIST_REAL/Zen.app"
do
  "$LSREGISTER" -u "$stale" 2>/dev/null || true
done
"$LSREGISTER" -f "$REAL_APP" 2>/dev/null || echo "lsregister 刷新失败（不影响其他步骤）"
killall Dock 2>/dev/null || true

echo "dev bundle 已打上 Zen Dev 品牌（名称 + 图标 + Zen Dev.app + 缓存刷新）"
echo "bundle: $REAL_APP"
echo "如 Dock 仍显示旧名称：完全退出运行中的 app（Cmd+Q）后重新 pnpm dev"
