<script setup lang="ts">
import { ExternalLink, FolderOpen, Loader2, PackagePlus, RefreshCw, Search, ShieldCheck, Trash2, Upload } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useBrowserOverlayGuard } from "@/composables/useBrowserOverlayGuard";
import { useAgentStore } from "@/stores/agent";
import { useChatStore } from "@/stores/chat";
import { useWorkspaceStore } from "@/stores/workspace";
import { skillSourceLabel } from "@/lib/skill-source";

import type { SkillMarketHit, SkillSummary, SkillUpdateInfo } from "@zen/shared";

const open = defineModel<boolean>("open", { default: false });

type SkillUpdateResult = { state: "updating" | "ok" | "error"; message: string };

const agentStore = useAgentStore();
const { skills, settings } = storeToRefs(agentStore);

const { t } = useI18n();

type Tab = "installed" | "market";
const tab = ref<Tab>("installed");
const marketQuery = ref("");
const marketItems = ref<SkillMarketHit[]>([]);
const marketLoading = ref(false);
const marketError = ref("");
const busyId = ref("");
const statusMsg = ref("");
const newSkillPath = ref("");
const refreshing = ref(false);
const updateMap = ref<Record<string, SkillUpdateInfo>>({});
const resultMap = ref<Record<string, SkillUpdateResult>>({});
const batchRunning = ref(false);
const batchProgress = ref({ done: 0, total: 0 });

// 弹窗浮在内嵌浏览器之上时会被原生视图盖住，打开期间压制浏览器视图
useBrowserOverlayGuard(open);

/** 同名技能只保留一条（与 listSkills 去重优先级一致：先出现的胜出） */
function dedupeByName<T extends { name: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = item.name.trim().toLowerCase();
    if (key && seen.has(key)) {
      continue;
    }
    if (key) {
      seen.add(key);
    }
    result.push(item);
  }
  return result;
}

const installedSkills = computed(() => dedupeByName(skills.value));
const displayMarketItems = computed(() => dedupeByName(marketItems.value));

/** 已安装列表本地过滤：按名称 / 描述 / 目录匹配 */
const installedQuery = ref("");
const filteredSkills = computed(() => {
  const query = installedQuery.value.trim().toLowerCase();
  if (!query) {
    return installedSkills.value;
  }
  return installedSkills.value.filter(
    (skill) =>
      skill.name.toLowerCase().includes(query) ||
      (skill.description ?? "").toLowerCase().includes(query) ||
      skill.dir.toLowerCase().includes(query),
  );
});

/** 市场 hit 是否已安装：hit.skillId / hit.name 与本地技能 id/name（含目录尾段）比对 */
function isInstalledHit(hit: SkillMarketHit): boolean {
  const skillId = hit.skillId.trim().toLowerCase();
  const name = hit.name.trim().toLowerCase();
  return skills.value.some((skill) => {
    const id = skill.id.replace(/\\/g, "/").toLowerCase();
    const base = id.split("/").filter(Boolean).pop() ?? id;
    const localName = skill.name.trim().toLowerCase();
    return (
      base === skillId ||
      localName === skillId ||
      base === name ||
      localName === name
    );
  });
}

function updateOf(skill: SkillSummary): SkillUpdateInfo | undefined {
  return updateMap.value[skill.id];
}

function resultOf(skill: SkillSummary): SkillUpdateResult | undefined {
  return resultMap.value[skill.id];
}

function truncateText(text: string, max = 80): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function resultText(skill: SkillSummary): string {
  const result = resultMap.value[skill.id];
  if (!result) {
    return "";
  }
  if (result.state === "updating") {
    return t("sidebar.skillsDialog.updating");
  }
  if (result.state === "ok") {
    return t("sidebar.skillsDialog.updateOk");
  }
  return result.message
    ? t("sidebar.skillsDialog.updateFailedWith", { message: truncateText(result.message) })
    : t("sidebar.skillsDialog.updateFailed");
}

function resultCls(skill: SkillSummary): string {
  const state = resultMap.value[skill.id]?.state;
  if (state === "ok") {
    return "text-[var(--color-ok)]";
  }
  if (state === "error") {
    return "text-[var(--color-danger-fg)]";
  }
  return "text-[var(--color-mut)]";
}

