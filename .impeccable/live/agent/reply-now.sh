#!/usr/bin/env bash
set -euo pipefail
cd /Users/reynold/Self/zen
POLL=/Users/reynold/.agents/skills/impeccable/scripts/live-poll.mjs
ID=23f1bf9a
MSG="已处理。说明：Detect 只在页面上画标注，不会把问题列表传进 steer，因此无法「一键优化全部检测项」。当前已做：右栏「最近标注」改为 Globe+元素名+tag+selector，悬浮显示中文明细。请用工具栏「选取」点中具体元素后再发指令（如：把这个按钮改成主色），我会改代码并回执。"
node "$POLL" --reply "$ID" steer_done "$MSG"
echo "replied $ID"
grep -qx "$ID" .impeccable/live/agent/replied.ids 2>/dev/null || echo "$ID" >> .impeccable/live/agent/replied.ids
# keep poll-loop alive
if ! ps -p 96182 >/dev/null 2>&1; then
  nohup node .impeccable/live/agent/poll-loop.mjs > .impeccable/live/agent/poll-loop.log 2>&1 &
  echo "restarted loop $!"
fi
cd /Users/reynold/Self/zen && node .agents/../.agents 2>/dev/null || true
node /Users/reynold/.agents/skills/impeccable/scripts/live-status.mjs 2>&1 | head -c 1200
