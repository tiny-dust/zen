<script setup lang="ts">
import { computed } from "vue";

/** 统一 diff 的行模型 */
interface DiffLine {
  kind: "meta" | "hunk" | "add" | "del" | "ctx";
  oldNo: number | null;
  newNo: number | null;
  text: string;
}

const props = defineProps<{ diff: string }>();

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
    // "\ No newline at end of file" / 截断提示等杂项：退出 hunk 语境按元信息展示
    inHunk = false;
    result.push({ kind: "meta", oldNo: null, newNo: null, text: raw });
  }
  return result;
});

function gutter(value: number | null): string {
  return value == null ? "" : String(value);
}
</script>

<template>
  <div
    class="min-h-0 flex-1 overflow-auto rounded-md border border-[var(--color-line-soft)] bg-[var(--color-code-bg)] px-1 py-1.5 font-[family-name:var(--font-mono)] text-[10.5px] leading-[1.6] text-[var(--color-code-fg)]"
    role="figure"
    aria-label="文件 diff"
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
      <span
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
