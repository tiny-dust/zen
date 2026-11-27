/**
 * 运行轨迹图的确定性布局引擎（纯函数，无 DOM）：自上而下的轮次流，
 * 连续 ≥3 个同类无错工具折叠成聚簇卡片，连线用三次贝塞尔。
 * 指标与连线公式照抄 Nomi 的 TraceDrawer/graphLayout.ts；去掉子代理子图与网关节点。
 */
import type { TraceBucket, TraceDocument, TraceNode, TraceNodeStatus, TraceTurn } from "./document";

export const GRAPH_METRICS = {
  NODE_W: 248,
  NODE_H: 64,
  THINK_H: 76,
  CLUSTER_H: 68,
  GAP_X: 24,
  GAP_Y: 28,
  WAVE_SUBROW_GAP_Y: 16,
  PAD_X: 22,
  HEADER_H: 38,
  PAD_BOTTOM: 18,
  TURN_GAP_Y: 24,
  TURN_GAP_X: 28,
  CANVAS_PAD: 28,
  MAX_COLS: 3,
  CLUSTER_THRESHOLD: 3,
} as const;

export interface GraphLayoutOptions {
  compactTools: boolean;
  collapsedTurns: ReadonlySet<string>;
  expandedClusters: ReadonlySet<string>;
  /** 筛选时只排命中轮次 */
  visibleTurnIds?: ReadonlySet<string>;
  /**
   * 每行最多几张轮次卡片（1 = 单列纵向流）。
   * 渲染层按轨迹视口宽度算：宽了横排，窄了回落单列。
   */
  columns?: number;
}

/** 聚簇里各类工具的计数（用于「已探索 3 个文件 · 2 次搜索」这类标题） */
export interface ClusterCounts {
  files: number;
  searches: number;
  folders: number;
  webs: number;
  commands: number;
  edits: number;
}

export interface ClusterMeta {
  id: string;
  bucket: TraceBucket;
  nodeIds: string[];
  counts: ClusterCounts;
  durationMs?: number;
}

export interface LayoutNode {
  id: string;
  kind: "node" | "cluster";
  x: number;
  y: number;
  width: number;
  height: number;
  turnId: string;
  laneId: string;
  depth: number;
  node?: TraceNode;
  cluster?: ClusterMeta;
}

