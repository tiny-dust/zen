<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import DiffView from "@/components/right/DiffView.vue";
import { ansiToSpans, hasAnsi } from "./ansi";
import { toolFileDiff } from "./tool-file-diff";
import { codeLines } from "./tool-result";
import { highlightLines, langFromPath } from "@/lib/shiki-highlight";

import type { ToolResult } from "./tool-result";

const props = defineProps<{ result: ToolResult }>();
const { t } = useI18n();
const lines = computed(() => props.result.kind === "code" ? codeLines(props.result.text) : []);
const codeLang = computed(() => (props.result.kind === "code" ? langFromPath(props.result.path) : undefined));
/** 读/写文件展开内容：按扩展名做语法高亮（异步，未就绪时纯文本；结果流式更新时重算） */
const highlighted = ref<string[] | null>(null);
let highlightVersion = 0;
watch(
  () => [props.result, codeLang.value] as const,
  async () => {
    const current = ++highlightVersion;
    const source = props.result.kind === "code" ? props.result.text : "";
    const lang = codeLang.value;
    if (!lang || !source) {
      highlighted.value = null;
      return;
    }
    const result = await highlightLines(source, lang);
    if (current === highlightVersion) {
      highlighted.value = result;
    }
  },
  { immediate: true },
);

const diff = computed(() => props.result.kind === "diff" ? toolFileDiff(props.result.before, props.result.after) : null);
const diffPath = computed(() => (props.result.kind === "diff" ? props.result.path : undefined));
const replacementLines = computed(() => props.result.kind === "replacement" ? [
  ...codeLines(props.result.before).map((text) => ({ kind: "del", text })),
  ...codeLines(props.result.after).map((text) => ({ kind: "add", text })),
] : []);
/** 终端输出带 ANSI 色时按片段着色渲染，否则保持纯文本 */
const terminalSpans = computed(() => {
  if (props.result.kind !== "terminal" || !hasAnsi(props.result.text)) {
    return null;
  }
  return ansiToSpans(props.result.text);
});
</script>

<template>
  <div class="tool-result" :data-kind="result.kind">
    <template v-if="result.kind === 'terminal'">
      <pre v-if="terminalSpans" class="tool-output" :aria-label="t('chat.tool.terminalOutput')"><template
          v-for="(span, index) in terminalSpans"
          :key="index"
        ><span :class="span.cls" :style="span.style">{{ span.text }}</span></template></pre>
      <pre v-else-if="result.text" class="tool-output" :aria-label="t('chat.tool.terminalOutput')">{{ result.text }}</pre>
      <p v-else class="tool-result-note">{{ t("chat.tool.noTerminalOutput") }}</p>
      <pre v-if="result.error" class="tool-output tool-result-error">{{ result.error }}</pre>
      <div v-if="result.exitCode != null" class="tool-result-footer" :class="{ 'tool-result-error': result.exitCode !== 0 }">
        {{ t("chat.tool.exitCode", { code: result.exitCode }) }}
      </div>
    </template>
    <template v-else-if="result.kind === 'code'">
      <p v-if="result.note" class="tool-result-note">{{ result.note }}</p>
      <div v-if="lines.length" class="tool-code" role="figure" :aria-label="t('chat.tool.fileCode')">
        <div v-for="(line, index) in lines" :key="index" class="tool-code-line">
          <span class="tool-line-number" aria-hidden="true">{{ index + 1 }}</span>
          <!-- shiki 每行 HTML（双主题 CSS 变量），未就绪/未知语言回落纯文本 -->
          <pre v-if="highlighted?.[index] != null" class="tool-code-hl" v-html="highlighted[index]" />
          <pre v-else>{{ line || '\u200b' }}</pre>
        </div>
      </div>
      <p v-else class="tool-result-note">{{ t("chat.tool.emptyFile") }}</p>
    </template>
    <template v-else-if="diff">
      <div v-if="diff.patch" class="tool-diff-result">
        <div class="tool-result-footer">
          <span class="tool-added">+{{ diff.added }}</span>
          <span class="tool-deleted">-{{ diff.removed }}</span>
        </div>
        <DiffView :diff="diff.patch" :path="diffPath" />
      </div>
      <p v-else class="tool-result-note">{{ t("chat.tool.fileUnchanged") }}</p>
    </template>
    <template v-else-if="result.kind === 'replacement'">
      <p class="tool-result-note">{{ t("chat.tool.replacementSummary", { n: result.replacements }) }}</p>
      <div class="tool-code" role="figure" :aria-label="t('chat.tool.replacementSnippet')">
        <div v-for="(line, index) in replacementLines" :key="index" class="tool-code-line" :data-change="line.kind">
          <span class="tool-line-number" aria-hidden="true">{{ line.kind === 'add' ? '+' : '-' }}</span>
          <pre>{{ line.text || '\u200b' }}</pre>
        </div>
      </div>
    </template>
    <pre v-else-if="result.kind === 'text' && result.text" class="tool-output">{{ result.text }}</pre>
    <p v-else class="tool-result-note">{{ t("chat.tool.noOutput") }}</p>
  </div>
</template>

<style scoped>
.tool-result {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  max-height: 360px;
  overflow: auto;
  margin: 4px 0 6px;
  border: 1px solid var(--color-line-soft);
  border-radius: var(--radius-sm);
  background: var(--color-code-bg);
  color: var(--color-code-fg);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.7;
}

.tool-output {
  margin: 0;
  padding: 10px 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.tool-result-note,
.tool-result-footer {
  display: flex;
  gap: 8px;
  margin: 0;
  padding: 6px 12px;
  color: var(--color-mut);
  font-family: var(--font-sans);
  font-size: 11px;
}

.tool-result-error { color: var(--color-err); }
.tool-added { color: var(--color-add); }
.tool-deleted { color: var(--color-del); }

/* ANSI 布尔修饰（颜色由解析器内联 style 输出） */
.tool-output .ansi-b { font-weight: 600; }
.tool-output .ansi-dim { opacity: 0.6; }
.tool-output .ansi-i { font-style: italic; }
.tool-output .ansi-u { text-decoration: underline; }
.tool-output .ansi-strike { text-decoration: line-through; }

.tool-code { padding: 8px 0; }
.tool-code-line { display: flex; align-items: flex-start; min-width: 0; }
.tool-line-number {
  flex: 0 0 5ch;
  padding-right: 12px;
  color: var(--color-dim);
  text-align: right;
  user-select: none;
}
.tool-code-line pre {
  flex: 1;
  min-width: 0;
  margin: 0;
  padding-right: 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  tab-size: 2;
}
/* shiki 高亮行：token 双主题 CSS 变量，按深浅取用（与 markdown 代码块同规则） */
.tool-code-line .tool-code-hl {
  color: var(--color-code-fg);
}
.tool-code-line .tool-code-hl :deep(span) {
  color: var(--shiki-light, var(--color-code-fg));
}
:global(.dark) .tool-code-line .tool-code-hl :deep(span) {
  color: var(--shiki-dark, var(--color-code-fg));
}
.tool-code-line[data-change="add"] { color: var(--color-add); background: color-mix(in srgb, var(--color-add) 12%, transparent); }
.tool-code-line[data-change="del"] { color: var(--color-del); background: color-mix(in srgb, var(--color-del) 12%, transparent); }
.tool-diff-result :deep([role="figure"]) { border: 0; border-radius: 0; overflow: visible; }
</style>
