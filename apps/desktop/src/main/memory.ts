import { randomUUID } from "node:crypto";
import { access, constants, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

import type {
  DeviceMemory,
  MemoryConsolidationResult,
  MemoryNote,
  MemoryScope,
  MemorySnapshot,
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

/** 备注清洗：去空白、限长、限量（新的在前保留，超量裁掉最旧的尾部） */
export function normalizeNotes(notes: MemoryNote[]): MemoryNote[] {
  const cleaned = notes
    .map((note) => ({
      id: typeof note?.id === "string" ? note.id : randomUUID(),
      text: String(note?.text ?? "")
        .trim()
        .slice(0, NOTE_TEXT_LIMIT),
      createdAt: Number(note?.createdAt) || Date.now(),
    }))
    .filter((note) => note.text.length > 0);
  return cleaned.slice(0, NOTES_LIMIT);
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
      notes: normalizeNotes(Array.isArray(parsed.notes) ? parsed.notes : []),
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

/** 追加一条备注（device/user），返回更新后的整份记忆 */
export async function appendMemoryNote(
  scope: MemoryScope,
  text: string,
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
    device.notes = normalizeNotes([
      { id: randomUUID(), text: content, createdAt: Date.now() },
      ...device.notes,
    ]);
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

/** 原子写回：先写临时文件再 rename，进程中断不会留下半个 JSON */
async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await mkdir(zenMemoryDir(), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(data, null, 2), "utf8");
  await rename(temp, file);
}

/** 模型输出里剥掉 Markdown 代码围栏后解析 JSON；数组或 {notes:[]} 均接受 */
function parseModelJson(raw: string): MemoryNote[] {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    // 截断的 JSON（Unexpected end of JSON input）大多因推理模型烧尽输出预算；
    // 原始 SyntaxError 文案对用户毫无信息量，翻译成可行动的提示
    throw new Error(
      `模型输出不是完整 JSON（收到 ${stripped.length} 字符，开头为「${stripped.slice(0, 50)}…」，疑似被输出预算截断）。` +
        "可重试一次；若仍失败，请到设置中换用非推理/轻量模型作为默认模型",
    );
  }
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { notes?: unknown })?.notes)
      ? (parsed as { notes: unknown[] }).notes
      : [];
  return normalizeNotes(list as MemoryNote[]);
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
    const raw = await completeOnce(
      `以下是待整理的记忆备注（JSON 数组）。请合并重复项、改写啰嗦表述，输出整固后的同 schema JSON 数组。\n\n${JSON.stringify(before, null, 2)}`,
      {
        maxTokens: CONSOLIDATE_MAX_TOKENS,
        // 推理模型默认档位会把输出预算烧在思考上（实测 glm-5.3 高档截断 JSON）：
        // 整固是结构改写任务，降到最低推理档 + 放宽超时（与 commit 生成同款验证过的参数）
        reasoningEffort: "lowest",
        timeoutMs: 180_000,
        system:
          "你是记忆整理助手。把输入的备注列表合并、去重、改写成精炼且保留全部长期信息的条目。" +
          '只输出 JSON 数组，不要输出任何解释或 Markdown 代码块。每条形如 {"id":string,"text":string,"createdAt":number}；' +
          "id 与 createdAt 尽量沿用输入（合并时取较早的 createdAt），text 可改写但不得编造输入中不存在的事实、不得丢弃任何有用信息。" +
          "输出必须是单个完整、可直接解析的 JSON 数组，绝不截断。",
      },
    );
    const after = parseModelJson(raw);
    if (!after.length) {
      // 模型清空了全部条目：视为失败，宁可不动也不误删
      throw new Error("模型未返回任何有效条目");
    }
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
      await writeJsonAtomic(deviceFile(), { ...device, notes: cleaned });
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
    const notes = renderNotes(device.notes);
    if (notes.length) {
      lines.push("设备备注：", ...notes);
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
