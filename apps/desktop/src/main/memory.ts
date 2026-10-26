import { randomUUID } from "node:crypto";
import { access, constants, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

import { MEMORY_CATEGORIES } from "@zen/shared";
import type {
  DeviceMemory,
  DeviceMemoryIndex,
  MemoryCategory,
  MemoryConsolidationResult,
  MemoryNote,
  MemoryNoteGroup,
  MemoryScope,
  MemorySnapshot,
  MemoryView,
  UserMemory,
} from "@zen/shared";

import { zenMemoryDir } from "./zen-dir";
import { completeOnce } from "./model-api";

/**
 * 记忆域（~/.zen/memory）：设备环境快照（启动自动采集）+ 备注（Agent updateMemory / 用户设置页）。
 * 会话启动时把记忆渲染成文本注入系统提示词，避免 Agent 每次重新探测路径与命令。
 */

const NOTES_LIMIT = 100;
const NOTE_TEXT_LIMIT = 500;
/** 注入提示词的备注上限：记忆是背景信息，不挤占任务上下文 */
const NOTES_PROMPT_LIMIT = 20;

/** 采集进设备快照的常用命令行工具（找不到的不落记录） */
const SCAN_TOOLS = [
  "node",
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "git",
  "python3",
  "python",
  "uv",
  "docker",
  "code",
] as const;

function deviceFile(): string {
  return join(zenMemoryDir(), "device.json");
}

function userFile(): string {
  return join(zenMemoryDir(), "user.json");
}

/** 备注分类关键词表：命中越多越优先；都不命中归 other（设备域专用） */
const CATEGORY_KEYWORDS: Record<Exclude<MemoryCategory, "other">, string[]> = {
  project: [
    "项目", "仓库", "工作区", "工作目录", "部署", "构建", "分支", "端口", "服务", "镜像仓库",
    "repo", "workspace", "project", "branch", "build", "deploy", "port", "server", "monorepo",
  ],
  hardware: [
    "硬件", "机型", "内存", "磁盘", "芯片", "显示器", "外设", "键盘", "显卡", "芯片组",
    "cpu", "gpu", "ram", "disk", "macbook", "imac", "ssd", "monitor",
  ],
  env: [
    "环境变量", "环境", "代理", "证书", "时区", "语言环境", "系统版本",
    "env", "path=", "shell", "zsh", "bash", "proxy", "certificate", "locale", "timezone", "docker",
  ],
  tool: [
    "工具", "命令", "依赖", "安装", "全局",
    "cli", "npm", "pnpm", "yarn", "bun", "python", "node", "git", "brew", "uv", "tool", "binary",
  ],
};

/**
 * 备注归类：按关键词命中数打分，取最高者；同分按 MEMORY_CATEGORIES 顺序取前，
 * 全不命中归 other。纯本地启发式——不必完美，能让人/Agent 按类查找即可。
 */
export function inferCategory(text: string): MemoryCategory {
  const lower = text.toLowerCase();
  let best: MemoryCategory = "other";
  let bestScore = 0;
  for (const category of MEMORY_CATEGORIES) {
    if (category === "other") {
      continue;
    }
    const score = CATEGORY_KEYWORDS[category].reduce(
      (total, keyword) => (lower.includes(keyword) ? total + 1 : total),
      0,
    );
    if (score > bestScore) {
      best = category;
      bestScore = score;
    }
  }
  return best;
}

function isMemoryCategory(value: unknown): value is MemoryCategory {
  return typeof value === "string" && (MEMORY_CATEGORIES as readonly string[]).includes(value);
}

/** 备注清洗：去空白、限长、限量（新的在前保留，超量裁掉最旧的尾部） */
export function normalizeNotes(notes: MemoryNote[]): MemoryNote[] {
  const cleaned = notes
    .map((note) => ({
      id: typeof note?.id === "string" ? note.id : randomUUID(),
      text: String(note?.text ?? "")
        .trim()
        .slice(0, NOTE_TEXT_LIMIT),
      createdAt: Number(note?.createdAt) || Date.now(),
      ...(isMemoryCategory(note?.category) ? { category: note.category } : {}),
    }))
    .filter((note) => note.text.length > 0);
  return cleaned.slice(0, NOTES_LIMIT);
}

/** 设备域备注补齐分类：旧数据没有 category 时按内容推断并固定下来 */
function withCategories(notes: MemoryNote[]): MemoryNote[] {
  return notes.map((note) => ({ ...note, category: note.category ?? inferCategory(note.text) }));
}

/** 系统提示词里的分类标签（提示词本身是中文，不随界面语言切换） */
const CATEGORY_PROMPT_LABELS: Record<MemoryCategory, string> = {
  project: "项目",
  hardware: "硬件",
  env: "环境变量",
  tool: "工具链",
  other: "其他",
};

/** 分类索引：按 MEMORY_CATEGORIES 顺序，只保留有内容的分类 */
export function groupMemoryNotes(notes: MemoryNote[]): MemoryNoteGroup[] {
  const groups: MemoryNoteGroup[] = [];
  for (const category of MEMORY_CATEGORIES) {
    const items = notes.filter((note) => (note.category ?? inferCategory(note.text)) === category);
    if (!items.length) {
      continue;
    }
    groups.push({
      category,
      count: items.length,
      chars: items.reduce((total, note) => total + note.text.length, 0),
      previews: items.map((note) => note.text.replace(/\s+/g, " ").slice(0, 40)),
    });
  }
  return groups;
}

function clampText(text: string): string {
  return text.trim().slice(0, NOTE_TEXT_LIMIT);
}

/** PATH 解析：Windows 命令多为 .cmd/.exe，POSIX 查可执行位 */
export function candidateNames(name: string, platform: string): string[] {
  if (platform !== "win32") {
    return [name];
  }
  return [`${name}.cmd`, `${name}.exe`, `${name}.bat`, name];
}

/** 在 PATH 目录里找工具的绝对路径；找不到返回 null（安全降级，不抛错） */
export async function findToolOnPath(
  name: string,
  pathValue: string,
  platform: string,
): Promise<string | null> {
  const dirs = pathValue.split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const candidate of candidateNames(name, platform)) {
      const full = join(dir, candidate);
      try {
        await access(
          full,
          platform === "win32" ? constants.F_OK : constants.X_OK,
        );
        return full;
      } catch {
        // 该目录没有此候选名，继续
      }
    }
  }
  return null;
}

