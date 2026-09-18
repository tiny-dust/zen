<script setup lang="ts">
import { Brain, Check, ChevronDown, FileCode2, FolderSearch, LoaderCircle, Terminal, X } from "@lucide/vue";
import { computed } from "vue";

import MessageBubble from "@/components/MessageBubble.vue";
import { Response } from "@/components/ai-elements/response";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

import type { ChatMessage, ChatMessagePart } from "@zen/shared";

const props = defineProps<{ variant: string; stage: number; playing: boolean }>();
const tools = [
  { icon: FolderSearch, label: "搜索文件", target: "apps/ui/src/components/", result: "找到 3 处消息渲染入口", state: "ok" },
  { icon: FileCode2, label: "读取文件", target: "MessageBubble.vue", result: "已读取 301 行", state: "ok" },
  { icon: Terminal, label: "执行检查", target: "pnpm --filter @zen/ui typecheck", result: "检查命令失败，详见输出", state: "error" },
];
const answer = `## 先区分过程，再突出结论

当前最影响扫读的，是**正文、思考和工具记录几乎处于同一视觉层级**。建议保留裸排正文，先调整以下三处。

- **正文**：增加段落呼吸感，标题回归中性高对比，链接保留蓝色。
- **工具记录**：固定动作与目标的位置；成功保持克制，失败给出完整文字。
- **思考内容**：缩进到次级层，不让长过程淹没最终答复。

### 样式边界

代码是可复制的内容，文件路径是可定位的引用，两者不应看起来完全相同。

\`\`\`css
.content-body {
  font-size: 14px;
  line-height: 1.8;
  color: var(--color-txt);
}
\`\`\`

> 本页仅为设计演示。正式会话的样式、工具行为与数据协议尚未修改。`;
const visibleAnswer = computed(() => props.stage >= 5 ? answer : "## 先区分过程，再突出结论\n\n当前最影响扫读的，是**正文、思考和工具记录几乎处于同一视觉层级**。");
const user: ChatMessage = { id: "review-user", role: "user", content: "把内容区设计清楚，先给我看所有输出格式，再决定改哪些。", createdAt: 1 };
const currentMessage = computed<ChatMessage>(() => {
  const parts: ChatMessagePart[] = [];
  if (props.stage >= 1) parts.push({ type: "reasoning", text: "演示过程：核对正文、工具记录与错误提示的排版层级。", ms: 2000 });
  if (props.stage >= 2) parts.push({ type: "tool", toolCallId: "a", toolName: "searchFiles", args: { query: "MessageBubble" }, state: "ok", summary: "找到 3 处消息渲染入口", output: "MessageBubble.vue\nChatTimeline.vue\nResponse.vue" });
  if (props.stage >= 3) parts.push({ type: "tool", toolCallId: "b", toolName: "readFile", args: { path: "apps/ui/src/components/MessageBubble.vue" }, state: "ok", summary: "已读取 301 行", output: "<template>\n  <!-- 示例文件内容 -->\n</template>" });
  if (props.stage >= 4) parts.push({ type: "tool", toolCallId: "c", toolName: "runTerminal", args: { command: "pnpm --filter @zen/ui typecheck" }, state: "error", summary: "检查命令失败，详见输出", output: "[模拟输出] Process exited with code 1\n示例错误，不代表当前项目的检查结果。" });
  if (props.stage >= 4) parts.push({ type: "text", text: visibleAnswer.value });
  return { id: "review-assistant", role: "assistant", content: visibleAnswer.value, createdAt: 2, parts };
});
</script>

