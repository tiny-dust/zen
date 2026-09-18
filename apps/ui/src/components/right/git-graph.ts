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
