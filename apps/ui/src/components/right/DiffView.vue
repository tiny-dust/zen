<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import { highlightLines, langFromPath } from "@/lib/shiki-highlight";

import type { BundledLanguage } from "shiki";

/** 统一 diff 的行模型 */
interface DiffLine {
  kind: "meta" | "hunk" | "add" | "del" | "ctx";
  oldNo: number | null;
  newNo: number | null;
  text: string;
}

const props = defineProps<{
  diff: string;
  /** 目标文件路径：传入时 diff 行按扩展名做语法高亮 */
  path?: string;
}>();

const { t } = useI18n();

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

const lines = computed<DiffLine[]>(() => {
  const source = props.diff.replace(/\n$/, "");
  if (!source.trim()) {
    return [];
  }
  const result: DiffLine[] = [];
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;
  for (const raw of source.split("\n")) {
    if (raw.startsWith("@@ ")) {
      inHunk = true;
      const match = HUNK_RE.exec(raw);
      if (match) {
        oldNo = Number(match[1]);
        newNo = Number(match[2]);
      }
      result.push({ kind: "hunk", oldNo: null, newNo: null, text: raw });
      continue;
    }
    if (!inHunk) {
      // 首个 hunk 之前的文件头（diff --git / index / --- / +++ / Binary files…）
      result.push({ kind: "meta", oldNo: null, newNo: null, text: raw });
      continue;
    }
    if (raw.startsWith("+")) {
      result.push({ kind: "add", oldNo: null, newNo, text: raw.slice(1) });
      newNo += 1;
      continue;
    }
    if (raw.startsWith("-")) {
      result.push({ kind: "del", oldNo, newNo: null, text: raw.slice(1) });
      oldNo += 1;
      continue;
    }
    if (raw.startsWith(" ") || raw === "") {
      result.push({ kind: "ctx", oldNo, newNo, text: raw.slice(1) });
      oldNo += 1;
      newNo += 1;
      continue;
    }
    // A missing-newline marker annotates the preceding line, not the end of the hunk.
    if (raw !== "\\ No newline at end of file") inHunk = false;
    result.push({ kind: "meta", oldNo: null, newNo: null, text: raw });
  }
  return result;
});

// ---------- 语法高亮：del/ctx 行取 before 侧、add/ctx 行取 after 侧按行号映射 ----------

/**
 * 行号 → 高亮 HTML。before/after 全文整段高亮后按行拆分，
 * 多行 token（块注释/模板串）的着色因此保持正确。
 */
const hlBefore = ref<Map<number, string> | null>(null);
const hlAfter = ref<Map<number, string> | null>(null);
let hlVersion = 0;

async function runHighlight() {
  const current = ++hlVersion;
  const lang: BundledLanguage | undefined = langFromPath(props.path);
  if (!lang) {
    hlBefore.value = null;
    hlAfter.value = null;
    return;
  }
  // diff 文本自带行号（old/new），据此从两侧高亮结果取对应行
  const beforeText = lines.value
    .filter((line) => line.kind === "del" || line.kind === "ctx")
    .map((line) => line.text)
    .join("\n");
  const afterText = lines.value
    .filter((line) => line.kind === "add" || line.kind === "ctx")
    .map((line) => line.text)
    .join("\n");
  const [beforeLines, afterLines] = await Promise.all([
    beforeText ? highlightLines(beforeText, lang) : null,
    afterText ? highlightLines(afterText, lang) : null,
  ]);
  if (current !== hlVersion) {
    return;
  }
  const buildMap = (source: DiffLine[], html: string[] | null, side: "old" | "new") => {
    if (!html) {
      return null;
    }
    // hunk 行号在文件内不连续；按出现顺序把高亮行配给带行号的 diff 行
    let cursor = 0;
    const map = new Map<number, string>();
    for (const line of source) {
      const no = side === "old" ? line.oldNo : line.newNo;
      if (no == null) {
        continue;
      }
      const html2 = html[cursor];
      if (html2 != null) {
        map.set(no, html2);
      }
      cursor += 1;
    }
    return map;
  };
  hlBefore.value = buildMap(lines.value, beforeLines, "old");
  hlAfter.value = buildMap(lines.value, afterLines, "new");
}

watch(() => [props.diff, props.path], () => void runHighlight(), { immediate: true });

function lineHtml(line: DiffLine): string | undefined {
  if (line.kind === "del" || line.kind === "ctx") {
    const html = hlBefore.value?.get(line.oldNo ?? -1);
    if (html != null) return html;
  }
  if (line.kind === "add" || line.kind === "ctx") {
    const html = hlAfter.value?.get(line.newNo ?? -1);
    if (html != null) return html;
  }
  return undefined;
}

function gutter(value: number | null): string {
  return value == null ? "" : String(value);
}
</script>

<template>
  <div
    class="min-h-0 flex-1 overflow-auto rounded-md border border-[var(--color-line-soft)] bg-[var(--color-code-bg)] px-1 py-1.5 font-[family-name:var(--font-mono)] text-[10px] leading-[1.6] text-[var(--color-code-fg)]"
    role="figure"
    :aria-label="t('panels.fileDiff')"
  >
    <div
      v-for="(line, index) in lines"
      :key="index"
      class="flex items-start gap-1.5 rounded-[3px] px-1"
      :class="{
        'bg-[color-mix(in_srgb,var(--color-add)_12%,transparent)]': line.kind === 'add',
        'bg-[color-mix(in_srgb,var(--color-del)_12%,transparent)]': line.kind === 'del',
      }"
    >
      <span
        v-if="line.kind !== 'meta'"
        class="w-8 flex-none select-none text-right text-[var(--color-dim)]"
      >{{ gutter(line.oldNo) }}</span>
      <span
        v-if="line.kind !== 'meta'"
        class="w-8 flex-none select-none text-right text-[var(--color-dim)]"
      >{{ gutter(line.newNo) }}</span>
      <span
        v-if="line.kind === 'add' || line.kind === 'del'"
        class="w-2 flex-none select-none"
        :class="line.kind === 'add' ? 'text-[var(--color-add)]' : 'text-[var(--color-del)]'"
      >{{ line.kind === 'add' ? '+' : '-' }}</span>
      <!-- 高亮命中时渲染 shiki 行 HTML（token 颜色走 --shiki-light/--shiki-dark），否则纯文本 -->
      <span
        v-if="lineHtml(line) != null"
        class="diff-hl min-w-0 flex-1 break-all whitespace-pre-wrap"
        :class="{
          'text-[var(--color-add)]': line.kind === 'add',
          'text-[var(--color-del)]': line.kind === 'del',
          'text-[var(--color-dim)]': line.kind === 'meta',
          'text-[var(--color-accent-2)]': line.kind === 'hunk',
        }"
        v-html="lineHtml(line)"
      />
      <span
        v-else
        class="min-w-0 flex-1 break-all whitespace-pre-wrap"
        :class="{
          'text-[var(--color-add)]': line.kind === 'add',
          'text-[var(--color-del)]': line.kind === 'del',
          'text-[var(--color-dim)]': line.kind === 'meta',
          'text-[var(--color-accent-2)]': line.kind === 'hunk',
        }"
      >{{ line.text }}</span>
    </div>
  </div>
</template>

<style scoped>
/* shiki token 双主题取色（与 markdown 代码块同规则；v-html 内容需 :deep） */
.diff-hl :deep(span) {
  color: var(--shiki-light, inherit);
}
:global(.dark) .diff-hl :deep(span) {
  color: var(--shiki-dark, inherit);
}
</style>