export interface LayoutGroup {
  id: string;
  kind: "turn";
  title: string;
  status: TraceNodeStatus;
  laneId: string;
  turnId: string;
  collapsed: boolean;
  stepCount: number;
  durationMs?: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutEdge {
  id: string;
  kind: "flow" | "parallel";
  fromId: string;
  toId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  d: string;
  status: TraceNodeStatus;
}

export interface GraphLayout {
  width: number;
  height: number;
  groups: LayoutGroup[];
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  nodeById: Record<string, LayoutNode>;
}

interface Port {
  id: string;
  x: number;
  y: number;
  status: TraceNodeStatus;
}

interface MeasuredBlock {
  width: number;
  height: number;
  groups: LayoutGroup[];
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  entryPorts: Port[];
  exitPorts: Port[];
}

/** 横向连线（同一行里相邻的轮次卡片）：控制点沿 x 展开 */
function bezierPathH(x1: number, y1: number, x2: number, y2: number): string {
  const ctrl = Math.max(18, Math.min(72, Math.abs(x2 - x1) * 0.5));
  return `M ${x1} ${y1} C ${x1 + ctrl} ${y1}, ${x2 - ctrl} ${y2}, ${x2} ${y2}`;
}

function bezierPath(x1: number, y1: number, x2: number, y2: number): string {
  const dy = Math.abs(y2 - y1);
  const ctrl = Math.max(18, Math.min(72, dy * 0.5));
  return `M ${x1} ${y1} C ${x1} ${y1 + ctrl}, ${x2} ${y2 - ctrl}, ${x2} ${y2}`;
}

function makeEdge(
  id: string,
  kind: LayoutEdge["kind"],
  fromId: string,
  toId: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  status: TraceNodeStatus,
): LayoutEdge {
  return { id, kind, fromId, toId, x1, y1, x2, y2, d: bezierPath(x1, y1, x2, y2), status };
}

function shiftEdges(edges: readonly LayoutEdge[], dx: number, dy: number): LayoutEdge[] {
  if (dx === 0 && dy === 0) {
    return [...edges];
  }
  return edges.map((edge) => {
    const x1 = edge.x1 + dx;
    const y1 = edge.y1 + dy;
    const x2 = edge.x2 + dx;
    const y2 = edge.y2 + dy;
    return { ...edge, x1, y1, x2, y2, d: bezierPath(x1, y1, x2, y2) };
  });
}

function translateBlock(block: MeasuredBlock, dx: number, dy: number): MeasuredBlock {
  if (dx === 0 && dy === 0) {
    return block;
  }
  const shiftPort = (port: Port) => ({ ...port, x: port.x + dx, y: port.y + dy });
  return {
    width: block.width,
    height: block.height,
    groups: block.groups.map((group) => ({ ...group, x: group.x + dx, y: group.y + dy })),
    nodes: block.nodes.map((node) => ({ ...node, x: node.x + dx, y: node.y + dy })),
    edges: shiftEdges(block.edges, dx, dy),
    entryPorts: block.entryPorts.map(shiftPort),
    exitPorts: block.exitPorts.map(shiftPort),
  };
}

function nodeHeightOf(node: TraceNode): number {
  return node.kind === "thinking" ? GRAPH_METRICS.THINK_H : GRAPH_METRICS.NODE_H;
}

function emptyCounts(): ClusterCounts {
  return { files: 0, searches: 0, folders: 0, webs: 0, commands: 0, edits: 0 };
}

function clusterCounts(nodes: readonly TraceNode[]): ClusterCounts {
  const counts = emptyCounts();
  for (const node of nodes) {
    switch (node.subtitle) {
      case "readFile":
        counts.files += 1;
        break;
      case "searchFiles":
        counts.searches += 1;
        break;
      case "listDir":
        counts.folders += 1;
        break;
      case "webSearch":
      case "webFetch":
        counts.webs += 1;
        break;
      case "runTerminal":
        counts.commands += 1;
        break;
      case "editFile":
      case "writeFile":
        counts.edits += 1;
        break;
      default:
        break;
    }
  }
  return counts;
}

type StepItem = { kind: "wave"; nodeIds: string[] } | { kind: "cluster"; cluster: ClusterMeta };

/** 轮次内的步骤：智能紧凑时把连续 ≥3 个同类无错工具折成一张聚簇卡 */
function buildStepsForTurn(
  turn: TraceTurn,
  doc: TraceDocument,
  opts: GraphLayoutOptions,
): StepItem[] {
  const waves = turn.waves;
  if (!opts.compactTools) {
    return waves.map((wave) => ({ kind: "wave", nodeIds: wave.nodeIds }));
  }

  const steps: StepItem[] = [];
  let index = 0;
  let clusterSeq = 0;
  while (index < waves.length) {
    const wave = waves[index];
    const first =
      wave && wave.nodeIds.length === 1 ? doc.nodesById[wave.nodeIds[0] ?? ""] : undefined;
    if (!first || first.kind !== "tool" || first.status === "error" || !first.bucket) {
      steps.push({ kind: "wave", nodeIds: wave?.nodeIds ?? [] });
      index += 1;
      continue;
    }

    const bucket = first.bucket;
    const runNodes: TraceNode[] = [first];
    let next = index + 1;
    while (next < waves.length) {
      const candidateWave = waves[next];
      const candidate =
        candidateWave && candidateWave.nodeIds.length === 1
          ? doc.nodesById[candidateWave.nodeIds[0] ?? ""]
          : undefined;
      if (
        !candidate ||
        candidate.kind !== "tool" ||
        candidate.status === "error" ||
        candidate.bucket !== bucket
      ) {
        break;
      }
      runNodes.push(candidate);
      next += 1;
    }

    if (runNodes.length < GRAPH_METRICS.CLUSTER_THRESHOLD) {
      for (const node of runNodes) {
        steps.push({ kind: "wave", nodeIds: [node.id] });
      }
    } else {
      const clusterId = `cluster:${turn.id}:${clusterSeq}:${runNodes[0]?.id ?? ""}`;
      clusterSeq += 1;
      if (opts.expandedClusters.has(clusterId)) {
        for (const node of runNodes) {
          steps.push({ kind: "wave", nodeIds: [node.id] });
        }
      } else {
        const starts = runNodes.map((node) => node.start).filter((value): value is number => value !== undefined);
        const ends = runNodes.map((node) => node.end).filter((value): value is number => value !== undefined);
        steps.push({
          kind: "cluster",
          cluster: {
            id: clusterId,
            bucket,
            nodeIds: runNodes.map((node) => node.id),
            counts: clusterCounts(runNodes),
            durationMs:
              starts.length && ends.length
                ? Math.max(0, Math.max(...ends) - Math.min(...starts))
                : undefined,
          },
        });
      }
    }
    index = next;
  }
  return steps;
}

function measureTurnBlock(
  turn: TraceTurn,
  doc: TraceDocument,
  opts: GraphLayoutOptions,
): MeasuredBlock {
  const { NODE_W, NODE_H, CLUSTER_H, GAP_X, GAP_Y, PAD_X, HEADER_H, PAD_BOTTOM, MAX_COLS } =
    GRAPH_METRICS;
  const collapsed = opts.collapsedTurns.has(turn.id);

  if (collapsed) {
    const width = NODE_W + PAD_X * 2;
    const group: LayoutGroup = {
      id: `grp-${turn.id}`,
      kind: "turn",
      title: turn.label,
      status: turn.status,
      laneId: turn.laneId,
      turnId: turn.id,
      collapsed: true,
      stepCount: turn.nodeIds.length,
      durationMs: turn.durationMs,
      x: 0,
      y: 0,
      width,
      height: HEADER_H,
    };
    return {
      width,
      height: HEADER_H,
      groups: [group],
      nodes: [],
      edges: [],
      entryPorts: [{ id: group.id, x: width / 2, y: 0, status: turn.status }],
      exitPorts: [{ id: group.id, x: width / 2, y: HEADER_H, status: turn.status }],
    };
  }

  interface PlacedStep {
    width: number;
    height: number;
    nodes: LayoutNode[];
    entryPorts: Port[];
    exitPorts: Port[];
    isMulti: boolean;
  }

  const placed: PlacedStep[] = [];
  let maxContentW: number = NODE_W;

  for (const step of buildStepsForTurn(turn, doc, opts)) {
    if (step.kind === "cluster") {
      const cluster = step.cluster;
      const node: LayoutNode = {
        id: cluster.id,
        kind: "cluster",
        x: 0,
        y: 0,
        width: NODE_W,
        height: CLUSTER_H,
        turnId: turn.id,
        laneId: turn.laneId,
        depth: 0,
        cluster,
      };
      placed.push({
        width: NODE_W,
        height: CLUSTER_H,
        nodes: [node],
        entryPorts: [{ id: cluster.id, x: NODE_W / 2, y: 0, status: "done" }],
        exitPorts: [{ id: cluster.id, x: NODE_W / 2, y: CLUSTER_H, status: "done" }],
        isMulti: false,
      });
      maxContentW = Math.max(maxContentW, NODE_W);
      continue;
    }

    const waveNodes = step.nodeIds
      .map((id) => doc.nodesById[id])
      .filter((node): node is TraceNode => node !== undefined);
    if (!waveNodes.length) {
      continue;
    }

    const rows: TraceNode[][] = [];
    for (let start = 0; start < waveNodes.length; start += MAX_COLS) {
      rows.push(waveNodes.slice(start, start + MAX_COLS));
    }
    const waveW = Math.max(
      ...rows.map((row) => row.length * NODE_W + (row.length - 1) * GAP_X),
      NODE_W,
    );

    const rowNodes: LayoutNode[] = [];
    const entryPorts: Port[] = [];
    const exitPorts: Port[] = [];
    let cursorY = 0;

    rows.forEach((row, rowIndex) => {
      const rowW = row.length * NODE_W + (row.length - 1) * GAP_X;
      const startX = (waveW - rowW) / 2;
      let rowH: number = NODE_H;
      row.forEach((waveNode, columnIndex) => {
        const height = nodeHeightOf(waveNode);
        rowH = Math.max(rowH, height);
        const x = startX + columnIndex * (NODE_W + GAP_X);
        rowNodes.push({
          id: waveNode.id,
          kind: "node",
          x,
          y: cursorY,
          width: NODE_W,
          height,
          turnId: turn.id,
          laneId: turn.laneId,
          depth: 0,
          node: waveNode,
        });
        if (rowIndex === 0) {
          entryPorts.push({ id: waveNode.id, x: x + NODE_W / 2, y: cursorY, status: waveNode.status });
        }
        if (rowIndex === rows.length - 1) {
          exitPorts.push({
            id: waveNode.id,
            x: x + NODE_W / 2,
            y: cursorY + height,
            status: waveNode.status,
          });
        }
      });
      cursorY += rowH + (rowIndex < rows.length - 1 ? GRAPH_METRICS.WAVE_SUBROW_GAP_Y : 0);
    });

    maxContentW = Math.max(maxContentW, waveW);
    placed.push({
      width: waveW,
      height: cursorY,
      nodes: rowNodes,
      entryPorts,
      exitPorts,
      isMulti: waveNodes.length > 1,
    });
  }

  const groupW = Math.max(maxContentW + PAD_X * 2, NODE_W);
  let cursorY = HEADER_H + 10;
  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];
  let firstPorts: Port[] = [];
  let prevPorts: Port[] = [];
  let prevWasMulti = false;

