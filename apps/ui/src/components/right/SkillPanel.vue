<script setup lang="ts">
import { FileText, Loader2, Sparkles } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import { Response } from "@/components/ai-elements/response";
import { Badge } from "@/components/ui/badge";
import { useAgentStore } from "@/stores/agent";
import { useRightPanelStore } from "@/stores/right-panel";

import type { SkillFileInfo } from "@zen/shared";

/**
 * 右栏「技能」面板：输入框技能 tag 点击后打开，展示该技能目录文件与文档正文。
 * 默认选中 SKILL.md（实际注入对话的文件），点其它文件切换查看。
 */
const { t } = useI18n();
const rightPanel = useRightPanelStore();
const agentStore = useAgentStore();
const { skillPreview } = storeToRefs(rightPanel);

const files = ref<SkillFileInfo[]>([]);
const loadingFiles = ref(false);
const filesError = ref("");
const activePath = ref("SKILL.md");
const content = ref("");
const contentLoading = ref(false);
const contentError = ref("");
const truncated = ref(false);

/** 非 markdown 文件包一层围栏代码块，让 Response 走代码高亮 */
const EXT_LANGS: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  py: "python",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  json: "json",
  yml: "yaml",
  yaml: "yaml",
  html: "html",
  css: "css",
  toml: "toml",
  txt: "",
};

const markdown = computed(() => {
  const lower = activePath.value.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
    return content.value;
  }
  const ext = lower.split(".").pop() ?? "";
  return `\`\`\`\`${EXT_LANGS[ext] ?? ""}\n${content.value}\n\`\`\`\``;
});

function formatSize(bytes: number): string {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
}

async function loadFile(dir: string, path: string): Promise<void> {
  activePath.value = path;
  content.value = "";
  contentError.value = "";
  truncated.value = false;
  if (!dir) {
    return;
  }
  contentLoading.value = true;
  try {
    const result = await agentStore.readSkillFile(dir, path);
    if (!result) {
      contentError.value = t("chat.usage.missing");
      return;
    }
    if (result.ok) {
      content.value = result.content ?? "";
      truncated.value = Boolean(result.truncated);
    } else {
      contentError.value = result.error ?? t("chat.usage.missing");
    }
  } finally {
    contentLoading.value = false;
  }
}

/** 切换技能：重新枚举目录文件并载入 SKILL.md */
async function loadSkill(dir: string): Promise<void> {
  files.value = [];
  filesError.value = "";
  content.value = "";
  contentError.value = "";
  activePath.value = "SKILL.md";
  if (!dir) {
    return;
  }
  loadingFiles.value = true;
  try {
    const list = await agentStore.skillFiles(dir);
    files.value = list;
    if (!list.length) {
      filesError.value = t("chat.usage.missing");
      return;
    }
    const first = list.find((item) => item.path === "SKILL.md") ?? list[0];
    if (first) {
      await loadFile(dir, first.path);
    }
  } catch (error) {
    filesError.value = error instanceof Error ? error.message : t("chat.usage.missing");
  } finally {
    loadingFiles.value = false;
  }
}

watch(
  () => skillPreview.value?.dir,
  (dir) => void loadSkill(dir ?? ""),
  { immediate: true },
);
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden">
    <p v-if="!skillPreview" class="m-0 px-1 py-3 text-[12px] text-[var(--color-mut)]">
      {{ t("app.skill.empty") }}
    </p>
    <template v-else>
      <div class="flex flex-none items-center gap-1.5 px-1">
        <Sparkles class="size-3.5 flex-none text-[var(--color-accent)]" aria-hidden="true" />
        <span class="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--color-txt-strong)]">
          {{ skillPreview.name }}
        </span>
      </div>
      <p
        v-if="filesError"
        class="m-0 px-1 text-[11px] text-[var(--color-err)]"
        role="alert"
      >
        {{ filesError }}
      </p>

      <div
        v-if="files.length > 1"
        class="flex flex-none flex-wrap gap-1 px-1"
      >
        <button
          v-for="file in files"
          :key="file.path"
          type="button"
          class="inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-[3px] text-[11px] transition-colors"
          :class="
            file.path === activePath
              ? 'border-[var(--color-accent)] bg-[var(--color-menu-active)] text-[var(--color-txt-strong)]'
              : 'border-[var(--color-line)] bg-[var(--color-chip-bg)] text-[var(--color-mut)] hover:text-[var(--color-txt)]'
          "
          :title="`${file.path} · ${formatSize(file.size)}`"
          @click="loadFile(skillPreview.dir, file.path)"
        >
          <FileText class="size-3 shrink-0" aria-hidden="true" />
          <span class="min-w-0 truncate">{{ file.path }}</span>
          <Badge
            v-if="file.path === 'SKILL.md'"
            variant="secondary"
            class="h-3.5 shrink-0 px-1 text-[9px]"
          >{{ t("chat.usage.injected") }}</Badge>
        </button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-1 pb-1">
        <div v-if="loadingFiles || contentLoading" class="flex items-center gap-1.5 py-3 text-[12px] text-[var(--color-dim)]">
          <Loader2 class="size-3 animate-spin" aria-hidden="true" />
          {{ t("chat.usage.loading") }}
        </div>
        <p
          v-else-if="contentError"
          class="m-0 py-3 text-[12px] text-[var(--color-err)]"
          role="alert"
        >
          {{ contentError }}
        </p>
        <template v-else-if="content">
          <Response :content="markdown" class="text-[12px]" />
          <p v-if="truncated" class="m-0 mt-2 text-[10px] text-[var(--color-dim)]">
            {{ t("chat.usage.truncated") }}
          </p>
        </template>
      </div>
    </template>
  </div>
</template>
