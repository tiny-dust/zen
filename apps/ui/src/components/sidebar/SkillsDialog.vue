<script setup lang="ts">
import {
  ExternalLink,
  FolderOpen,
  Loader2,
  PackagePlus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
} from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, onMounted, ref, watch } from "vue";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAgentStore } from "@/stores/agent";
import { useModelsStore } from "@/stores/models";

import type { SkillMarketHit, SkillSummary } from "@zen/shared";

const open = defineModel<boolean>("open", { default: false });

const agentStore = useAgentStore();
const modelsStore = useModelsStore();
const { skills, settings } = storeToRefs(agentStore);
const { enabledModels } = storeToRefs(modelsStore);

type Tab = "installed" | "market" | "analyze";
const tab = ref<Tab>("installed");
const marketQuery = ref("coder");
const marketItems = ref<SkillMarketHit[]>([]);
const marketLoading = ref(false);
const marketError = ref("");
const busyId = ref("");
const statusMsg = ref("");
const newSkillPath = ref("");

const analyzeModelKey = ref("");
const analyzeBusy = ref(false);
const analyzeReport = ref("");
const analyzeError = ref("");

const modelOptions = computed(() =>
  enabledModels.value.map(({ provider, model }) => ({
    value: `${provider.id}::${model.id}`,
    label: `${provider.name} / ${model.name || model.id}`,
    providerId: provider.id,
    modelId: model.id,
  })),
);

watch(open, (value) => {
  if (!value) {
    return;
  }
  void agentStore.refreshSkills();
  void agentStore.refreshMcp();
  void modelsStore.refresh();
  statusMsg.value = "";
});

onMounted(() => {
  void agentStore.refreshSkills();
});

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
  statusMsg.value = `正在安装 ${hit.name}…`;
  try {
    const result = await zen.skills.marketInstall(hit);
    if (result.ok) {
      statusMsg.value = `已安装 ${hit.name}${result.dir ? ` → ${result.dir}` : ""}`;
      await agentStore.refreshSkills();
      tab.value = "installed";
    } else {
      statusMsg.value = result.error || "安装失败";
    }
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
    const result = await zen.skills.uninstall(skill);
    statusMsg.value = result.ok ? `已卸载 ${skill.name}` : result.error || "卸载失败";
    await agentStore.refreshSkills();
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
  await agentStore.refreshSkills();
}

/** 一键分析：先选 model，再本地汇总 SKILL.md 交由模型审计冲突 */
async function runAnalyze() {
  const zen = window.zen;
  if (!zen?.skills) {
    analyzeError.value = "技能分析 IPC 不可用";
    return;
  }
  if (!analyzeModelKey.value) {
    analyzeError.value = "请先选择分析所用 model";
    return;
  }
  const option = modelOptions.value.find((item) => item.value === analyzeModelKey.value);
  if (!option) {
    analyzeError.value = "模型选择无效";
    return;
  }
  analyzeBusy.value = true;
  analyzeError.value = "";
  analyzeReport.value = "";
  try {
    const result = await zen.skills.analyze({
      providerId: option.providerId,
      modelId: option.modelId,
    });
    if (result.ok && result.report) {
      analyzeReport.value = result.report;
    } else {
      analyzeError.value = result.error || "分析失败";
    }
  } catch (error) {
    analyzeError.value = error instanceof Error ? error.message : String(error);
  } finally {
    analyzeBusy.value = false;
  }
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
          管理本地技能、从 skills.sh 安装流行技能，并用所选 model 一键分析冲突。
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-none items-center gap-1 border-b border-[var(--color-line-soft)] px-4 py-2.5">
        <button type="button" :class="tabCls('installed')" @click="tab = 'installed'">已安装</button>
        <button type="button" :class="tabCls('market')" @click="tab = 'market'">市场 skills.sh</button>
        <button type="button" :class="tabCls('analyze')" @click="tab = 'analyze'">一键分析</button>
        <Button
          variant="ghost"
          size="sm"
          class="ml-auto"
          @click="agentStore.refreshSkills()"
        >
          <RefreshCw :size="13" data-icon="inline-start" />刷新
        </Button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <template v-if="tab === 'installed'">
          <div class="grid gap-3 lg:grid-cols-2">
            <div v-if="skills.length" class="flex flex-col gap-1.5">
              <div
                v-for="skill in skills"
                :key="skill.id"
                class="flex items-start gap-2 rounded-lg border border-[var(--color-line)] px-3 py-2"
              >
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <span class="text-[12.5px] font-medium text-[var(--color-txt-strong)]">{{ skill.name }}</span>
                    <Badge variant="secondary" class="text-[10px]">
                      {{ skill.source === "user" ? "用户" : "系统" }}
                    </Badge>
                  </div>
                  <p v-if="skill.description" class="m-0 mt-0.5 line-clamp-2 text-[11.5px] text-[var(--color-mut)]">
                    {{ skill.description }}
                  </p>
                  <p class="m-0 mt-0.5 truncate font-[family-name:var(--font-mono)] text-[10.5px] text-[var(--color-dim)]">
                    {{ skill.dir }}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  class="text-[var(--color-danger-fg)] hover:bg-transparent!"
                  :disabled="busyId === skill.id || skill.source !== 'user'"
                  :aria-label="`卸载 ${skill.name}`"
                  title="卸载"
                  @click="uninstallSkill(skill)"
                >
                  <Loader2 v-if="busyId === skill.id" class="size-3.5 animate-spin" />
                  <Trash2 v-else class="size-3.5" />
                </Button>
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

        <template v-else-if="tab === 'market'">
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
            <div v-if="marketItems.length" class="flex flex-col gap-1.5">
              <div
                v-for="hit in marketItems"
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
                <Button
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
                检索开放技能生态中的流行技能，安装后出现在「已安装」。安装依赖本机 npx 与网络。
              </p>
            </div>
          </div>
          <p v-if="!marketItems.length && !marketLoading" class="m-0 text-[12px] text-[var(--color-dim)]">
            输入关键词搜索 skills.sh 上的流行技能。
          </p>
        </template>

        <template v-else>
          <div class="flex flex-col gap-2">
            <p class="m-0 text-[12px] text-[var(--color-mut)]">
              点击「开始分析」前，请先选择 model。系统会汇总本地技能的 SKILL.md，检查功能冲突与触发重叠，并给出建议。
            </p>
            <div class="flex flex-wrap items-center gap-2">
              <Select v-model="analyzeModelKey">
                <SelectTrigger class="h-8 w-[280px] text-[12px]">
                  <SelectValue placeholder="选择分析用 model" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="item in modelOptions" :key="item.value" :value="item.value">
                    {{ item.label }}
                  </SelectItem>
                </SelectContent>
              </Select>
              <Button :disabled="analyzeBusy || !analyzeModelKey" @click="runAnalyze">
                <Loader2 v-if="analyzeBusy" class="size-3.5 animate-spin" />
                <ShieldCheck v-else class="size-3.5" />
                开始分析
              </Button>
            </div>
            <p v-if="analyzeError" class="m-0 text-[12px] text-[var(--color-danger-fg)]">{{ analyzeError }}</p>
            <pre
              v-if="analyzeReport"
              class="m-0 max-h-[40vh] overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--color-line)] bg-[var(--color-np-btn-bg)] p-3 text-[12px] leading-relaxed text-[var(--color-txt)]"
            >{{ analyzeReport }}</pre>
          </div>
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
