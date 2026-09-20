#!/usr/bin/env bash
set -euo pipefail
cd /Users/reynold/Self/zen
MSG="已连接（MiMo 会话）。Zen UI 可关注：1) composer 元素 tag 与气泡展示已同构；2) 设置页列表密度与重复控件可按 zen-001 收敛；3) 建议在真实页面再走一遍 标注→tag→悬浮明细。具体改哪一处请用选取点目标，或直接说文件名。"
node /Users/reynold/.agents/skills/impeccable/scripts/live-poll.mjs --reply b0502959 steer_done "$MSG"
echo "REPLY_OK"
nohup node /Users/reynold/.agents/skills/impeccable/scripts/live-poll.mjs > /Users/reynold/Self/zen/.impeccable/live/agent/poll.log 2> /Users/reynold/Self/zen/.impeccable/live/agent/poll.err &
echo "REPOLL_PID=$!"
sleep 1
ps aux | rg "live-poll" | rg -v rg || true
curl -sS -m 3 -H "Authorization: Bearer 288f1703-0664-40e8-82fe-c612a53c4010" "http://127.0.0.1:8400/status" || true
echo
curl -sS -m 3 -g "http://[::1]:10011/" 2>&1 | head -c 300 || true
