#!/usr/bin/env bash
set -euo pipefail
cd /Users/reynold/Self/zen
node /Users/reynold/.agents/skills/impeccable/scripts/live-poll.mjs --reply 979f35b0 steer_done "收到。当前 live 挂在 Zen UI（localhost:10011）。若要在应用内打开网页，请在 Zen 右栏浏览器地址栏输入 www.baidu.com，或让我调用 browser.openUrl。在本页面 live 里直接 steer 网址不会替你导航浏览器标签。"
echo REPLY_OK
pkill -f "live-poll.mjs" 2>/dev/null || true
sleep 0.3
nohup node /Users/reynold/Self/zen/.impeccable/live/agent/poll-loop.mjs > /Users/reynold/Self/zen/.impeccable/live/agent/poll-loop.log 2>&1 &
echo "LOOP_PID=$!"
sleep 1.5
cat /Users/reynold/Self/zen/.impeccable/live/agent/status.json
echo
ps aux | rg "poll-loop|live-poll" | rg -v rg