const updatableSkills = computed(() =>
  installedSkills.value.filter((skill) => updateOf(skill)?.hasUpdate),
);

watch(open, (value) => {
  if (!value) {
    return;
  }
  statusMsg.value = "";
  resultMap.value = {};
  installedQuery.value = "";
  void refreshAll();
  void agentStore.refreshMcp();
});

/** 刷新序号：打开弹窗与手动刷新可能并发触发，仅最新一轮的结果生效 */
let refreshSeq = 0;

/** 刷新：本地重扫 + 查询上游是否可更新 */
async function refreshAll() {
  const seq = ++refreshSeq;
  refreshing.value = true;
  statusMsg.value = t("sidebar.skillsDialog.refreshingAndChecking");
  try {
    await agentStore.refreshSkills();
    const zen = window.zen;
    if (!zen?.skills?.marketCheckUpdates) {
      if (seq === refreshSeq) {
        updateMap.value = {};
        statusMsg.value = t("sidebar.skillsDialog.refreshedLocal");
      }
      return;
    }
    // skills 是响应式代理，IPC 结构化克隆不支持 Proxy，必须传纯对象
    const plain = skills.value.map((skill) => ({ ...skill }));
    const result = await zen.skills.marketCheckUpdates(plain);
    // 已有更新的刷新在跑，丢弃过期结果
    if (seq !== refreshSeq) {
      return;
    }
    const map: Record<string, SkillUpdateInfo> = {};
    for (const item of result.items ?? []) {
      map[item.id] = item;
    }
    updateMap.value = map;
    const updatable = (result.items ?? []).filter((item) => item.hasUpdate);
    if (!result.ok) {
      statusMsg.value = result.error || t("sidebar.skillsDialog.updateCheckFailed");
    } else if (updatable.length) {
      statusMsg.value = t("sidebar.skillsDialog.foundUpdatable", { n: updatable.length });
    } else {
      statusMsg.value = t("sidebar.skillsDialog.upToDate");
    }
  } catch (error) {
    if (seq !== refreshSeq) {
      return;
    }
    updateMap.value = {};
    statusMsg.value = error instanceof Error ? error.message : String(error);
  } finally {
    if (seq === refreshSeq) {
      refreshing.value = false;
    }
  }
}

async function searchMarket() {
  const zen = window.zen;
  if (!zen?.skills) {
    marketError.value = t("sidebar.skillsDialog.marketIpcUnavailable");
    return;
  }
  marketLoading.value = true;
  marketError.value = "";
  try {
    const result = await zen.skills.marketSearch(marketQuery.value.trim() || "skills");
    marketItems.value = result.items;
    if (!result.ok) {
      marketError.value = result.error || t("sidebar.skillsDialog.searchFailed");
    }
  } catch (error) {
    marketError.value = error instanceof Error ? error.message : String(error);
  } finally {
    marketLoading.value = false;
  }
}

async function installSkill(hit: SkillMarketHit) {
  const zen = window.zen;
  if (!zen?.skills) {
    return;
  }
  busyId.value = hit.id;
  statusMsg.value = t("sidebar.skillsDialog.installingSkill", { name: hit.name });
  try {
    // hit 是响应式代理，ipcRenderer.invoke 结构化克隆不支持 Proxy，必须传纯对象
    const result = await zen.skills.marketInstall({ ...hit });
    if (result.ok) {
      statusMsg.value = result.dir
        ? t("sidebar.skillsDialog.installedSkillWithDir", { name: hit.name, dir: result.dir })
        : t("sidebar.skillsDialog.installedSkill", { name: hit.name });
      await agentStore.refreshSkills();
      tab.value = "installed";
    } else {
      statusMsg.value = result.error || t("sidebar.skillsDialog.installFailed");
    }
  } catch (error) {
    statusMsg.value = error instanceof Error ? error.message : String(error);
  } finally {
    busyId.value = "";
  }
}

