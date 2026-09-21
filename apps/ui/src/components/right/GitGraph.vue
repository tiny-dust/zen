<script setup lang="ts">
import { ChevronDown, GitGraph as GitGraphIcon, GitBranch, RefreshCw, Tag } from "@lucide/vue";
import { computed, ref, watch } from "vue";

import FileLabel from "@/components/files/FileLabel.vue";
import DiffView from "@/components/right/DiffView.vue";
import {
  BADGE_CLS,
  GRAPH_DOT_R,
  GRAPH_ROW_H,
  GRAPH_STROKE,
  MAX_BADGES,
  computeGraphRows,
  detailRowCls,
  fileBadge,
  fmtParents,
  fmtTime,
  inEdgePath,
  isBranchTip,
  isMerge,
  laneColor,
  laneX,
  outEdgePath,
  refBadges,
  svgWidth,
  throughLines,
} from "@/components/right/git-graph";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useGitStore } from "@/stores/git";

import type { GitCommitDetail, GitCommitFile, GitLogEntry } from "@zen/shared";

const gitStore = useGitStore();

const graphRows = computed(() => computeGraphRows(gitStore.log));

// 打开面板或切换工作区时刷新提交历史与分支列表（筛选下拉数据源）
watch(
  () => gitStore.cwd(),
  () => {
    void gitStore.refreshLog();
    void gitStore.refreshBranches();
  },
  { immediate: true },
);

/** 展开态与详情缓存（按 hash 懒加载一次） */
const expandedHash = ref("");
const details = ref(new Map<string, GitCommitDetail>());
const loadingHash = ref("");

/** 详情内文件 diff：key = `${hash}:${path}`，懒加载缓存 */
const openFiles = ref(new Set<string>());
const fileDiffs = ref(new Map<string, string>());
const loadingFile = ref("");

function fileKey(hash: string, path: string): string {
  return `${hash}:${path}`;
}

async function toggleFile(hash: string, path: string) {
  const key = fileKey(hash, path);
  if (openFiles.value.has(key)) {
    const next = new Set(openFiles.value);
    next.delete(key);
    openFiles.value = next;
    return;
  }
  openFiles.value = new Set([...openFiles.value, key]);
  if (fileDiffs.value.has(key)) {
    return;
  }
  loadingFile.value = key;
  try {
    const zen = window.zen;
    const diff = zen?.git ? await zen.git.commitFileDiff(gitStore.cwd(), hash, path) : null;
    fileDiffs.value.set(key, diff ?? "");
  } finally {
    if (loadingFile.value === key) {
      loadingFile.value = "";
    }
  }
}

async function toggle(entry: GitLogEntry) {
  if (expandedHash.value === entry.hash) {
    expandedHash.value = "";
    return;
  }
  expandedHash.value = entry.hash;
  if (details.value.has(entry.hash)) {
    return;
  }
  loadingHash.value = entry.hash;
  try {
    const zen = window.zen;
    const detail = zen?.git
      ? await zen.git.commitDetail(gitStore.cwd(), entry.hash)
      : null;
    if (detail) {
      details.value.set(entry.hash, detail);
    }
  } finally {
    if (loadingHash.value === entry.hash) {
      loadingHash.value = "";
    }
  }
}

