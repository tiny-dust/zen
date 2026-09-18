<script setup lang="ts">
import { Check, ChevronDown, FileText, FolderOpen, Loader2, X } from "@lucide/vue";
import { computed, ref } from "vue";

import { toolDisplay } from "@/components/chat/tool-part";
import { useRightPanelStore } from "@/stores/right-panel";

import type { ToolPart } from "@/components/chat/tool-part";

/**
 * 消息流内的工具调用行：icon + 动作 + 高亮目标（文件可点击在右栏定位查看），
 * 写/编辑文件带 +/- 行数统计，点击行展开结果输出。
 */
const props = defineProps<{ part: ToolPart }>();

const rightPanel = useRightPanelStore();
const open = ref(false);

const display = computed(() => toolDisplay(props.part.toolName, props.part.args));
const running = computed(() => props.part.state === "running");
const detailText = computed(() => {
  if (props.part.output == null) {
    return "";
  }
  if (typeof props.part.output === "string") {
    return props.part.output;
  }
  try {
    return JSON.stringify(props.part.output, null, 2);
  } catch {
    return String(props.part.output);
  }
});
const hasDetails = computed(() => Boolean(detailText.value));

/** 文本行数（空串为 0；按换行拆分并去掉末尾空行） */
function countLines(text: string): number {
  if (!text) {
    return 0;
  }
  const lines = text.split("\n");
  while (lines.length && lines.at(-1)?.trim() === "") {
    lines.pop();
  }
  return lines.length;
}

/** 从工具入参里取第一个非空字符串 */
function argString(keys: string[]): string {
  if (typeof props.part.args !== "object" || props.part.args === null) {
    return "";
  }
  const record = props.part.args as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") {
      return value;
    }
  }
  return "";
}

/**
 * 写/编辑文件的改动行数统计：editFile 按旧串/新串行数计 -/+；
 * writeFile 是整文件写入，只计 +。+/- 为 0 时对应侧省略。
 */
const diffStat = computed<{ added: number; removed: number } | null>(() => {
  if (props.part.toolName === "editFile") {
    return {
      added: countLines(argString(["newString", "new_string", "newText"])),
      removed: countLines(argString(["oldString", "old_string", "oldText"])),
    };
  }
  if (props.part.toolName === "writeFile") {
    return { added: countLines(argString(["content", "text"])), removed: 0 };
  }
  return null;
});

function revealFile() {
  const path = display.value.target?.text;
  if (display.value.target?.kind === "file" && path) {
    rightPanel.revealFile(path);
  }
}
</script>

<template>
  <div class="w-full">
    <button
      type="button"
      class="flex w-full items-center gap-2 rounded-lg px-1.5 py-[3px] text-left transition-colors"
      :class="hasDetails ? 'hover:bg-[var(--color-menu-hover)]' : ''"
      :aria-expanded="open"
      @click="hasDetails && (open = !open)"
    >
      <span
        class="grid size-5 flex-none place-items-center rounded-md bg-[var(--color-chip-bg)]"
        :class="running ? 'text-[var(--color-accent)]' : 'text-[var(--color-mut)]'"
      >
        <component :is="display.icon" class="size-3" />
      </span>
      <span class="flex-none text-[12px] text-[var(--color-txt)]">{{ display.label }}</span>

      <!-- 高亮目标：文件 chip 可点击在右栏定位，目录带 folder 图标，其余以弱 mono 展示 -->
      <button
        v-if="display.target?.kind === 'file' && display.target.text"
        type="button"
        class="flex min-w-0 max-w-[280px] flex-none items-center gap-1 rounded-md border border-[var(--color-line)] bg-[var(--color-side-glass)] px-1.5 py-px text-[11px] text-[var(--color-txt)] hover:border-[var(--color-line-strong)] hover:text-[var(--color-txt-strong)]"
        :title="`在右侧面板查看 ${display.target.text}`"
        @click.stop="revealFile"
      >
        <FileText class="size-3 shrink-0" />
        <span class="truncate font-[family-name:var(--font-mono)]">{{ display.target.text }}</span>
      </button>
      <span
        v-else-if="display.target?.kind === 'dir' && display.target.text"
        class="flex min-w-0 max-w-[280px] flex-none items-center gap-1 rounded-md border border-[var(--color-line)] bg-[var(--color-side-glass)] px-1.5 py-px text-[11px] text-[var(--color-mut)]"
        :title="display.target.text"
      >
        <FolderOpen class="size-3 shrink-0" />
        <span class="truncate font-[family-name:var(--font-mono)]">{{ display.target.text }}</span>
      </span>
      <span
        v-else-if="display.target?.text"
        class="min-w-0 max-w-[280px] flex-none truncate rounded-md bg-[var(--color-side-glass)] px-1.5 py-px font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-mut)]"
        :title="display.target.text"
      >
        {{ display.target.text }}
      </span>

      <!-- 写/编辑文件的改动行数：+绿 -红，零值侧省略 -->
      <span
        v-if="diffStat && !running && (diffStat.added > 0 || diffStat.removed > 0)"
        class="flex-none font-[family-name:var(--font-mono)] text-[11px] leading-none"
      >
        <span v-if="diffStat.added > 0" class="text-[var(--color-add)]">+{{ diffStat.added }}</span>
        <span v-if="diffStat.added > 0 && diffStat.removed > 0" class="mx-0.5" />
        <span v-if="diffStat.removed > 0" class="text-[var(--color-del)]">-{{ diffStat.removed }}</span>
      </span>

      <span class="min-w-0 flex-1 truncate text-[11px] text-[var(--color-dim)]">
        {{ running ? (part.message || "正在调用") : (part.summary || "已完成") }}
      </span>

      <Loader2 v-if="running" class="size-3.5 flex-none animate-spin text-[var(--color-accent)]" />
      <Check v-else-if="part.state === 'ok'" class="size-3.5 flex-none text-[var(--color-ok)]" />
      <X v-else class="size-3.5 flex-none text-[var(--color-err)]" />
      <ChevronDown
        v-if="hasDetails"
        class="size-3 flex-none text-[var(--color-dim)] transition-transform duration-[var(--motion-fast)]"
        :class="open ? 'rotate-180' : ''"
      />
    </button>

    <pre
      v-if="open && detailText"
      class="mt-1 mb-1.5 ml-7 max-h-48 overflow-auto rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-code-bg)] p-2 font-[family-name:var(--font-mono)] text-[10.5px] leading-[1.6] whitespace-pre-wrap break-words text-[var(--color-code-fg)]"
    >{{ detailText }}</pre>
  </div>
</template>