/** 串行执行一次市场更新，结果写入行内 resultMap；返回是否成功 */
async function runSkillUpdate(skill: SkillSummary): Promise<boolean> {
  const zen = window.zen;
  if (!zen?.skills?.marketUpdate) {
    resultMap.value[skill.id] = { state: "error", message: t("sidebar.skillsDialog.marketIpcUnavailable") };
    return false;
  }
  resultMap.value[skill.id] = { state: "updating", message: "" };
  try {
    // skill 是响应式代理，IPC 结构化克隆不支持 Proxy，必须传纯对象
    const result = await zen.skills.marketUpdate({ ...skill });
    resultMap.value[skill.id] = {
      state: result.ok ? "ok" : "error",
      message: result.ok ? "" : result.error || t("sidebar.skillsDialog.updateFailed"),
    };
    return result.ok;
  } catch (error) {
    resultMap.value[skill.id] = {
      state: "error",
      message: error instanceof Error ? error.message : String(error),
    };
    return false;
  }
}

async function updateSkill(skill: SkillSummary) {
  if (batchRunning.value) {
    return;
  }
  busyId.value = skill.id;
  try {
    await runSkillUpdate(skill);
    await refreshAll();
  } finally {
    busyId.value = "";
  }
}

/** 全部更新：串行逐个更新（避免并发 git 操作冲突），完成后汇总并刷新 */
async function updateAll() {
  if (batchRunning.value || busyId.value) {
    return;
  }
  const targets = updatableSkills.value;
  if (!targets.length) {
    return;
  }
  batchRunning.value = true;
  batchProgress.value = { done: 0, total: targets.length };
  let okCount = 0;
  try {
    for (let i = 0; i < targets.length; i++) {
      batchProgress.value = { done: i + 1, total: targets.length };
      busyId.value = targets[i].id;
      if (await runSkillUpdate(targets[i])) {
        okCount += 1;
      }
    }
    await refreshAll();
    const failCount = targets.length - okCount;
    statusMsg.value = failCount
      ? t("sidebar.skillsDialog.updatedSomeFailed", { ok: okCount, fail: failCount })
      : t("sidebar.skillsDialog.updatedCount", { n: okCount });
  } finally {
    busyId.value = "";
    batchRunning.value = false;
  }
}

async function uninstallSkill(skill: SkillSummary) {
  const zen = window.zen;
  if (!zen?.skills) {
    return;
  }
  busyId.value = skill.id;
  statusMsg.value = t("sidebar.skillsDialog.uninstallingSkill", { name: skill.name });
  try {
    // skill 是响应式代理，IPC 结构化克隆不支持 Proxy，必须传纯对象
    const result = await zen.skills.uninstall({ ...skill });
    // 先刷新列表，再写结果文案，避免 refreshAll 的状态覆盖「已卸载」反馈
    await refreshAll();
    statusMsg.value = result.ok ? t("sidebar.skillsDialog.uninstalledSkill", { name: skill.name }) : result.error || t("sidebar.skillsDialog.uninstallFailed");
  } catch (error) {
    statusMsg.value = error instanceof Error ? error.message : String(error);
  } finally {
    busyId.value = "";
  }
}

async function addSkillPath() {
  const picked = await agentStore.pickDirectory();
  const path = (picked ?? newSkillPath.value).trim();
  if (!path || settings.value.skillExtraPaths.includes(path)) {
    return;
  }
  await agentStore.updateSettings({
    skillExtraPaths: [...settings.value.skillExtraPaths, path],
  });
  newSkillPath.value = "";
  await refreshAll();
}

/** 一键分析提示词：在公共区新会话中交给 Agent，由 Agent 读取各技能 SKILL.md 后给出冲突审计 */
const ANALYZE_PROMPT = `请对本机已安装的技能（skills）做一次冲突分析：
1. 列出技能清单（名称、来源目录、一句话用途）；
2. 找出功能重叠 / 触发条件冲突的技能；
3. 找出可能抢同一条用户指令的技能组合；
4. 指出工作流矛盾（例如同时要求 TDD 与直接实现）；
5. 给出保留 / 禁用 / 合并建议。

技能目录：~/.zen/skills、~/.claude/skills、~/.agents/skills（均以含 SKILL.md 的文件夹为单位，另见用户自定义扫描目录）。请先读取各技能的 SKILL.md 了解用途与触发方式，再下结论。
输出用中文 Markdown：先给结论表，再逐条建议；不要编造不存在的技能。`;