  placed.forEach((step, index) => {
    const dx = (groupW - step.width) / 2;
    const dy = cursorY;
    const shiftPort = (port: Port) => ({ ...port, x: port.x + dx, y: port.y + dy });
    const entries = step.entryPorts.map(shiftPort);
    const exits = step.exitPorts.map(shiftPort);

    nodes.push(...step.nodes.map((node) => ({ ...node, x: node.x + dx, y: node.y + dy })));

    if (index === 0) {
      firstPorts = entries;
    } else if (prevPorts.length && entries.length) {
      const isParallel = prevWasMulti || step.isMulti || prevPorts.length > 1 || entries.length > 1;
      for (const from of prevPorts) {
        for (const to of entries) {
          edges.push(
            makeEdge(
              `e-flow-${from.id}-${to.id}`,
              isParallel ? "parallel" : "flow",
              from.id,
              to.id,
              from.x,
              from.y,
              to.x,
              to.y,
              from.status,
            ),
          );
        }
      }
    }

    prevPorts = exits;
    prevWasMulti = step.isMulti;
    cursorY += step.height + (index < placed.length - 1 ? GAP_Y : 0);
  });

  const groupH = cursorY + PAD_BOTTOM;
  const group: LayoutGroup = {
    id: `grp-${turn.id}`,
    kind: "turn",
    title: turn.label,
    status: turn.status,
    laneId: turn.laneId,
    turnId: turn.id,
    collapsed: false,
    stepCount: turn.nodeIds.length,
    durationMs: turn.durationMs,
    x: 0,
    y: 0,
    width: groupW,
    height: groupH,
  };

