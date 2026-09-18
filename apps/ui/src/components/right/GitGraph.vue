<script setup lang="ts">
import { ChevronDown, GitGraph as GitGraphIcon, GitBranch, RefreshCw, Tag } from "@lucide/vue";
import { computed, ref, watch } from "vue";

import DiffView from "@/components/right/DiffView.vue";
import { computeGraphRows } from "@/components/right/git-graph";
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
import { cn } from "@/lib/utils";

import type { GitCommitDetail, GitCommitFile, GitLogEntry } from "@zen/shared";
import type { GraphEdge, GraphRow } from "@/components/right/git-graph";

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

/** 泳道图渲染参数；色板循环使用主题 token（styles.css 的 --color-graph-*） */
const GRAPH_UNIT = 16;
const GRAPH_ROW_H = 40;
const GRAPH_DOT_R = 4;
const GRAPH_STROKE = 2;
const LANE_COLORS = [
  "var(--color-graph-1)",
  "var(--color-graph-2)",
  "var(--color-graph-3)",
  "var(--color-graph-4)",
  "var(--color-graph-5)",
  "var(--color-graph-6)",
];

function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length] ?? "var(--color-mut)";
}

function laneX(lane: number): number {
  return lane * GRAPH_UNIT + 10;
}

function svgWidth(laneCount: number): number {
  return GRAPH_UNIT * laneCount + 4;
}

/** 上一行 → 本行圆点的汇入线（行界处切线垂直，保证跨行拼接平滑） */
function inEdgePath(edge: GraphEdge): string {
  const fx = laneX(edge.from);
  const tx = laneX(edge.to);
  const mid = GRAPH_ROW_H / 2;
  if (fx === tx) {
    return `M ${fx} 0 L ${fx} ${mid}`;
  }
  return `M ${fx} 0 C ${fx} ${mid / 2}, ${tx} ${mid / 2}, ${tx} ${mid}`;
}

/** 本行圆点 → 下一行的延伸/分叉线 */
function outEdgePath(edge: GraphEdge): string {
  const fx = laneX(edge.from);
  const tx = laneX(edge.to);
  const mid = GRAPH_ROW_H / 2;
  if (fx === tx) {
    return `M ${fx} ${mid} L ${fx} ${GRAPH_ROW_H}`;
  }
  const bend = (mid + GRAPH_ROW_H) / 2;
  return `M ${fx} ${mid} C ${fx} ${bend}, ${tx} ${bend}, ${tx} ${GRAPH_ROW_H}`;
}

/** 详情块内延续的泳道竖线：贯穿泳道 + 本行出边，x 去重，颜色随连线 */
function throughLines(row: GraphRow): Array<{ x: number; color: string }> {
  const seen = new Set<number>();
  const lines: Array<{ x: number; color: string }> = [];
  for (const lane of row.passThrough) {
    seen.add(lane);
    lines.push({ x: laneX(lane), color: laneColor(lane) });
  }
  for (const edge of row.outEdges) {
    if (seen.has(edge.to)) {
      continue;
    }
    seen.add(edge.to);
    lines.push({ x: laneX(edge.to), color: laneColor(edge.color) });
  }
  return lines;
}

/** HEAD 所在的分支尖端行：圆点加光环标记当前检出位置 */
function isBranchTip(row: GraphRow): boolean {
  return refBadges(row.entry.refs).some((badge) => badge.kind === "head");
}

function fmtTime(ms: number) {
  const date = new Date(ms);
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
}

function fileBadge(status: string): { text: string; cls: string } {
  if (status === "M") {
    return { text: "M", cls: "text-[var(--color-accent)]" };
  }
  if (status === "A") {
    return { text: "A", cls: "text-[var(--color-add)]" };
  }
  if (status === "D") {
    return { text: "D", cls: "text-[var(--color-del)]" };
  }
  if (status === "R" || status === "T") {
    return { text: status, cls: "text-[var(--color-blue)]" };
  }
  return { text: status, cls: "text-[var(--color-mut)]" };
}

function detailRowCls() {
  return cn("m-0 flex-none text-[11px] leading-[1.7] text-[var(--color-mut)]");
}

function fmtParents(parents: string[]): string {
  return parents.length ? parents.map((p) => p.slice(0, 7)).join(" ") : "（根提交）";
}

/** 分支/标签徽标：%D 里的 ref 归类（HEAD 当前分支 / 本地 / 远端 / tag） */
interface RefBadge {
  label: string;
  kind: "head" | "local" | "remote" | "tag";
}

function refBadges(refs: string[]): RefBadge[] {
  const badges: RefBadge[] = [];
  for (const raw of refs) {
    const name = raw.trim();
    if (!name || name === "origin/HEAD") {
      // origin/HEAD 只是 origin/main 的别名，展示纯属重复信息
      continue;
    }
    if (name.startsWith("HEAD -> ")) {
      badges.push({ label: name.slice(8), kind: "head" });
    } else if (name === "HEAD") {
      badges.push({ label: "HEAD", kind: "head" });
    } else if (name.startsWith("tag: ")) {
      badges.push({ label: name.slice(5), kind: "tag" });
    } else if (name.includes("/")) {
      badges.push({ label: name, kind: "remote" });
    } else {
      badges.push({ label: name, kind: "local" });
    }
  }
  return badges;
}

const BADGE_CLS: Record<RefBadge["kind"], string> = {
  head: "border-transparent bg-[color-mix(in_srgb,var(--color-accent)_18%,transparent)] text-[var(--color-accent)]",
  local: "border-[var(--color-line-strong)] text-[var(--color-txt)]",
  remote: "border-[var(--color-line)] text-[var(--color-mut)]",
  tag: "border-transparent bg-[color-mix(in_srgb,var(--color-blue)_16%,transparent)] text-[var(--color-blue)]",
};

const MAX_BADGES = 3;

/** 合并提交：列表行淡化展示（Git Graph 同款弱化正文） */
function isMerge(row: GraphRow): boolean {
  return row.entry.parents.length > 1;
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
      <button
        type="button"
        class="flex h-10 w-full items-center gap-2 rounded-md pl-1.5 pr-1 text-left"
        :class="
          expandedHash === row.entry.hash
            ? 'bg-[var(--color-menu-active)]'
            : 'hover:bg-[var(--color-menu-hover)]'
        "
        :aria-expanded="expandedHash === row.entry.hash"
        @click="toggle(row.entry)"
      >
        <svg
          :width="svgWidth(row.laneCount)"
          :height="GRAPH_ROW_H"
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
      </button>

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
                <button
                  type="button"
                  class="flex items-center gap-1.5 rounded-md px-0.5 py-[2px] text-left text-[11px] hover:bg-[var(--color-menu-hover)]"
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
                  <span
                    class="min-w-0 flex-1 truncate font-[family-name:var(--font-mono)] text-[var(--color-txt)]"
                    :title="file.path"
                  >{{ file.path }}</span>
                  <span class="flex flex-none items-center gap-1 font-[family-name:var(--font-mono)] text-[10px]">
                    <span v-if="file.add" class="text-[var(--color-add)]">+{{ file.add }}</span>
                    <span v-if="file.del" class="text-[var(--color-del)]">-{{ file.del }}</span>
                  </span>
                </button>
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