function defaultShell(platform: string): string {
  // 三方分支：macOS/Linux 取 $SHELL；Windows 取 COMSPEC（缺省 cmd.exe）
  if (platform === "win32") {
    return process.env["COMSPEC"] ?? "cmd.exe";
  }
  return process.env["SHELL"] ?? "/bin/sh";
}

async function scanTools(platform: string): Promise<Record<string, string>> {
  const pathValue = process.env["PATH"] ?? process.env["Path"] ?? "";
  const found = await Promise.all(
    SCAN_TOOLS.map(async (name) => [name as string, await findToolOnPath(name, pathValue, platform)] as const),
  );
  return Object.fromEntries(
    found.filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

/** 采集设备环境快照（覆盖旧快照，保留备注） */
export async function collectDeviceMemory(): Promise<DeviceMemory> {
  const previous = await readDeviceMemory();
  const platform = process.platform;
  const tools = await scanTools(platform);
  const resolved = Intl.DateTimeFormat().resolvedOptions();
  const device: DeviceMemory = {
    collectedAt: Date.now(),
    platform,
    arch: process.arch,
    home: homedir(),
    shell: defaultShell(platform),
    locale: resolved.locale,
    timezone: resolved.timeZone,
    tools,
    notes: previous?.notes ?? [],
  };
  await writeDeviceMemory(device);
  return device;
}

async function readDeviceMemory(): Promise<DeviceMemory | null> {
  try {
    const raw = await readFile(deviceFile(), "utf8");
    const parsed = JSON.parse(raw) as Partial<DeviceMemory>;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return {
      collectedAt: Number(parsed.collectedAt) || 0,
      platform: String(parsed.platform ?? process.platform),
      arch: String(parsed.arch ?? process.arch),
      home: String(parsed.home ?? homedir()),
      shell: String(parsed.shell ?? defaultShell(process.platform)),
      locale: String(parsed.locale ?? ""),
      timezone: String(parsed.timezone ?? ""),
      tools: parsed.tools && typeof parsed.tools === "object" ? parsed.tools : {},
      notes: withCategories(normalizeNotes(Array.isArray(parsed.notes) ? parsed.notes : [])),
    };
  } catch {
    return null;
  }
}

async function writeDeviceMemory(device: DeviceMemory): Promise<void> {
  await mkdir(zenMemoryDir(), { recursive: true });
  await writeFile(deviceFile(), JSON.stringify(device, null, 2), "utf8");
}

async function readUserMemory(): Promise<UserMemory> {
  try {
    const raw = await readFile(userFile(), "utf8");
    const parsed = JSON.parse(raw) as Partial<UserMemory>;
    return { notes: normalizeNotes(Array.isArray(parsed?.notes) ? parsed.notes : []) };
  } catch {
    return { notes: [] };
  }
}

async function writeUserMemory(user: UserMemory): Promise<void> {
  await mkdir(zenMemoryDir(), { recursive: true });
  await writeFile(userFile(), JSON.stringify(user, null, 2), "utf8");
}

/** 启动时调用：无快照或工具记录为空时才采集，避免每次启动都扫 PATH */
export async function initDeviceMemory(): Promise<void> {
  try {
    const existing = await readDeviceMemory();
    if (!existing || !existing.collectedAt || Object.keys(existing.tools).length === 0) {
      await collectDeviceMemory();
    }
  } catch {
    // 记忆采集失败不阻塞启动
  }
}

export async function readMemorySnapshot(): Promise<MemorySnapshot> {
  const [device, user] = await Promise.all([readDeviceMemory(), readUserMemory()]);
  return { device, user };
}

/** 设备域索引视图：快照元信息 + 备注分类索引，不下发备注正文 */
function toDeviceIndex(device: DeviceMemory | null): DeviceMemoryIndex | null {
  if (!device) {
    return null;
  }
  return {
    collectedAt: device.collectedAt,
    platform: device.platform,
    arch: device.arch,
    home: device.home,
    shell: device.shell,
    locale: device.locale,
    timezone: device.timezone,
    tools: device.tools,
    groups: groupMemoryNotes(device.notes),
  };
}

/**
 * 设置页 / Prompt 用的轻量视图：设备备注只给分类索引（数量 + 摘要），
 * 正文走 readMemoryNotes 按分类按需读取，避免整份记忆每次都进上下文。
 */
export async function readMemoryView(): Promise<MemoryView> {
  const [device, user] = await Promise.all([readDeviceMemory(), readUserMemory()]);
  return { device: toDeviceIndex(device), user };
}

/** 全量快照 → 轻量视图（写操作返回 snapshot，IPC 边界统一转成索引视图） */
export function toMemoryView(snapshot: MemorySnapshot): MemoryView {
  return { device: toDeviceIndex(snapshot.device), user: snapshot.user };
}

/** 按分类（缺省为全部）读取备注正文：供设置页展开与 Agent readMemory 工具按需调用 */
export async function readMemoryNotes(
  scope: MemoryScope,
  category?: MemoryCategory,
): Promise<MemoryNote[]> {
  const notes =
    scope === "user" ? (await readUserMemory()).notes : (await readDeviceMemory())?.notes ?? [];
  if (!category) {
    return notes;
  }
  return notes.filter((note) => (note.category ?? inferCategory(note.text)) === category);
}

/** 追加一条备注（device/user），返回更新后的整份记忆 */
export async function appendMemoryNote(
  scope: MemoryScope,
  text: string,
  category?: MemoryCategory,
): Promise<MemorySnapshot> {
  const content = clampText(text);
  if (!content) {
    return readMemorySnapshot();
  }
  if (scope === "user") {
    const user = await readUserMemory();
    const next: UserMemory = {
      notes: normalizeNotes([{ id: randomUUID(), text: content, createdAt: Date.now() }, ...user.notes]),
    };
    await writeUserMemory(next);
  } else {
    const device = await readDeviceMemory();
    if (!device) {
      return readMemorySnapshot();
    }
    device.notes = withCategories(
      normalizeNotes([
        { id: randomUUID(), text: content, createdAt: Date.now(), category: category ?? inferCategory(content) },
        ...device.notes,
      ]),
    );
    await writeDeviceMemory(device);
  }
  return readMemorySnapshot();
}

export async function removeMemoryNote(scope: MemoryScope, id: string): Promise<MemorySnapshot> {
  if (scope === "user") {
    const user = await readUserMemory();
    await writeUserMemory({ notes: user.notes.filter((note) => note.id !== id) });
  } else {
    const device = await readDeviceMemory();
    if (device) {
      device.notes = device.notes.filter((note) => note.id !== id);
      await writeDeviceMemory(device);
    }
  }
  return readMemorySnapshot();
}

// ---------------------------------------------------------------------------
// 记忆整固：模型把累积 notes 合并/去重/改写成精炼结构。
// 预览（consolidateMemory）不落盘；用户在设置页确认 diff 后才由
// applyMemoryConsolidation 原子写回。任何失败都绝不动原始数据。
// ---------------------------------------------------------------------------

/** 整固输出的 token 预算：条目多时合并结果可能较长，取安全余量 */
const CONSOLIDATE_MAX_TOKENS = 8192;

/**
 * 单批送模型的备注正文上限（字符）。中文大致 1 token/字，6000 字符的一批改写后
 * 仍装得进 CONSOLIDATE_MAX_TOKENS；超过就切批，避免整段输出被模型输出上限截断。
 */
const CONSOLIDATE_BATCH_CHARS = 6000;

const CONSOLIDATE_SYSTEM_PROMPT = [
  "你是记忆整理助手。把输入的备注列表合并、去重、改写成精炼且保留全部长期信息的条目。",
  '每条形如 {"id":string,"text":string}（不要输出 createdAt 等其它字段，程序会补）。',
  "id 沿用输入（合并多条时取其中一个），text 可改写但不得编造输入中不存在的事实、不得丢弃任何有用信息。",
  "输出必须以 [ 开头、以 ] 结尾，是单个完整可直接解析的 JSON 数组；",
  "禁止输出任何解释、前缀、后缀或 Markdown 代码块，绝不截断。",
].join("");

/** 按正文长度把备注切成若干批（保持原有顺序，单条超限也独占一批） */
function splitIntoBatches(notes: MemoryNote[]): MemoryNote[][] {
  const batches: MemoryNote[][] = [];
  let current: MemoryNote[] = [];
  let chars = 0;
  for (const note of notes) {
    if (current.length && chars + note.text.length > CONSOLIDATE_BATCH_CHARS) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(note);
    chars += note.text.length;
  }
  if (current.length) {
    batches.push(current);
  }
  return batches;
}

/** 原子写回：先写临时文件再 rename，进程中断不会留下半个 JSON */
async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await mkdir(zenMemoryDir(), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(data, null, 2), "utf8");
  await rename(temp, file);
}

/**
 * 从模型自由文本里截取第一段结构完整的 JSON（数组或对象）。
 *
 * 推理模型常先输出「Let me organize these notes…」之类的说明再给 JSON，甚至把 JSON
 * 包在 Markdown 围栏里；直接 JSON.parse 整段必然失败。这里做一次括号配平扫描
 * （跳过字符串内的括号与转义），只取第一段闭合完整的内容；没闭合则原样返回，
 * 由调用方按「截断」报错。
 */
function sliceBalancedJson(text: string, start: number): string | null {
  const open = text[start];
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === open) {
      depth += 1;
    } else if (char === close) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }
  return null;
}

