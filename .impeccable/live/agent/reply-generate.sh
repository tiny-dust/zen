#!/usr/bin/env bash
set -euo pipefail
cd /Users/reynold/Self/zen
ID=99d989e9
FILE=apps/ui/src/components/session/SessionInfoPanel.vue
node /Users/reynold/.agents/skills/impeccable/scripts/live-poll.mjs --reply "$ID" done \
  --file "$FILE" \
  "已在会话信息卡写入 3 个排版变体：V1 清晰层级 / V2 开放阅读 / V3 等宽信息密度。用底部 ×N 切换预览，满意后点「采用」。"
echo "REPLY_DONE"
grep -qx "$ID" .impeccable/live/agent/replied.ids 2>/dev/null || echo "$ID" >> .impeccable/live/agent/replied.ids
node /Users/reynold/.agents/skills/impeccable/scripts/live-status.mjs 2>&1 | head -c 900
echo
# keep poll loop alive
if ! pgrep -f "poll-loop.mjs" >/dev/null; then
  nohup node .impeccable/live/agent/poll-loop.mjs > .impeccable/live/agent/poll-loop.log 2>&1 &
  echo "LOOP=$!"
fi
