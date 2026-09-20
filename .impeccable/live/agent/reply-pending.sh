#!/usr/bin/env bash
set -euo pipefail
cd /Users/reynold/Self/zen
POLL=/Users/reynold/.agents/skills/impeccable/scripts/live-poll.mjs
reply() {
  local id="$1"
  local status="$2"
  local msg="$3"
  node "$POLL" --reply "$id" "$status" "$msg"
  echo "replied $id -> $status"
}

reply 6d2086f8 steer_done "已收到（测试消息可忽略）。Agent 已常驻轮询，请继续在页面上选取元素或输入具体指令。"
reply f0829a30 steer_done "已收到。Agent 连接正常；请输入完整指令，例如：将检测到的元素进行优化。"
reply 6c66a2c4 steer_done "已处理：Zen live agent 已常驻。检测类问题无法从 steer 载荷直接拿到 DOM 标注列表——请用工具栏「选取」点中具体元素后再指挥，或在消息里写明文件/区域。我已在会话侧处理积压事件，后续输入会有 toast 回执。已知可改点：右栏浏览器「最近标注」应显示元素名而非仅 selector（将同步优化）。"

echo "ALL_REPLIED"