/** 截断/不可解析的统一提示：给出收到的字符数与开头，便于判断换模型 */
function truncatedPayloadError(payload: string): Error {
  return new Error(
    `模型输出不是完整 JSON（收到 ${payload.length} 字符，开头为「${payload.slice(0, 50)}…」，疑似被输出预算截断）。` +
      "可重试一次；若仍失败，请到设置中换用非推理/轻量模型作为默认模型",
  );
}

/** JSON.parse 的安全版本：解析失败返回 null，由调用方决定是否继续尝试其它片段 */
function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** 解析结果归一化成 notes：数组本体或 {notes:[...]} 都接受 */
function toNotes(parsed: unknown): MemoryNote[] {
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { notes?: unknown })?.notes)
      ? (parsed as { notes: unknown[] }).notes
      : [];
  return normalizeNotes(list as MemoryNote[]);
}

/**
 * 解析模型输出：优先找 JSON 数组（整固输出约定必须是数组）。
 *
 * 推理模型常先写「Let me organize these notes…」再给 JSON（可能带 Markdown 围栏），
 * 所以从每个 `[` 起点做括号配平尝试；**最早的数组起点若未闭合就判定为输出截断**，
 * 不再往后找——截断数组内部的单个对象仍能被配平，误用会拿到残缺结果。
 * 完全没有数组时才退回 `{notes:[...]}` 形态。
 */
