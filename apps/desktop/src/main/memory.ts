import { randomUUID } from "node:crypto";
import { access, constants, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

import type { DeviceMemory, MemoryNote, MemoryScope, MemorySnapshot, UserMemory } from "@zen/shared";

import { zenMemoryDir } from "./zen-dir";

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
