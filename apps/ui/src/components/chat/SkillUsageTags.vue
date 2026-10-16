<script setup lang="ts">
import { ChevronRight, FileText, Loader2, Plug, Sparkles } from "@lucide/vue";
import { computed, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";

import { Response } from "@/components/ai-elements/response";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogScrollContent,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAgentStore } from "@/stores/agent";
import { useChatStore } from "@/stores/chat";
import { useSkillUsageStore } from "@/stores/skill-usage";

import type { SkillFileInfo } from "@zen/shared";
import type { SkillUsageItem } from "@/stores/skill-usage";

/**
 * 输入框上方的「本会话调用」tag 行：Agent 调用了哪些技能 / MCP 服务，
 * 新调用以弹出动效出现，进行中的调用带旋转指示；再次调用触发 10s 呼吸高亮。
 * 同名技能/MCP 在 store 层已合并为一条。数据来自 skill-usage store。
 * 技能 tag 可点击：Popover 列出技能目录文件（SKILL.md 为实际注入对话的文件），
 * 悬浮文件行 HoverCard 预览内容，点击文件行打开全文 Dialog。
 */
const { t } = useI18n();
const chatStore = useChatStore();
const usageStore = useSkillUsageStore();
const agentStore = useAgentStore();

const entries = computed(() => usageStore.entriesOf(chatStore.sessionId));

/** 技能名 → 技能目录（agentStore.skills 为 listSkills 扫描结果） */
function dirOf(item: SkillUsageItem): string | null {
  const summary = agentStore.skills.find(
    (skill) =>
      skill.name === item.name || skill.dir.split(/[\\/]/).pop() === item.name,
  );
  return summary?.dir ?? null;
}

interface TagListState {
  status: "loading" | "ready" | "missing" | "error";
  dir: string;
  files: SkillFileInfo[];
  error?: string;
}

/** 每 tag 的文件列表状态（popover 打开时懒加载） */
const listByTag = reactive<Record<string, TagListState>>({});

interface FileContentState {
  loading: boolean;
  error?: string;
  content?: string;
  truncated?: boolean;
}

/** 文件内容缓存（悬浮预览与全文 Dialog 共用）：key = dir + \u0000 + path */
const contentByFile = reactive<Record<string, FileContentState>>({});

/** 全文 Dialog 当前文件；非 null 即打开 */
const dialogFile = ref<{ name: string; dir: string; path: string } | null>(null);

const dialogContent = computed<FileContentState | null>(() => {
  if (!dialogFile.value) {
    return null;
  }
  return contentByFile[fileKey(dialogFile.value.dir, dialogFile.value.path)] ?? null;
});

function fileKey(dir: string, path: string): string {
  return `${dir}\u0000${path}`;
}

function previewOf(dir: string, path: string): FileContentState | null {
  return contentByFile[fileKey(dir, path)] ?? null;
}

/** popover 打开：按展示名解析技能目录并枚举文件（幂等，仅首次拉取） */
async function ensureFiles(item: SkillUsageItem): Promise<void> {
  if (listByTag[item.key]) {
    return;
  }
  const dir = dirOf(item);
  if (!dir) {
    listByTag[item.key] = { status: "missing", dir: "", files: [] };
    return;
  }
  listByTag[item.key] = { status: "loading", dir, files: [] };
  try {
    const files = await agentStore.skillFiles(dir);
    // 合法技能目录必然含 SKILL.md；空结果＝目录已不存在/不在允许根下
    listByTag[item.key].status = files.length ? "ready" : "missing";
    listByTag[item.key].files = files;
  } catch (error) {
    listByTag[item.key].status = "error";
    listByTag[item.key].error = error instanceof Error ? error.message : String(error);
  }
}

/** 悬浮/点击文件行：懒加载内容（幂等，仅首次拉取） */
async function ensureContent(dir: string, path: string): Promise<void> {
  const key = fileKey(dir, path);
  if (contentByFile[key]) {
    return;
  }
  contentByFile[key] = { loading: true };
  const result = await agentStore.readSkillFile(dir, path);
  if (!result) {
    contentByFile[key] = { loading: false, error: "bridge not ready" };
    return;
  }
  if (result.ok) {
    contentByFile[key] = {
      loading: false,
      content: result.content,
      truncated: result.truncated,
    };
  } else {
    contentByFile[key] = { loading: false, error: result.error ?? "read failed" };
  }
}

function openFile(item: SkillUsageItem, dir: string, path: string): void {
  dialogFile.value = { name: item.name, dir, path };
  void ensureContent(dir, path);
}

/** 非 markdown 文件包一层围栏代码块，让 Response 走 shiki 高亮 */
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

function markdownOf(path: string, content: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
    return content;
  }
  const ext = lower.split(".").pop() ?? "";
  const lang = EXT_LANGS[ext] ?? "";
  return `\`\`\`\`${lang}\n${content}\n\`\`\`\``;
}

function formatSize(bytes: number): string {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
}

