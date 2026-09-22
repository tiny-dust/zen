<script setup lang="ts">
import { ExternalLink, FolderOpen, Loader2, PackagePlus, RefreshCw, Search, ShieldCheck, Trash2, Upload } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, ref, watch } from "vue";

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

const agentStore = useAgentStore();
const { skills, settings } = storeToRefs(agentStore);

type Tab = "installed" | "market";
const tab = ref<Tab>("installed");
const marketQuery = ref("coder");
const marketItems = ref<SkillMarketHit[]>([]);
const marketLoading = ref(false);
const marketError = ref("");
const busyId = ref("");
const statusMsg = ref("");
const newSkillPath = ref("");
const refreshing = ref(false);
const updateMap = ref<Record<string, SkillUpdateInfo>>({});

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

watch(open, (value) => {
  if (!value) {
    return;
  }
  statusMsg.value = "";
  void refreshAll();
  void agentStore.refreshMcp();
});

/** 刷新：本地重扫 + 查询上游是否可更新 */
async function refreshAll() {
  refreshing.value = true;
  statusMsg.value = "正在刷新并检查上游更新…";
  try {
    await agentStore.refreshSkills();
    const zen = window.zen;
    if (!zen?.skills?.marketCheckUpdates) {
      updateMap.value = {};
      statusMsg.value = "已刷新本地技能";
      return;
    }
    // skills 是响应式代理，IPC 结构化克隆不支持 Proxy，必须传纯对象
    const plain = skills.value.map((skill) => ({ ...skill }));
    const result = await zen.skills.marketCheckUpdates(plain);
    const map: Record<string, SkillUpdateInfo> = {};
    for (const item of result.items ?? []) {
      map[item.id] = item;
    }
    updateMap.value = map;
    const updatable = (result.items ?? []).filter((item) => item.hasUpdate);
    if (!result.ok) {
      statusMsg.value = result.error || "上游更新检测失败";
    } else if (updatable.length) {
      statusMsg.value = `发现 ${updatable.length} 个技能可更新`;
    } else {
      statusMsg.value = "已是最新";
    }
  } catch (error) {
    updateMap.value = {};
    statusMsg.value = error instanceof Error ? error.message : String(error);
  } finally {
    refreshing.value = false;
  }
}