/** 一键分析：在公共区新建会话，预填提示词并直接发送 */
async function analyzeInNewSession() {
  open.value = false;
  const workspaceStore = useWorkspaceStore();
  workspaceStore.setActive("common");
  const chat = useChatStore();
  await chat.newTask("common");
  chat.input = ANALYZE_PROMPT;
  await chat.send();
}

const tabCls = (id: Tab) =>
  id === tab.value
    ? "rounded-md bg-[var(--color-menu-active)] px-2.5 py-1 text-[12px] text-[var(--color-txt-strong)]"
    : "rounded-md px-2.5 py-1 text-[12px] text-[var(--color-mut)] hover:bg-[var(--color-menu-hover)] hover:text-[var(--color-txt-strong)]";
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      data-large-panel="true"
      class="flex h-[min(86vh,820px)] w-[min(980px,94vw)] max-w-none flex-col gap-0 overflow-hidden rounded-2xl p-0"
    >
      <DialogHeader class="flex-none border-b border-[var(--color-line-soft)] px-5 py-3.5">
        <DialogTitle class="text-[15px]">{{ t("sidebar.skillsDialog.title") }}</DialogTitle>
        <DialogDescription class="text-[12px]">
          {{ t("sidebar.skillsDialog.desc") }}
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-none items-center gap-1 border-b border-[var(--color-line-soft)] px-4 py-2.5">
        <Button
          variant="ghost"
          :class="[tabCls('installed'), tab === 'installed' ? 'hover:bg-[var(--color-menu-active)] dark:hover:bg-[var(--color-menu-active)]' : 'font-normal']"
          @click="tab = 'installed'"
        >{{ t("sidebar.skillsDialog.installed") }}</Button>
        <Button
          variant="ghost"
          :class="[tabCls('market'), tab === 'market' ? 'hover:bg-[var(--color-menu-active)] dark:hover:bg-[var(--color-menu-active)]' : 'font-normal']"
          @click="tab = 'market'"
        >{{ t("sidebar.skillsDialog.marketTab") }}</Button>
        <Button
          variant="outline"
          size="sm"
          class="ml-auto h-7 text-[12px]"
          :title="t('sidebar.skillsDialog.analyzeTitle')"
          @click="analyzeInNewSession"
        >
          <ShieldCheck class="size-3.5" data-icon="inline-start" />
          {{ t("sidebar.skillsDialog.analyze") }}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          :disabled="refreshing"
          :title="t('sidebar.skillsDialog.refreshTitle')"
          @click="refreshAll"
        >
          <Loader2 v-if="refreshing" class="size-3.5 animate-spin" data-icon="inline-start" />
          <RefreshCw v-else :size="13" data-icon="inline-start" />
          {{ t("sidebar.skillsDialog.refresh") }}
        </Button>
        <Button
          v-if="updatableSkills.length >= 2"
          variant="outline"
          size="sm"
          class="h-7 text-[12px]"
          :disabled="batchRunning || !!busyId"
          :title="t('sidebar.skillsDialog.updateAllTitle')"
          @click="updateAll"
        >
          <Loader2 v-if="batchRunning" class="size-3.5 animate-spin" data-icon="inline-start" />
          <Upload v-else class="size-3.5" data-icon="inline-start" />
          {{ batchRunning ? t("sidebar.skillsDialog.updatingProgress", { done: batchProgress.done, total: batchProgress.total }) : t("sidebar.skillsDialog.updateAll") }}
        </Button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <template v-if="tab === 'installed'">
          <div class="flex flex-col gap-3">
            <div v-if="installedSkills.length" class="relative">
              <Search
                class="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-dim)]"
                aria-hidden="true"
              />
              <Input
                v-model="installedQuery"
                class="h-8 pl-7 text-[12px]"
                :placeholder="t('sidebar.skillsDialog.searchInstalledPlaceholder')"
                :aria-label="t('sidebar.skillsDialog.searchInstalledLabel')"
              />
            </div>
            <div v-if="filteredSkills.length" class="flex flex-col gap-1.5">
              <div
                v-for="skill in filteredSkills"
                :key="skill.id"
                class="flex items-start gap-2 rounded-lg border border-[var(--color-line)] px-3 py-2"
                :class="updateOf(skill)?.hasUpdate ? 'border-[color-mix(in_srgb,var(--color-accent)_45%,var(--color-line))]' : ''"
              >
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <span class="text-[12px] font-medium text-[var(--color-txt-strong)]">{{ skill.name }}</span>
                    <Badge variant="secondary" class="text-[10px]">
                      {{ skillSourceLabel(skill) }}
                    </Badge>
                    <Badge
                      v-if="updateOf(skill)?.hasUpdate"
                      class="border-transparent bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)]! text-[var(--color-accent)]! text-[10px]"
                    >
                      {{ t("sidebar.skillsDialog.updatable") }}
                    </Badge>
                  </div>
                  <p v-if="skill.description" class="m-0 mt-0.5 line-clamp-2 text-[11px] text-[var(--color-mut)]">
                    {{ skill.description }}
                  </p>
                  <p class="m-0 mt-0.5 truncate font-[family-name:var(--font-mono)] text-[10px] text-[var(--color-dim)]">
                    {{ skill.dir }}
                  </p>
                  <p
                    v-if="resultOf(skill)"
                    class="m-0 mt-0.5 truncate text-[10px]"
                    :class="resultCls(skill)"
                    :title="resultOf(skill)?.state === 'error' ? resultOf(skill)?.message : undefined"
                  >
                    {{ resultText(skill) }}
                  </p>
                  <p
                    v-else-if="updateOf(skill)?.note"
                    class="m-0 mt-0.5 text-[10px] text-[var(--color-dim)]"
                  >
                    {{ updateOf(skill)?.note }}
                  </p>
                </div>
                <div class="flex flex-none items-center gap-1">
                  <Button
                    v-if="updateOf(skill)?.hasUpdate"
                    size="sm"
                    variant="outline"
                    class="h-7 text-[12px]"
                    :disabled="batchRunning || busyId === skill.id"
                    @click="updateSkill(skill)"
                  >
                    <Loader2 v-if="busyId === skill.id" class="size-3.5 animate-spin" />
                    <Upload v-else class="size-3.5" />
                    {{ t("sidebar.skillsDialog.update") }}
                  </Button>
                  <Button
                    v-if="skill.removable"
                    variant="ghost"
                    size="icon-sm"
                    class="text-[var(--color-danger-fg)] hover:bg-transparent!"
                    :disabled="busyId === skill.id"
                    :aria-label="t('sidebar.skillsDialog.uninstallAria', { name: skill.name })"
                    :title="t('sidebar.skillsDialog.uninstall')"
                    @click="uninstallSkill(skill)"
                  >
                    <Loader2 v-if="busyId === skill.id" class="size-3.5 animate-spin" />
                    <Trash2 v-else class="size-3.5" />
                  </Button>
                </div>
              </div>
            </div>
            <p
              v-else-if="installedQuery.trim()"
              class="m-0 text-[12px] text-[var(--color-dim)]"
            >
              {{ t("sidebar.skillsDialog.noMatch", { query: installedQuery.trim() }) }}
            </p>
            <p v-else class="m-0 text-[12px] text-[var(--color-dim)]">{{ t("sidebar.skillsDialog.noSkills") }}</p>

            <div class="flex flex-col gap-1.5">
              <div class="text-[12px] font-medium text-[var(--color-mut)]">{{ t("sidebar.skillsDialog.scanDirsTitle") }}</div>
              <div class="mb-1 flex flex-wrap gap-1.5">
                <Badge variant="outline" class="text-[10px]">
                  <FolderOpen :size="11" data-icon="inline-start" />~/.zen/skills
                </Badge>
                <Badge variant="outline" class="text-[10px]">{{ t("sidebar.skillsDialog.compatBadge") }}</Badge>
              </div>
              <div
                v-for="path in settings.skillExtraPaths"
                :key="path"
                class="flex items-center gap-2 rounded-lg border border-[var(--color-line)] px-2.5 py-1.5"
              >
                <span class="min-w-0 flex-1 truncate text-[12px]">{{ path }}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  :aria-label="t('sidebar.skillsDialog.removeDir')"
                  @click="
                    agentStore.updateSettings({
                      skillExtraPaths: settings.skillExtraPaths.filter((item) => item !== path),
                    })
                  "
                >
                  <Trash2 :size="13" />
                </Button>
              </div>
              <div class="flex items-center gap-2">
                <Button variant="outline" size="sm" @click="addSkillPath">{{ t("sidebar.skillsDialog.addDir") }}</Button>
                <Input
                  v-model="newSkillPath"
                  class="h-8 flex-1 text-[12px]"
                  :placeholder="t('sidebar.skillsDialog.pathPlaceholder')"
                  @keydown.enter="addSkillPath"
                />
              </div>
            </div>
          </div>
        </template>

        <template v-else>
          <div class="mb-2 flex items-center gap-2">
            <div class="relative min-w-0 flex-1">
              <Search
                class="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-dim)]"
                aria-hidden="true"
              />
              <Input
                v-model="marketQuery"
                class="h-8 pl-7 text-[12px]"
                :placeholder="t('sidebar.skillsDialog.marketPlaceholder')"
                @keydown.enter="searchMarket"
              />
            </div>
            <Button size="sm" :disabled="marketLoading" @click="searchMarket">
              <Loader2 v-if="marketLoading" class="size-3.5 animate-spin" />
              <Search v-else class="size-3.5" />
              {{ t("sidebar.skillsDialog.search") }}
            </Button>
          </div>
          <p v-if="marketError" class="m-0 mb-2 text-[12px] text-[var(--color-danger-fg)]">{{ marketError }}</p>
          <div class="flex flex-col gap-3">
            <div v-if="displayMarketItems.length" class="flex flex-col gap-1.5">
              <div
                v-for="hit in displayMarketItems"
                :key="hit.id"
                class="flex items-center gap-2 rounded-lg border border-[var(--color-line)] px-3 py-2"
              >
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-1.5">
                    <span class="truncate text-[12px] font-medium text-[var(--color-txt-strong)]">{{ hit.name }}</span>
                    <span class="truncate text-[10px] text-[var(--color-dim)]">{{ hit.source }}</span>
                  </div>
                  <p class="m-0 mt-0.5 text-[11px] text-[var(--color-mut)]">
                    {{ t("sidebar.skillsDialog.installsCount", { count: hit.installs.toLocaleString() }) }}
                  </p>
                </div>
                <a
                  :href="`https://skills.sh/${hit.source}/${hit.skillId}`"
                  target="_blank"
                  rel="noreferrer"
                  class="text-[var(--color-dim)] hover:text-[var(--color-txt)]"
                  :aria-label="t('sidebar.skillsDialog.openOnMarket')"
                >
                  <ExternalLink class="size-3.5" />
                </a>
                <Badge
                  v-if="isInstalledHit(hit)"
                  variant="secondary"
                  class="flex-none text-[10px]"
                >
                  {{ t("sidebar.skillsDialog.installed") }}
                </Badge>
                <Button
                  v-else
                  size="sm"
                  variant="outline"
                  :disabled="busyId === hit.id"
                  @click="installSkill(hit)"
                >
                  <Loader2 v-if="busyId === hit.id" class="size-3.5 animate-spin" />
                  <PackagePlus v-else class="size-3.5" />
                  {{ t("sidebar.skillsDialog.install") }}
                </Button>
              </div>
            </div>
            <div class="flex items-start gap-3 rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-sunken,#1c1c1c)] px-3.5 py-3">
              <div class="flex-none text-[12px] font-medium text-[var(--color-txt-strong)]">skills.sh</div>
              <p class="m-0 min-w-0 flex-1 text-[12px] leading-relaxed text-[var(--color-mut)]">
                {{ t("sidebar.skillsDialog.marketInfo") }}
              </p>
            </div>
          </div>
          <p v-if="!displayMarketItems.length && !marketLoading" class="m-0 text-[12px] text-[var(--color-dim)]">
            {{ t("sidebar.skillsDialog.marketHint") }}
          </p>
        </template>
      </div>

      <div
        class="flex min-h-10 flex-none items-center gap-2 border-t border-[var(--color-line-soft)] px-5 py-2.5 text-[11px] text-[var(--color-mut)]"
      >
        <span class="min-w-0 flex-1 truncate">{{ statusMsg || t("sidebar.skillsDialog.skillDirHint") }}</span>
      </div>
    </DialogContent>
  </Dialog>
</template>