function tooltip(item: SkillUsageItem): string {
  const label =
    item.kind === "mcp"
      ? t("chat.usage.mcpService", { name: item.name })
      : t("chat.usage.skill", { name: item.name });
  const suffix =
    item.kind === "skill" ? `\n${t("chat.usage.viewFiles")}` : "";
  return `${label} · ${t("chat.usage.calls", { n: item.calls })}${suffix}`;
}

/** 再次调用呼吸高亮：交替 class 重启 CSS animation，10s 后 store 清 breathUntil */
function breathClass(item: SkillUsageItem): string {
  if (!item.breathUntil) {
    return "";
  }
  return item.breathSeq % 2 === 0 ? "usage-breath usage-breath-a" : "usage-breath usage-breath-b";
}
</script>

<template>
  <template v-if="entries.length">
    <TransitionGroup
      tag="div"
      name="usage"
      class="mb-2 flex flex-wrap items-center gap-1.5"
      :aria-label="t('chat.usage.label')"
    >
      <template v-for="item in entries" :key="item.key">
        <!-- 技能 tag：点击弹出技能文件列表 -->
        <Popover v-if="item.kind === 'skill'" @update:open="(open: boolean) => open && ensureFiles(item)">
          <PopoverTrigger as-child>
            <button
              type="button"
              class="inline-flex cursor-pointer items-center gap-1 rounded-full border border-[var(--color-line)] bg-[var(--color-chip-bg)] px-2 py-[3px] text-[11px] text-[var(--color-mut)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-txt-strong)]"
              :class="[item.running ? 'text-[var(--color-txt-strong)]' : '', breathClass(item)]"
              :title="tooltip(item)"
            >
              <Loader2 v-if="item.running" class="size-3 animate-spin" aria-hidden="true" />
              <Sparkles v-else class="size-3" aria-hidden="true" />
              <span class="max-w-[160px] truncate leading-none">{{ item.name }}</span>
              <span
                v-if="item.calls > 1"
                class="text-[10px] leading-none text-[var(--color-dim)]"
              >×{{ item.calls }}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" class="w-80 p-0">
            <div
              class="flex items-center justify-between gap-2 border-b border-[var(--color-line)] px-3 py-2"
            >
              <span class="flex min-w-0 items-center gap-1.5 text-xs font-medium text-[var(--color-txt-strong)]">
                <Sparkles class="size-3 shrink-0" aria-hidden="true" />
                <span class="truncate">{{ item.name }}</span>
              </span>
              <span
                v-if="listByTag[item.key]?.status === 'ready'"
                class="shrink-0 text-[10px] text-[var(--color-dim)]"
              >{{ t("chat.usage.fileCount", { n: listByTag[item.key].files.length }) }}</span>
            </div>
            <div class="max-h-64 overflow-y-auto p-1">
              <div
                v-if="!listByTag[item.key] || listByTag[item.key].status === 'loading'"
                class="flex items-center gap-2 px-2 py-3 text-xs text-[var(--color-dim)]"
              >
                <Loader2 class="size-3 animate-spin" aria-hidden="true" />
                {{ t("chat.usage.loading") }}
              </div>
              <div
                v-else-if="listByTag[item.key].status === 'missing'"
                class="px-2 py-3 text-xs text-[var(--color-dim)]"
              >
                {{ t("chat.usage.missing") }}
              </div>
              <div
                v-else-if="listByTag[item.key].status === 'error'"
                class="px-2 py-3 text-xs text-[var(--color-danger, var(--color-txt-strong))]"
              >
                {{ t("chat.usage.readError", { error: listByTag[item.key].error }) }}
              </div>
              <template v-else>
                <HoverCard
                  v-for="file in listByTag[item.key].files"
                  :key="file.path"
                  :open-delay="250"
                  @update:open="
                    (open: boolean) => open && ensureContent(listByTag[item.key].dir, file.path)
                  "
                >
                  <HoverCardTrigger as-child>
                    <button
                      type="button"
                      class="group flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-[var(--color-chip-bg)] focus-visible:outline-hidden"
                      @click="openFile(item, listByTag[item.key].dir, file.path)"
                    >
                      <FileText class="size-3.5 shrink-0 text-[var(--color-dim)]" aria-hidden="true" />
                      <span class="min-w-0 flex-1 truncate text-[var(--color-txt)]">{{ file.path }}</span>
                      <span class="shrink-0 text-[10px] text-[var(--color-dim)]">{{ formatSize(file.size) }}</span>
                      <Badge
                        v-if="file.path === 'SKILL.md'"
                        variant="secondary"
                        class="h-4 shrink-0 px-1.5 text-[10px]"
                      >{{ t("chat.usage.injected") }}</Badge>
                      <ChevronRight
                        class="size-3 shrink-0 text-[var(--color-dim)] opacity-0 transition-opacity group-hover:opacity-100"
                        aria-hidden="true"
                      />
                    </button>
                  </HoverCardTrigger>
                  <HoverCardContent
                    align="start"
                    class="w-96 max-w-[calc(100vw-2rem)] p-0"
                  >
                    <div class="max-h-72 overflow-y-auto p-3 text-xs">
                      <template v-if="previewOf(listByTag[item.key].dir, file.path)">
                        <div
                          v-if="previewOf(listByTag[item.key].dir, file.path)!.loading"
                          class="flex items-center gap-2 text-[var(--color-dim)]"
                        >
                          <Loader2 class="size-3 animate-spin" aria-hidden="true" />
                          {{ t("chat.usage.loading") }}
                        </div>
                        <template v-else-if="previewOf(listByTag[item.key].dir, file.path)!.error">
                          {{ t("chat.usage.readError", { error: previewOf(listByTag[item.key].dir, file.path)!.error }) }}
                        </template>
                        <template v-else>
                          <Response
                            :content="markdownOf(file.path, previewOf(listByTag[item.key].dir, file.path)!.content ?? '')"
                            class="text-xs"
                          />
                          <div
                            v-if="previewOf(listByTag[item.key].dir, file.path)!.truncated"
                            class="mt-2 text-[10px] text-[var(--color-dim)]"
                          >
                            {{ t("chat.usage.truncated") }}
                          </div>
                        </template>
                      </template>
                      <div v-else class="text-[var(--color-dim)]">{{ t("chat.usage.loading") }}</div>
                    </div>
                  </HoverCardContent>
                </HoverCard>
                <div class="px-2 pt-1 pb-0.5 text-[10px] text-[var(--color-dim)]">
                  {{ t("chat.usage.previewHint") }}
                </div>
              </template>
            </div>
          </PopoverContent>
        </Popover>
        <span
          v-else
          class="inline-flex items-center gap-1 rounded-full border border-[var(--color-line)] bg-[var(--color-chip-bg)] px-2 py-[3px] text-[11px] text-[var(--color-mut)]"
          :class="[item.running ? 'text-[var(--color-txt-strong)]' : '', breathClass(item)]"
          :title="tooltip(item)"
        >
          <Loader2 v-if="item.running" class="size-3 animate-spin" aria-hidden="true" />
          <Plug v-else class="size-3" aria-hidden="true" />
          <span class="max-w-[160px] truncate leading-none">{{ item.name }}</span>
          <span
            v-if="item.calls > 1"
            class="text-[10px] leading-none text-[var(--color-dim)]"
          >×{{ item.calls }}</span>
        </span>
      </template>
    </TransitionGroup>

    <!-- 文件全文 Dialog（点击文件行打开） -->
    <Dialog
      :open="dialogFile !== null"
      @update:open="(open: boolean) => !open && (dialogFile = null)"
    >
      <DialogScrollContent class="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle class="font-mono text-left text-sm">{{ dialogFile?.path }}</DialogTitle>
          <DialogDescription v-if="dialogFile" class="text-left text-xs">
            {{ t("chat.usage.dialogDesc", { name: dialogFile.name }) }}
          </DialogDescription>
        </DialogHeader>
        <div class="max-h-[65vh] overflow-y-auto pr-1">
          <div
            v-if="!dialogContent || dialogContent.loading"
            class="flex items-center gap-2 py-6 text-xs text-[var(--color-dim)]"
          >
            <Loader2 class="size-3 animate-spin" aria-hidden="true" />
            {{ t("chat.usage.loading") }}
          </div>
          <div
            v-else-if="dialogContent.error"
            class="py-6 text-xs text-[var(--color-danger, var(--color-txt-strong))]"
          >
            {{ t("chat.usage.readError", { error: dialogContent.error }) }}
          </div>
          <template v-else>
            <Response
              :content="markdownOf(dialogFile!.path, dialogContent.content ?? '')"
              class="text-[13px]"
            />
            <div
              v-if="dialogContent.truncated"
              class="mt-2 text-[10px] text-[var(--color-dim)]"
            >
              {{ t("chat.usage.truncated") }}
            </div>
          </template>
        </div>
      </DialogScrollContent>
    </Dialog>
  </template>
</template>

<style scoped>
/* 新 tag 弹出：上浮 + 轻微放大；只动位移与透明度（规范：动效走 token） */
.usage-enter-active {
  transition:
    opacity var(--motion-base) var(--ease-emph),
    transform var(--motion-base) var(--ease-emph);
}
.usage-enter-from {
  opacity: 0;
  transform: translateY(6px) scale(0.9);
}
.usage-leave-active {
  transition: opacity var(--motion-fast) var(--ease-exit);
}
.usage-leave-to {
  opacity: 0;
}
.usage-move {
  transition: transform var(--motion-base) var(--ease-emph);
}

/* 再次调用呼吸高亮：边框/底色在 accent 与常色间周期变化；交替 class 重启 animation */
@keyframes usage-breathe {
  0%,
  100% {
    border-color: var(--color-line);
    background-color: var(--color-chip-bg);
  }
  50% {
    border-color: var(--color-accent);
    background-color: color-mix(in srgb, var(--color-accent) 14%, var(--color-chip-bg));
  }
}
.usage-breath-a,
.usage-breath-b {
  animation: usage-breathe 1.4s ease-in-out infinite;
}
</style>
