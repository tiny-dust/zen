import { cn } from "@/lib/utils";

import type { GitLogEntry } from "@zen/shared";

/** 泳道连线：from/to 为泳道下标；color 为取色泳道（延续本线取 from，分叉出新线取 to） */
export interface GraphEdge {
  from: number;
  to: number;
  color: number;
}

/** 一行提交的图形数据：所在泳道、与上一行/下一行的连线、贯穿泳道、泳道总数 */
export interface GraphRow {
  entry: GitLogEntry;
  lane: number;
  laneCount: number;
  inEdges: GraphEdge[];
  outEdges: GraphEdge[];
  /** 上方与下方被同一条线占用的泳道（不经过本行圆点）：整行画贯穿竖线，保证支线连续 */
  passThrough: number[];
}

const MAX_LANES = 32;

function firstFree(lanes: Array<string | null>): number {
  const index = lanes.indexOf(null);
  return index >= 0 ? index : Math.min(lanes.length, MAX_LANES - 1);
}

/** 按 git log 顺序扫描提交，依据父子关系分配泳道并生成上下行连线 */
export function computeGraphRows(log: GitLogEntry[]): GraphRow[] {
  const rows: GraphRow[] = [];
  let lanes: Array<string | null> = [];
  let laneCount = 1;
  const grow = (slot: number) => {
    laneCount = Math.max(laneCount, slot + 1);
  };

  for (const entry of log) {
    let lane = lanes.indexOf(entry.hash);
    if (lane < 0) {
      lane = firstFree(lanes);
    }
    grow(lane);

    // 上方指向本提交的泳道全部汇入圆点，并清空待取泳道
    const inEdges: GraphEdge[] = [];
    const next: Array<string | null> = lanes.map((hash) => (hash === entry.hash ? null : hash));
    lanes.forEach((hash, index) => {
      if (hash === entry.hash) {
        inEdges.push({ from: index, to: lane, color: index });
      }
    });

    const outEdges: GraphEdge[] = [];
    const [firstParent] = entry.parents;
    if (firstParent) {
      // 首父链保持在本泳道继续：当前分支永远占据最左侧泳道（VS Code 同款）。
      // 另一条同父泳道会在父提交行汇入本泳道（父提交取左者优先泳道）。
      next[lane] = firstParent;
      outEdges.push({ from: lane, to: lane, color: lane });
    }
    // 其余父提交（合并来源）从圆点分叉出新线占用空闲泳道（颜色随目标泳道的新线）
    for (const parent of entry.parents.slice(1)) {
      let target = next.indexOf(parent);
      if (target < 0) {
        target = firstFree(next);
      }
      next[target] = parent;
      outEdges.push({ from: lane, to: target, color: target });
      grow(target);
    }

    // 上方与下方同槽同线：贯穿竖线（如 merge 后另一条分支线在等待汇合的空档期）
    const passThrough: number[] = [];
    lanes.forEach((hash, index) => {
      if (index !== lane && hash !== null && next[index] === hash) {
        passThrough.push(index);
      }
    });

    while (next.length && next[next.length - 1] === null) {
      next.pop();
    }
    lanes = next;
    rows.push({ entry, lane, laneCount, inEdges, outEdges, passThrough });
  }
  // 统一用最终泳道数渲染，保证各行泳道 x 坐标一致
  return rows.map((row) => ({ ...row, laneCount }));
}

/* ---------- 泳道 SVG 渲染与徽标/时间格式化（GitGraph.vue 模板使用的纯函数） ---------- */

/** 泳道图渲染参数；色板循环使用主题 token（styles.css 的 --color-graph-*） */
const GRAPH_UNIT = 16;
export const GRAPH_ROW_H = 40;
export const GRAPH_DOT_R = 4;
export const GRAPH_STROKE = 2;
const LANE_COLORS = [
  "var(--color-graph-1)",
  "var(--color-graph-2)",
  "var(--color-graph-3)",
  "var(--color-graph-4)",
  "var(--color-graph-5)",
  "var(--color-graph-6)",
];

export function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length] ?? "var(--color-mut)";
}

export function laneX(lane: number): number {
  return lane * GRAPH_UNIT + 10;
}

export function svgWidth(laneCount: number): number {
  return GRAPH_UNIT * laneCount + 4;
}

/** 上一行 → 本行圆点的汇入线（行界处切线垂直，保证跨行拼接平滑） */
export function inEdgePath(edge: GraphEdge): string {
  const fx = laneX(edge.from);
  const tx = laneX(edge.to);
  const mid = GRAPH_ROW_H / 2;
  if (fx === tx) {
    return `M ${fx} 0 L ${fx} ${mid}`;
  }
  return `M ${fx} 0 C ${fx} ${mid / 2}, ${tx} ${mid / 2}, ${tx} ${mid}`;
}

/** 本行圆点 → 下一行的延伸/分叉线 */
export function outEdgePath(edge: GraphEdge): string {
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
export function throughLines(row: GraphRow): Array<{ x: number; color: string }> {
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
export function isBranchTip(row: GraphRow): boolean {
  return refBadges(row.entry.refs).some((badge) => badge.kind === "head");
}

export function fmtTime(ms: number) {
  const date = new Date(ms);
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
}

export function fileBadge(status: string): { text: string; cls: string } {
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

export function detailRowCls() {
  return cn("m-0 flex-none text-[11px] leading-[1.7] text-[var(--color-mut)]");
}

export function fmtParents(parents: string[]): string {
  return parents.length ? parents.map((p) => p.slice(0, 7)).join(" ") : "（根提交）";
}

/** 分支/标签徽标：%D 里的 ref 归类（HEAD 当前分支 / 本地 / 远端 / tag） */
export interface RefBadge {
  label: string;
  kind: "head" | "local" | "remote" | "tag";
}

export function refBadges(refs: string[]): RefBadge[] {
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

export const BADGE_CLS: Record<RefBadge["kind"], string> = {
  head: "border-transparent bg-[color-mix(in_srgb,var(--color-accent)_18%,transparent)] text-[var(--color-accent)]",
  local: "border-[var(--color-line-strong)] text-[var(--color-txt)]",
  remote: "border-[var(--color-line)] text-[var(--color-mut)]",
  tag: "border-transparent bg-[color-mix(in_srgb,var(--color-blue)_16%,transparent)] text-[var(--color-blue)]",
};

export const MAX_BADGES = 3;

/** 合并提交：列表行淡化展示（Git Graph 同款弱化正文） */
export function isMerge(row: GraphRow): boolean {
  return row.entry.parents.length > 1;
}