async function searchMarket() {
  const zen = window.zen;
  if (!zen?.skills) {
    marketError.value = "技能市场 IPC 不可用";
    return;
  }
  marketLoading.value = true;
  marketError.value = "";
  try {
    const result = await zen.skills.marketSearch(marketQuery.value.trim() || "skills");
    marketItems.value = result.items;
    if (!result.ok) {
      marketError.value = result.error || "搜索失败";
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
  statusMsg.value = `正在安装 ${hit.name}…（克隆仓库可能需要约一分钟）`;
  try {
    // hit 是响应式代理，ipcRenderer.invoke 结构化克隆不支持 Proxy，必须传纯对象
    const result = await zen.skills.marketInstall({ ...hit });
    if (result.ok) {
      statusMsg.value = `已安装 ${hit.name}${result.dir ? ` → ${result.dir}` : ""}`;
      await agentStore.refreshSkills();
      tab.value = "installed";
    } else {
      statusMsg.value = result.error || "安装失败";
    }
  } catch (error) {
    statusMsg.value = error instanceof Error ? error.message : String(error);
  } finally {
    busyId.value = "";
  }
}

async function updateSkill(skill: SkillSummary) {
  const zen = window.zen;
  if (!zen?.skills?.marketUpdate) {
    return;
  }
  busyId.value = skill.id;
  statusMsg.value = `正在更新 ${skill.name}…`;
  try {
    const result = await zen.skills.marketUpdate({ ...skill });
    statusMsg.value = result.ok
      ? `已更新 ${skill.name}${result.dir ? ` → ${result.dir}` : ""}`
      : result.error || "更新失败";
    await refreshAll();
  } catch (error) {
    statusMsg.value = error instanceof Error ? error.message : String(error);
  } finally {
    busyId.value = "";
  }
}

async function uninstallSkill(skill: SkillSummary) {
  const zen = window.zen;
  if (!zen?.skills) {
    return;
  }
  busyId.value = skill.id;
  statusMsg.value = `正在卸载 ${skill.name}…`;
  try {
    // skill 是响应式代理，IPC 结构化克隆不支持 Proxy，必须传纯对象
    const result = await zen.skills.uninstall({ ...skill });
    statusMsg.value = result.ok ? `已卸载 ${skill.name}` : result.error || "卸载失败";
    await refreshAll();
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
        <DialogTitle class="text-[15px]">技能</DialogTitle>
        <DialogDescription class="text-[12.5px]">
          管理本地技能、从 skills.sh 安装流行技能，或用一键分析审计技能冲突。
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-none items-center gap-1 border-b border-[var(--color-line-soft)] px-4 py-2.5">
        <Button
          variant="ghost"
          :class="[tabCls('installed'), tab === 'installed' ? 'hover:bg-[var(--color-menu-active)] dark:hover:bg-[var(--color-menu-active)]' : 'font-normal']"
          @click="tab = 'installed'"
        >已安装</Button>
        <Button
          variant="ghost"
          :class="[tabCls('market'), tab === 'market' ? 'hover:bg-[var(--color-menu-active)] dark:hover:bg-[var(--color-menu-active)]' : 'font-normal']"
          @click="tab = 'market'"
        >市场 skills.sh</Button>
        <Button
          variant="outline"
          size="sm"
          class="ml-auto h-7 text-[12px]"
          title="在公共区新建会话并分析技能冲突"
          @click="analyzeInNewSession"
        >
          <ShieldCheck class="size-3.5" data-icon="inline-start" />
          一键分析
        </Button>
        <Button
          variant="ghost"
          size="sm"
          :disabled="refreshing"
          title="重扫本地技能并检查上游更新"
          @click="refreshAll"
        >
          <Loader2 v-if="refreshing" class="size-3.5 animate-spin" data-icon="inline-start" />
          <RefreshCw v-else :size="13" data-icon="inline-start" />
          刷新
        </Button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <template v-if="tab === 'installed'">
          <div class="grid gap-3 lg:grid-cols-2">
            <div v-if="installedSkills.length" class="flex flex-col gap-1.5">
              <div
                v-for="skill in installedSkills"
                :key="skill.id"
                class="flex items-start gap-2 rounded-lg border border-[var(--color-line)] px-3 py-2"
                :class="updateOf(skill)?.hasUpdate ? 'border-[color-mix(in_srgb,var(--color-accent)_45%,var(--color-line))]' : ''"
              >
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <span class="text-[12.5px] font-medium text-[var(--color-txt-strong)]">{{ skill.name }}</span>
                    <Badge variant="secondary" class="text-[10px]">
                      {{ skillSourceLabel(skill) }}
                    </Badge>
                    <Badge
                      v-if="updateOf(skill)?.hasUpdate"
                      class="border-transparent bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)]! text-[var(--color-accent)]! text-[10px]"
                    >
                      可更新
                    </Badge>
                  </div>
                  <p v-if="skill.description" class="m-0 mt-0.5 line-clamp-2 text-[11.5px] text-[var(--color-mut)]">
                    {{ skill.description }}
                  </p>
                  <p class="m-0 mt-0.5 truncate font-[family-name:var(--font-mono)] text-[10.5px] text-[var(--color-dim)]">
                    {{ skill.dir }}
                  </p>
                  <p
                    v-if="updateOf(skill)?.note"
                    class="m-0 mt-0.5 text-[10.5px] text-[var(--color-dim)]"
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
                    :disabled="busyId === skill.id"
                    @click="updateSkill(skill)"
                  >
                    <Loader2 v-if="busyId === skill.id" class="size-3.5 animate-spin" />
                    <Upload v-else class="size-3.5" />
                    更新
                  </Button>
                  <Button
                    v-if="skill.removable"
                    variant="ghost"
                    size="icon-sm"
                    class="text-[var(--color-danger-fg)] hover:bg-transparent!"
                    :disabled="busyId === skill.id"
                    :aria-label="`卸载 ${skill.name}`"
                    title="卸载"
                    @click="uninstallSkill(skill)"
                  >
                    <Loader2 v-if="busyId === skill.id" class="size-3.5 animate-spin" />
                    <Trash2 v-else class="size-3.5" />
                  </Button>
                </div>
              </div>
            </div>
            <p v-else class="m-0 text-[12px] text-[var(--color-dim)]">未发现技能。可从市场安装，或添加扫描目录。</p>

            <div class="flex flex-col gap-1.5">
              <div class="text-[12px] font-medium text-[var(--color-mut)]">扫描目录与自定义路径</div>
              <div class="mb-1 flex flex-wrap gap-1.5">
                <Badge variant="outline" class="text-[10px]">
                  <FolderOpen :size="11" data-icon="inline-start" />~/.zen/skills
                </Badge>
                <Badge variant="outline" class="text-[10px]">兼容 ~/.claude 与 ~/.agents</Badge>
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
                  aria-label="移除目录"
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
                <Button variant="outline" size="sm" @click="addSkillPath">添加目录</Button>
                <Input
                  v-model="newSkillPath"
                  class="h-8 flex-1 text-[12px]"
                  placeholder="或输入路径，如 ~/my-skills"
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
                placeholder="搜索 skills.sh，如 frontend-design"
                @keydown.enter="searchMarket"
              />
            </div>
            <Button size="sm" :disabled="marketLoading" @click="searchMarket">
              <Loader2 v-if="marketLoading" class="size-3.5 animate-spin" />
              <Search v-else class="size-3.5" />
              搜索
            </Button>
          </div>
          <p v-if="marketError" class="m-0 mb-2 text-[12px] text-[var(--color-danger-fg)]">{{ marketError }}</p>
          <div class="grid gap-3 lg:grid-cols-2">
            <div v-if="displayMarketItems.length" class="flex flex-col gap-1.5">
              <div
                v-for="hit in displayMarketItems"
                :key="hit.id"
                class="flex items-center gap-2 rounded-lg border border-[var(--color-line)] px-3 py-2"
              >
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-1.5">
                    <span class="truncate text-[12.5px] font-medium text-[var(--color-txt-strong)]">{{ hit.name }}</span>
                    <span class="truncate text-[10.5px] text-[var(--color-dim)]">{{ hit.source }}</span>
                  </div>
                  <p class="m-0 mt-0.5 text-[11px] text-[var(--color-mut)]">
                    安装量 {{ hit.installs.toLocaleString() }}
                  </p>
                </div>
                <a
                  :href="`https://skills.sh/${hit.source}/${hit.skillId}`"
                  target="_blank"
                  rel="noreferrer"
                  class="text-[var(--color-dim)] hover:text-[var(--color-txt)]"
                  aria-label="在 skills.sh 打开"
                >
                  <ExternalLink class="size-3.5" />
                </a>
                <Badge
                  v-if="isInstalledHit(hit)"
                  variant="secondary"
                  class="flex-none text-[10px]"
                >
                  已安装
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
                  安装
                </Button>
              </div>
            </div>
            <div class="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-sunken,#1c1c1c)] p-4">
              <div class="text-[12.5px] font-medium text-[var(--color-txt-strong)]">skills.sh</div>
              <p class="m-0 mt-1 text-[12px] leading-relaxed text-[var(--color-mut)]">
                检索开放技能生态中的流行技能，安装到 ~/.claude/skills 并自动出现在「已安装」。安装依赖本机 Node.js（npx）与网络。
              </p>
            </div>
          </div>
          <p v-if="!displayMarketItems.length && !marketLoading" class="m-0 text-[12px] text-[var(--color-dim)]">
            输入关键词搜索 skills.sh 上的流行技能。
          </p>
        </template>
      </div>

      <div
        class="flex min-h-10 flex-none items-center gap-2 border-t border-[var(--color-line-soft)] px-5 py-2.5 text-[11.5px] text-[var(--color-mut)]"
      >
        <span class="min-w-0 flex-1 truncate">{{ statusMsg || "技能目录：含 SKILL.md 的文件夹" }}</span>
      </div>
    </DialogContent>
  </Dialog>
</template>