  return {
    width: groupW,
    height: groupH,
    groups: [group],
    nodes,
    edges,
    entryPorts: firstPorts.length
      ? firstPorts
      : [{ id: group.id, x: groupW / 2, y: 0, status: turn.status }],
    exitPorts: prevPorts.length
      ? prevPorts
      : [{ id: group.id, x: groupW / 2, y: groupH, status: turn.status }],
  };
}

/** 单列纵向流：轮次从上到下排列，跨轮连线是竖向贝塞尔（与旧行为一致） */
function layoutSingleColumn(blocks: readonly MeasuredBlock[]): GraphLayout {
  const maxW = blocks.reduce<number>(
    (width, block) => Math.max(width, block.width),
    GRAPH_METRICS.NODE_W,
  );
  const pad = GRAPH_METRICS.CANVAS_PAD;
  const totalW = maxW + pad * 2;
  let cursorY = pad;
  const groups: LayoutGroup[] = [];
  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];
  let prevExits: Port[] = [];

  blocks.forEach((block, index) => {
    const dx = (totalW - block.width) / 2;
    const placed = translateBlock(block, dx, cursorY);
    groups.push(...placed.groups);
    nodes.push(...placed.nodes);
    edges.push(...placed.edges);
    if (index > 0 && prevExits.length && placed.entryPorts.length) {
      for (const from of prevExits) {
        for (const to of placed.entryPorts) {
          edges.push(
            makeEdge(
              `e-turn-${from.id}-${to.id}`,
              "flow",
              from.id,
              to.id,
              from.x,
              from.y,
              to.x,
              to.y,
              from.status,
            ),
          );
        }
      }
    }
    prevExits = placed.exitPorts;
    cursorY += block.height + (index < blocks.length - 1 ? GRAPH_METRICS.TURN_GAP_Y : 0);
  });

  return { width: totalW, height: cursorY + pad, groups, nodes, edges, nodeById: indexNodes(nodes) };
}