/** 分支筛选值：Select 不接受空串 value，用 "all" 哨兵映射 ""（= --all） */
const branchFilter = computed({
  get: () => gitStore.logRef || "all",
  set: (value: string) => {
    void gitStore.setLogRef(value === "all" ? "" : value);
  },
});
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-2">
    <div class="flex flex-none items-center gap-1">
      <span
        class="min-w-0 flex-1 truncate text-[12px] font-semibold text-[var(--color-txt-strong)]"
      >
        提交历史
      </span>
      <span class="flex-none text-[10.5px] text-[var(--color-dim)]">{{ graphRows.length }}</span>
      <Button
        variant="ghost"
        size="icon-xs"
        :aria-label="gitStore.logLoading ? '刷新中' : '刷新提交历史'"
        title="刷新"
        @click="gitStore.refreshLog()"
      >
        <RefreshCw :class="gitStore.logLoading ? 'animate-spin' : ''" />
      </Button>
    </div>

    <!-- 分支筛选：全部 / 本地 / 远端（Git Graph 同款） -->
    <Select v-model="branchFilter">
      <SelectTrigger
        size="sm"
        class="h-7 w-full flex-none rounded-md text-[11.5px]"
        aria-label="筛选分支"
      >
        <SelectValue placeholder="筛选分支" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">全部分支</SelectItem>
        <SelectGroup>
          <SelectLabel>本地分支</SelectLabel>
          <SelectItem v-for="branch in gitStore.branches.local" :key="branch.name" :value="branch.name">
            {{ branch.name }}{{ branch.current ? "（当前）" : "" }}
          </SelectItem>
        </SelectGroup>
        <SelectGroup v-if="gitStore.branches.remote.length">
          <SelectLabel>远端分支</SelectLabel>
          <SelectItem
            v-for="branch in gitStore.branches.remote"
            :key="branch.name"
            :value="branch.name"
          >
            {{ branch.name }}
          </SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>

    <div class="min-h-0 flex-1 overflow-auto">
      <p
        v-if="gitStore.logLoading && !graphRows.length"
        class="m-0 px-1 py-2 text-[12px] text-[var(--color-dim)]"
      >
        读取中…
      </p>
      <p
        v-else-if="!graphRows.length"
        class="m-0 flex items-center gap-1.5 px-1 py-2 text-[12px] text-[var(--color-dim)]"
      >
        <GitGraphIcon class="size-3.5 flex-none" aria-hidden="true" />
        {{ gitStore.cwd() ? "暂无提交记录" : "公共区未绑定目录" }}
      </p>
      <template v-else>
        <template v-for="row in graphRows" :key="row.entry.hash">
      <!-- 提交行：点击展开/折叠详情 -->
      <Button
        variant="ghost"
        class="flex h-10 w-full items-center justify-start gap-2 rounded-md pl-1.5 pr-1 text-left font-normal"
        :class="
          expandedHash === row.entry.hash
            ? 'bg-[var(--color-menu-active)] hover:bg-[var(--color-menu-active)] dark:hover:bg-[var(--color-menu-active)] aria-expanded:bg-[var(--color-menu-active)]'
            : 'hover:bg-[var(--color-menu-hover)] dark:hover:bg-[var(--color-menu-hover)]'
        "
        :aria-expanded="expandedHash === row.entry.hash"
        @click="toggle(row.entry)"
      >
        <svg
          :style="{ width: `${svgWidth(row.laneCount)}px`, height: `${GRAPH_ROW_H}px` }"
          class="flex-none self-center"
          aria-hidden="true"
        >
          <!-- 贯穿泳道：上下方被同一条线占用、不经过圆点的支线保持连续 -->
          <line
            v-for="lane in row.passThrough"
            :key="`th-${lane}`"
            :x1="laneX(lane)"
            :x2="laneX(lane)"
            y1="0"
            y2="100%"
            :stroke="laneColor(lane)"
            :stroke-width="GRAPH_STROKE"
          />
          <path
            v-for="(edge, index) in row.inEdges"
            :key="`in-${index}`"
            :d="inEdgePath(edge)"
            :stroke="laneColor(edge.color)"
            :stroke-width="GRAPH_STROKE"
            fill="none"
          />
          <path
            v-for="(edge, index) in row.outEdges"
            :key="`out-${index}`"
            :d="outEdgePath(edge)"
            :stroke="laneColor(edge.color)"
            :stroke-width="GRAPH_STROKE"
            fill="none"
          />
          <!-- 分支尖端（HEAD 所在提交）加光环；合并提交画空心圆 -->
          <circle
            v-if="isBranchTip(row)"
            :cx="laneX(row.lane)"
            :cy="GRAPH_ROW_H / 2"
            :r="GRAPH_DOT_R + 3.5"
            fill="none"
            :stroke="laneColor(row.lane)"
            stroke-opacity="0.35"
            :stroke-width="GRAPH_STROKE"
          />
          <circle
            :cx="laneX(row.lane)"
            :cy="GRAPH_ROW_H / 2"
            :r="GRAPH_DOT_R"
            :fill="row.entry.parents.length > 1 ? 'var(--color-bg)' : laneColor(row.lane)"
            :stroke="laneColor(row.lane)"
            :stroke-width="GRAPH_STROKE"
          />
        </svg>
        <div class="min-w-0 flex-1">
          <div class="flex min-w-0 items-center gap-1.5">
            <p
              class="m-0 min-w-0 flex-1 truncate text-[12px]"
              :class="isMerge(row) ? 'text-[var(--color-dim)]' : 'text-[var(--color-txt)]'"
              :title="row.entry.subject"
            >
              {{ row.entry.subject }}
            </p>
            <span
              v-for="badge in refBadges(row.entry.refs).slice(0, MAX_BADGES)"
              :key="badge.label"
              class="inline-flex flex-none items-center gap-0.5 rounded-full border px-1.5 py-px text-[10px] leading-[1.4]"
              :class="BADGE_CLS[badge.kind]"
            >
              <Tag v-if="badge.kind === 'tag'" class="size-2.5" aria-hidden="true" />
              <GitBranch v-else class="size-2.5" aria-hidden="true" />
              {{ badge.label }}
            </span>
            <span
              v-if="refBadges(row.entry.refs).length > MAX_BADGES"
              class="flex-none text-[10px] text-[var(--color-dim)]"
            >
              +{{ refBadges(row.entry.refs).length - MAX_BADGES }}
            </span>
          </div>
          <p class="m-0 truncate text-[10.5px] text-[var(--color-dim)]">
            {{ row.entry.hash.slice(0, 7) }} · {{ row.entry.author }} ·
            {{ fmtTime(row.entry.time) }}
          </p>
        </div>
      </Button>

      <!-- 详情：泳道竖线穿过，时间轴保持连贯；卡片样式与列表行拉开层次 -->
      <div
        v-if="expandedHash === row.entry.hash"
        class="flex items-stretch rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-notice-bg)] pl-1.5 shadow-[var(--shadow-composer)]"
      >
        <div
          class="relative flex-none"
          :style="{ width: `${svgWidth(row.laneCount)}px` }"
          aria-hidden="true"
        >
          <svg class="absolute inset-0 h-full w-full">
            <line
              v-for="(line, index) in throughLines(row)"
              :key="index"
              :x1="line.x"
              :x2="line.x"
              y1="0"
              y2="100%"
              :stroke="line.color"
              :stroke-width="GRAPH_STROKE"
            />
          </svg>
        </div>

        <div class="min-w-0 flex-1 overflow-hidden px-2.5 py-2.5">
          <p v-if="loadingHash === row.entry.hash" class="m-0 text-[11px] text-[var(--color-dim)]">
            读取提交详情…
          </p>
          <p
            v-else-if="!details.get(row.entry.hash)"
            class="m-0 text-[11px] text-[var(--color-dim)]"
          >
            无法读取提交详情
          </p>
          <template v-else>
            <p
              class="m-0 mb-1.5 whitespace-pre-wrap break-words font-[family-name:var(--font-mono)] text-[11px] leading-[1.7] text-[var(--color-txt)]"
            >{{ details.get(row.entry.hash)!.body }}</p>
            <p :class="detailRowCls">
              Commit: <span class="text-[var(--color-txt)]">{{ details.get(row.entry.hash)!.hash }}</span>
            </p>
            <p :class="detailRowCls">Parents: {{ fmtParents(details.get(row.entry.hash)!.parents) }}</p>
            <p :class="detailRowCls">
              Author: {{ details.get(row.entry.hash)!.author }}
              &lt;{{ details.get(row.entry.hash)!.authorEmail }}&gt;
            </p>
            <p :class="detailRowCls">
              Committer: {{ details.get(row.entry.hash)!.committer }}
              &lt;{{ details.get(row.entry.hash)!.committerEmail }}&gt;
            </p>
            <p :class="detailRowCls">Date: {{ fmtTime(details.get(row.entry.hash)!.authorTime) }}</p>
            <p
              v-if="details.get(row.entry.hash)!.files.length"
              class="m-0 mt-1.5 text-[10.5px] text-[var(--color-dim)]"
            >
              变更文件（{{ details.get(row.entry.hash)!.files.length }}）
            </p>
            <div class="mt-0.5 flex flex-col">
              <template
                v-for="file in details.get(row.entry.hash)!.files"
                :key="file.path"
              >
                <Button
                  variant="ghost"
                  class="flex h-auto items-center justify-start gap-1.5 rounded-md px-0.5 py-[2px] text-left font-normal text-[11px] md:text-[11px] hover:bg-[var(--color-menu-hover)] dark:hover:bg-[var(--color-menu-hover)] aria-expanded:bg-transparent"
                  :aria-expanded="openFiles.has(fileKey(row.entry.hash, file.path))"
                  @click="toggleFile(row.entry.hash, file.path)"
                >
                  <ChevronDown
                    class="size-3 flex-none text-[var(--color-dim)] transition-transform duration-[var(--motion-fast)]"
                    :class="openFiles.has(fileKey(row.entry.hash, file.path)) ? '' : '-rotate-90'"
                    aria-hidden="true"
                  />
                  <span
                    class="w-3 flex-none text-center font-[family-name:var(--font-mono)] text-[10px]"
                    :class="fileBadge(file.status).cls"
                  >{{ fileBadge(file.status).text }}</span>
                  <FileLabel
                    :path="file.path"
                    class="flex-1 font-[family-name:var(--font-mono)] text-[var(--color-txt)]"
                  />
                  <span class="flex flex-none items-center gap-1 font-[family-name:var(--font-mono)] text-[10px]">
                    <span v-if="file.add" class="text-[var(--color-add)]">+{{ file.add }}</span>
                    <span v-if="file.del" class="text-[var(--color-del)]">-{{ file.del }}</span>
                  </span>
                </Button>
                <!-- 文件 patch：点击行内展开 -->
                <div
                  v-if="openFiles.has(fileKey(row.entry.hash, file.path))"
                  class="mb-1 ml-4 flex max-h-72 overflow-hidden"
                >
                  <p
                    v-if="loadingFile === fileKey(row.entry.hash, file.path)"
                    class="m-0 py-1 text-[11px] text-[var(--color-dim)]"
                  >
                    读取 diff…
                  </p>
                  <template v-else>
                    <p
                      v-if="!fileDiffs.get(fileKey(row.entry.hash, file.path))"
                      class="m-0 py-1 text-[11px] text-[var(--color-dim)]"
                    >
                      无 diff 内容
                    </p>
                    <DiffView
                      v-else
                      :diff="fileDiffs.get(fileKey(row.entry.hash, file.path))!"
                      class="min-h-0"
                    />
                  </template>
                </div>
              </template>
            </div>
          </template>
        </div>
      </div>
        </template>
      </template>
    </div>
  </div>
</template>