<template>
  <div class="conversation-preview" :class="variant === 'A' ? 'current-content' : 'proposal-content'">
    <template v-if="variant === 'A'">
      <MessageBubble :message="user" />
      <MessageBubble :message="currentMessage" :streaming="playing" />
    </template>
    <template v-else>
      <div class="demo-user">{{ user.content }}</div>
      <template v-if="variant === 'B'">
        <Collapsible v-if="stage >= 1" class="thinking-block">
          <CollapsibleTrigger as-child>
            <Button variant="ghost" size="sm" class="thinking-trigger">
              <Brain data-icon="inline-start" />
              {{ stage === 1 && playing ? '正在思考' : '已思考 2 秒' }}
              <ChevronDown data-icon="inline-end" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent class="thinking-body">演示过程：核对正文、工具记录与错误提示的排版层级。</CollapsibleContent>
        </Collapsible>
        <div v-if="stage >= 2" class="process-rail" aria-label="工具执行过程">
          <Collapsible v-for="(tool, index) in tools.slice(0, Math.min(3, stage - 1))" :key="tool.label" class="process-step" :class="{ 'step-error': tool.state === 'error' }">
            <div class="step-line">
              <component :is="tool.icon" class="step-icon" />
              <span class="step-action">{{ tool.label }}</span>
              <code class="step-target" :title="tool.target">{{ tool.target }}</code>
              <CollapsibleTrigger as-child>
                <Button variant="ghost" size="sm" class="step-state" :aria-label="`展开${tool.label}的结果`">
                  <X v-if="tool.state === 'error'" data-icon="inline-start" />
                  <Check v-else data-icon="inline-start" />
                  {{ tool.state === 'error' ? '失败' : '完成' }}
                  <ChevronDown data-icon="inline-end" />
                </Button>
              </CollapsibleTrigger>
            </div>
            <p v-if="tool.state === 'error'" class="step-error-text">类型检查未完成。此处为失败状态的演示。</p>
            <CollapsibleContent class="step-details">
              <p>{{ tool.result }}</p>
              <pre>{{ index === 2 ? '[模拟输出] Process exited with code 1\n这不是实际测试结果。' : `${tool.target}\n${tool.result}` }}</pre>
            </CollapsibleContent>
          </Collapsible>
        </div>
        <Response v-if="stage >= 4" :content="visibleAnswer" class="md-content sample-prose final-answer" />
      </template>
      <template v-else>
        <div class="phase-layout">
          <aside class="phase-index" aria-label="本轮阶段">
            <span :class="{ active: stage < 4 }"><Check />检查现状</span>
            <span :class="{ active: stage >= 4 }"><FileCode2 />设计结论</span>
          </aside>
          <div class="phase-content">
            <Collapsible v-if="stage >= 1" class="phase-group" :default-open="stage < 4">
              <CollapsibleTrigger as-child>
                <Button variant="ghost" class="phase-trigger">
                  <span>检查现状</span><span class="phase-count">{{ Math.min(3, Math.max(0, stage - 1)) }} 项操作</span><ChevronDown />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <p class="phase-thinking"><Brain />已思考 2 秒</p>
                <div v-for="tool in tools.slice(0, Math.min(3, Math.max(0, stage - 1)))" :key="tool.label" class="phase-tool">
                  <component :is="tool.icon" /><span>{{ tool.label }}<code>{{ tool.target }}</code></span><span :class="{ 'failure-text': tool.state === 'error' }">{{ tool.state === 'error' ? '失败' : '完成' }}</span>
                </div>
              </CollapsibleContent>
            </Collapsible>
            <Response v-if="stage >= 4" :content="visibleAnswer" class="md-content sample-prose final-answer" />
          </div>
        </div>
      </template>
      <div v-if="playing" class="demo-runtime" role="status"><LoaderCircle class="animate-spin" />{{ stage < 4 ? '正在检查内容区' : '正在生成设计结论' }}</div>
      <div v-else-if="stage >= 5" class="demo-runtime"><Check />演示结束<span>正式界面未改动</span></div>
    </template>
  </div>
</template>