function indexNodes(nodes: readonly LayoutNode[]): Record<string, LayoutNode> {
  const nodeById: Record<string, LayoutNode> = {};
  for (const node of nodes) {
    nodeById[node.id] = node;
  }
  return nodeById;
}

/**
 * 多列网格：轮次按时间顺序从左到右排，满一行换行。
 * 列宽取最宽轮次卡片、行高取该行最高卡片，保证卡片永不重叠；
 * 跨轮连线只画在同一行内（横向贝塞尔），换行处不连，避免曲线横穿别的卡片。
 */
function layoutGrid(blocks: readonly MeasuredBlock[], columns: number): GraphLayout {
  const { CANVAS_PAD, TURN_GAP_X, TURN_GAP_Y, HEADER_H, NODE_W } = GRAPH_METRICS;
  const colW = blocks.reduce<number>((width, block) => Math.max(width, block.width), NODE_W);
  const rows: MeasuredBlock[][] = [];
  for (let start = 0; start < blocks.length; start += columns) {
    rows.push(blocks.slice(start, start + columns));
  }

  const groups: LayoutGroup[] = [];
  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];
  let cursorY = CANVAS_PAD;

  rows.forEach((row) => {
    const rowH = row.reduce((height, block) => Math.max(height, block.height), 0);
    const placedRow: MeasuredBlock[] = [];
    row.forEach((block, column) => {
      const cellX = CANVAS_PAD + column * (colW + TURN_GAP_X);
      const placed = translateBlock(block, cellX + (colW - block.width) / 2, cursorY);
      placedRow.push(placed);
      groups.push(...placed.groups);
      nodes.push(...placed.nodes);
      edges.push(...placed.edges);
    });
    // 行内相邻轮次：从上一张卡右缘连到下一张卡左缘，走轮次头中线的水平位置
    for (let column = 1; column < placedRow.length; column += 1) {
      const fromGroup = placedRow[column - 1]!.groups[0]!;
      const toGroup = placedRow[column]!.groups[0]!;
      const x1 = fromGroup.x + fromGroup.width;
      const y1 = fromGroup.y + HEADER_H / 2;
      const x2 = toGroup.x;
      const y2 = toGroup.y + HEADER_H / 2;
      edges.push({
        id: `e-turn-h-${fromGroup.id}-${toGroup.id}`,
        kind: "flow",
        fromId: fromGroup.id,
        toId: toGroup.id,
        x1,
        y1,
        x2,
        y2,
        d: bezierPathH(x1, y1, x2, y2),
        status: fromGroup.status,
      });
    }
    cursorY += rowH + TURN_GAP_Y;
  });

  const totalW = CANVAS_PAD * 2 + columns * colW + (columns - 1) * TURN_GAP_X;
  return {
    width: totalW,
    height: cursorY - TURN_GAP_Y + CANVAS_PAD,
    groups,
    nodes,
    edges,
    nodeById: indexNodes(nodes),
  };
}

export function buildGraphLayout(doc: TraceDocument, opts: GraphLayoutOptions): GraphLayout {
  const rootTurns = doc.rootTurnIds
    .map((id) => doc.turnsById[id])
    .filter((turn): turn is TraceTurn => turn !== undefined)
    .filter((turn) => !opts.visibleTurnIds || opts.visibleTurnIds.has(turn.id));

  if (!rootTurns.length) {
    return { width: 400, height: 240, groups: [], nodes: [], edges: [], nodeById: {} };
  }

  const blocks = rootTurns.map((turn) => measureTurnBlock(turn, doc, opts));
  const columns = Math.max(1, Math.min(opts.columns ?? 1, blocks.length));
  return columns > 1 ? layoutGrid(blocks, columns) : layoutSingleColumn(blocks);
}