function parseModelJson(raw: string): MemoryNote[] {
  const text = raw.trim();
  const arrayStarts: number[] = [];
  for (let index = text.indexOf("["); index >= 0; index = text.indexOf("[", index + 1)) {
    arrayStarts.push(index);
  }
  let sawCompleteArray = false;
  for (const start of arrayStarts) {
    const slice = sliceBalancedJson(text, start);
    if (!slice) {
      throw truncatedPayloadError(text.slice(start));
    }
    sawCompleteArray = true;
    const notes = toNotes(safeJsonParse(slice));
    if (notes.length) {
      return notes;
    }
  }
  if (!sawCompleteArray) {
    const objectStart = text.indexOf("{");
    if (objectStart >= 0) {
      const slice = sliceBalancedJson(text, objectStart);
      if (slice) {
        const notes = toNotes(safeJsonParse(slice));
        if (notes.length) {
          return notes;
        }
      }
    }
    throw truncatedPayloadError(text);
  }
  // 数组完整但没有任何有效条目：模型把内容清空了，交由调用方按失败处理
  throw new Error("模型未返回任何有效条目");
}

/**
 * 模型只回 id/text：createdAt 按 id（其次按原文）从输入回填，保持列表时序稳定；
 * 都匹配不上（模型新写的条目）用当前时间。
 */