<style scoped>
.conversation-preview { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.demo-user { align-self: flex-end; max-width: 86%; padding: 11px 16px; border-radius: var(--radius-lg); background: var(--color-side-sel); font-size: 14px; line-height: 1.7; overflow-wrap: anywhere; }
.thinking-block { color: var(--color-mut); }
.thinking-trigger { padding: 0; height: 28px; font-size: 12px; gap: 8px; }
.thinking-trigger svg:last-child { width: 12px; }
.thinking-body { margin: 8px 0 0 7px; padding: 4px 0 4px 20px; border-left: 1px solid var(--color-line); font-size: 13px; line-height: 1.8; }
.process-rail { display: flex; flex-direction: column; gap: 6px; border-left: 1px solid var(--color-line); margin-left: 7px; padding-left: 17px; }
.process-step { min-width: 0; }
.step-line { display: grid; grid-template-columns: 16px 64px minmax(0, 1fr) auto; align-items: center; gap: 9px; min-height: 36px; }
.step-icon { width: 16px; height: 16px; color: var(--color-mut); }
.step-action { font-size: 12px; color: var(--color-mut); }
.step-target { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--color-txt); }
.step-state { height: 28px; padding: 0 4px; font-size: 11px; color: var(--color-mut); }
.step-state svg { width: 13px; height: 13px; }
.step-state svg:first-child { color: var(--color-add); }
.step-error .step-state, .step-error .step-state svg:first-child, .failure-text { color: var(--color-danger-fg); }
.step-error { border-left: 2px solid var(--color-del); margin-left: -19px; padding-left: 17px; }
.step-error-text { margin: 0 0 4px 25px; font-size: 12px; line-height: 1.7; color: var(--color-danger-fg); }
.step-details { margin: 0 0 8px 25px; padding: 8px 12px; background: var(--color-side); border-radius: var(--radius-sm); font-size: 12px; }
.step-details p { margin: 0 0 6px; color: var(--color-mut); }
.step-details pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.7; }
.final-answer { margin-top: 9px; }
.demo-runtime { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--color-mut); }
.demo-runtime svg { width: 14px; height: 14px; }
.demo-runtime span { padding-left: 8px; border-left: 1px solid var(--color-line); }
.phase-layout { display: grid; grid-template-columns: 106px minmax(0, 1fr); gap: 22px; }
.phase-index { display: flex; flex-direction: column; gap: 16px; padding-top: 8px; border-right: 1px solid var(--color-line); font-size: 12px; color: var(--color-mut); }
.phase-index span { display: flex; align-items: center; gap: 6px; }
.phase-index svg { width: 13px; height: 13px; }
.phase-index .active { color: var(--color-txt-strong); font-weight: 600; }
.phase-content { min-width: 0; }
.phase-group { border-block: 1px solid var(--color-line); }
.phase-trigger { display: flex; width: 100%; padding: 8px 0; justify-content: flex-start; font-size: 13px; }
.phase-count { margin-left: auto; color: var(--color-mut); font-size: 11px; font-weight: 400; }
.phase-thinking { display: flex; gap: 8px; align-items: center; font-size: 12px; color: var(--color-mut); margin: 8px 0; }
.phase-thinking svg, .phase-tool > svg { width: 14px; height: 14px; flex: none; }
.phase-tool { display: flex; align-items: flex-start; gap: 9px; padding: 10px 0; font-size: 12px; }
.phase-tool > span:nth-child(2) { flex: 1; min-width: 0; }
.phase-tool code { display: block; color: var(--color-mut); font-size: 11px; margin-top: 4px; overflow-wrap: anywhere; }
.phase-tool > span:last-child { flex: none; font-size: 11px; }
@container preview (max-width: 500px) {
  .step-line { grid-template-columns: 16px 60px minmax(0, 1fr); column-gap: 7px; }
  .step-state { grid-column: 3; justify-self: end; grid-row: 1; }
  .step-target { grid-column: 2 / -1; grid-row: 2; margin-bottom: 6px; }
  .phase-layout { grid-template-columns: 1fr; gap: 12px; }
  .phase-index { flex-direction: row; border-right: 0; border-bottom: 1px solid var(--color-line); padding-bottom: 12px; }
}
@media (prefers-reduced-motion: reduce) { .animate-spin { animation: none; } }
</style>
