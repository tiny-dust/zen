import type { GitLogEntry } from "@zen/shared";

/** 泳道连线：from/to 为泳道下标 */
export interface GraphEdge {
  from: number;
  to: number;
}

/** 一行提交的图形数据：所在泳道、与上一行/下一行的连线、泳道总数 */
export interface GraphRow {
  entry: GitLogEntry;
  lane: number;
  laneCount: number;
  inEdges: GraphEdge[];
  outEdges: GraphEdge[];
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

    // 指向本提交的泳道全部汇入当前泳道，并清空待取泳道
    const inEdges: GraphEdge[] = [];
    const next: Array<string | null> = lanes.map((hash) => (hash === entry.hash ? null : hash));
    lanes.forEach((hash, index) => {
      if (hash === entry.hash) {
        inEdges.push({ from: index, to: lane });
      }
    });

    const outEdges: GraphEdge[] = [];
    const [firstParent] = entry.parents;
    if (firstParent) {
      const existing = next.indexOf(firstParent);
      if (existing >= 0 && existing !== lane) {
        // 首父已在其他泳道：本泳道改道汇入，避免同槽重复
        outEdges.push({ from: lane, to: existing });
      } else {
        next[lane] = firstParent;
        outEdges.push({ from: lane, to: lane });
      }
    }
    // 其余父提交（合并来源）占用空闲泳道继续延伸
    for (const parent of entry.parents.slice(1)) {
      let target = next.indexOf(parent);
      if (target < 0) {
        target = firstFree(next);
      }
      next[target] = parent;
      outEdges.push({ from: lane, to: target });
      grow(target);
    }

    while (next.length && next[next.length - 1] === null) {
      next.pop();
    }
    lanes = next;
    rows.push({ entry, lane, laneCount, inEdges, outEdges });
  }
  // 统一用最终泳道数渲染，保证各行泳道 x 坐标一致
  return rows.map((row) => ({ ...row, laneCount }));
}