function withInheritedTimestamp(notes: MemoryNote[], before: MemoryNote[]): MemoryNote[] {
  const byId = new Map(before.map((note) => [note.id, note.createdAt]));
  const byText = new Map(before.map((note) => [note.text, note.createdAt]));
  const now = Date.now();
  return notes.map((note) => ({
    ...note,
    createdAt: byId.get(note.id) ?? byText.get(note.text) ?? now,
  }));
}

/** 变化条数：before 中被移除/改写的 + after 中新增/改写的（文本比对） */
function countChangedNotes(before: MemoryNote[], after: MemoryNote[]): number {
  const beforeTexts = new Set(before.map((note) => note.text));
  const afterTexts = new Set(after.map((note) => note.text));
  const removed = before.filter((note) => !afterTexts.has(note.text)).length;
  const added = after.filter((note) => !beforeTexts.has(note.text)).length;
  return removed + added;
}

/**
 * 整固预览：调用当前选中模型把该域 notes 合并/去重/改写，返回 before/after 供审阅。
 * 只算不写——落盘必须走 applyMemoryConsolidation（用户确认 diff 之后）。
 * 模型失败 / JSON 解析失败 / 模型清空了全部条目 → {ok:false, error}，原样保留数据。
 */
export async function consolidateMemory(scope: MemoryScope): Promise<MemoryConsolidationResult> {
  const before =
    scope === "user"
      ? (await readUserMemory()).notes
      : (await readDeviceMemory())?.notes ?? [];
  const unchanged: MemoryConsolidationResult = {
    ok: true,
    scope,
    before,
    after: before,
    changedCount: 0,
  };
  if (!before.length) {
    return unchanged;
  }
  try {
    // 分批整固：一次请求只处理一批备注（每批正文 ≤ CONSOLIDATE_BATCH_CHARS）。
    // 输入只带 id/text，createdAt 这类长数字由本地按 id 回填，省下的输出预算留给正文。
    const merged: MemoryNote[] = [];
    for (const batch of splitIntoBatches(before)) {
      const payload = batch.map((note) => ({ id: note.id, text: note.text }));
      const raw = await completeOnce(
        `以下是待整理的记忆备注（JSON 数组，字段 id/text）。请合并重复项、改写啰嗦表述，输出整固后的同 schema JSON 数组。\n\n${JSON.stringify(payload)}`,
        {
          maxTokens: CONSOLIDATE_MAX_TOKENS,
          // 推理模型默认档位会把输出预算烧在思考上（实测 glm-5.3 高档截断 JSON）：
          // 整固是结构改写任务，降到最低推理档 + 放宽超时（与 commit 生成同款验证过的参数）
          reasoningEffort: "lowest",
          timeoutMs: 180_000,
          system: CONSOLIDATE_SYSTEM_PROMPT,
        },
      );
      const part = parseModelJson(raw);
      if (!part.length) {
        // 模型清空了这一批的条目：视为失败，宁可不动也不误删
        throw new Error("模型未返回任何有效条目");
      }
      merged.push(...part);
    }
    // 分批之间无法互相合并：做一次精确去重（同文本保留首条），再回填 createdAt
    const seen = new Set<string>();
    const deduped = merged.filter((note) => {
      const key = note.text.trim();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
    const after = withInheritedTimestamp(deduped, before);
    return { ...unchanged, after, changedCount: countChangedNotes(before, after) };
  } catch (error) {
    return {
      ...unchanged,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 应用整固结果：把预览通过审阅的 notes 原子写回（临时文件 + rename）。
 * device 域只替换 notes，快照其余字段（collectedAt/tools 等）保持不变。
 */
export async function applyMemoryConsolidation(
  scope: MemoryScope,
  notes: MemoryNote[],
): Promise<MemorySnapshot> {
  const cleaned = normalizeNotes(notes);
  if (scope === "user") {
    await writeJsonAtomic(userFile(), { notes: cleaned });
  } else {
    const device = await readDeviceMemory();
    if (device) {
      await writeJsonAtomic(deviceFile(), { ...device, notes: withCategories(cleaned) });
    }
  }
  return readMemorySnapshot();
}


function renderNotes(notes: MemoryNote[]): string[] {
  return notes
    .slice(0, NOTES_PROMPT_LIMIT)
    .map((note) => `- ${note.text}`);
}

/** 记忆 → 系统提示词文本块（两域都可能为空；全空返回 undefined 不注入） */
export function renderMemoryContext(snapshot: MemorySnapshot): string | undefined {
  const parts: string[] = [];
  const device = snapshot.device;
  if (device?.collectedAt) {
    const lines = [
      `系统：${device.platform} ${device.arch}`,
      `用户目录：${device.home}`,
      `Shell：${device.shell}`,
    ];
    if (device.timezone || device.locale) {
      lines.push(`时区/语言：${[device.timezone, device.locale].filter(Boolean).join(" / ")}`);
    }
    const toolText = Object.entries(device.tools)
      .map(([name, path]) => `${name}=${path}`)
      .join("  ");
    if (toolText) {
      lines.push(`常用工具：${toolText}`);
    }
    const groups = groupMemoryNotes(device.notes);
    if (groups.length) {
      const total = groups.reduce((sum, group) => sum + group.count, 0);
      lines.push(
        `设备备注索引（共 ${total} 条，按分类汇总；需要正文时调用 readMemory 工具读取对应分类，不要凭摘要猜测）：`,
        ...groups.map((group) => {
          const preview = group.previews.slice(0, 2).join("；");
          return `- ${CATEGORY_PROMPT_LABELS[group.category]}（${group.count} 条）：${preview}${group.count > 2 ? " …" : ""}`;
        }),
      );
    }
    parts.push(
      "设备环境记忆（持久记忆，供直接引用以避免重复探测路径与命令；不确定时仍可现场核实）：\n" +
        lines.map((line) => `- ${line}`).join("\n"),
    );
  }
  const userNotes = renderNotes(snapshot.user.notes);
  if (userNotes.length) {
    parts.push(
      "用户习惯记忆（持久记忆，遵循其中与当前任务相关的偏好）：\n" + userNotes.join("\n"),
    );
  }
  return parts.length ? parts.join("\n\n") : undefined;
}
