import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { MEMORY_FACT_KINDS } from "@zen/shared";
import type {
  ConversationMemoryList,
  ConversationMemorySettings,
  ConversationMemoryState,
  ConversationMemoryStats,
  MemoryEpisode,
  MemoryFact,
  MemoryFactKind,
  MemoryIngestMessage,
  MemoryIngestResult,
  MemoryModelRef,
  MemoryRecallHit,
} from "@zen/shared";

import { completeOnce } from "./model-api";
import { getSelection } from "./model-db";
import { zenMemoryDir } from "./zen-dir";

/**
 * 对话记忆（对照 nomi 的长期记忆）：会话摘要（episodes）、关于用户的事实（facts）、
 * 用户档案（persona.md）与召回设置。
 *
 * 与 memory.ts 的设备/习惯记忆各自独立：只读写 memory 目录下自己的 4 个文件，
 * 绝不覆盖 device.json / user.json。所有写入走「临时文件 + rename」原子替换。
 */

const EPISODES_LIMIT = 300;
const FACTS_LIMIT = 200;
const SUMMARY_LIMIT = 1600;
const FACT_TEXT_LIMIT = 200;
const TITLE_LIMIT = 120;
const KEYWORDS_LIMIT = 12;
const KEYWORD_LIMIT = 24;
const PERSONA_LIMIT = 8000;
/** 注入提示词的召回文本总长上限：记忆是背景信息，不挤占任务上下文 */
const RECALL_BLOCK_LIMIT = 1200;
/** 手动 ingest 的最短条件：条数与正文总长（force 时跳过） */
const INGEST_MIN_MESSAGES = 4;
const INGEST_MIN_CHARS = 400;
/** 送模型的对话正文上限（保留最近的尾部） */
const INGEST_INPUT_CHARS = 12_000;
/** 事实近似重复阈值：字符级最长公共子串 / 较短串长度 */
const FACT_DUPLICATE_RATIO = 0.85;
/** 自动摘要节流：同一会话 5 分钟内不重复、消息数不足 8 条跳过 */
const AUTO_INGEST_MIN_INTERVAL_MS = 5 * 60_000;
const AUTO_INGEST_MIN_MESSAGES = 8;
const INGEST_MAX_TOKENS = 4096;

/** 注入提示词的用户档案上限（字符） */
const PERSONA_PROMPT_LIMIT = 1200;

export const DEFAULT_CONVERSATION_MEMORY_SETTINGS: ConversationMemorySettings = {
  enabled: false,
  autoSummarize: false,
  autoExtractFacts: false,
  recall: false,
  topK: 3,
  model: null,
};

function episodesFile(): string {
  return join(zenMemoryDir(), "episodes.json");
}

function factsFile(): string {
  return join(zenMemoryDir(), "facts.json");
}

function personaFile(): string {
  return join(zenMemoryDir(), "persona.md");
}

function settingsFile(): string {
  return join(zenMemoryDir(), "conversation-settings.json");
}

/** 数据变化通知（广播由 memory-ipc 注册，避免本模块直接依赖 electron） */
type ConversationMemoryNotifier = () => void;
let notifier: ConversationMemoryNotifier | null = null;

export function setConversationMemoryNotifier(fn: ConversationMemoryNotifier | null): void {
  notifier = fn;
}

function notifyChanged(): void {
  try {
    notifier?.();
  } catch {
    // 广播失败不影响已落盘的数据
  }
}

/** 原子写 JSON：先写临时文件再 rename，进程中断不会留下半个文件 */
async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await writeTextAtomic(file, JSON.stringify(data, null, 2));
}

async function writeTextAtomic(file: string, text: string): Promise<void> {
  await mkdir(zenMemoryDir(), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, text, "utf8");
  await rename(temp, file);
}

/** 读 JSON：文件缺失 / 坏 JSON / 结构不符一律读成 null，由调用方给空结构 */
async function readJsonFile(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function isFactKind(value: unknown): value is MemoryFactKind {
  return typeof value === "string" && (MEMORY_FACT_KINDS as readonly string[]).includes(value);
}

function clampTopK(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return DEFAULT_CONVERSATION_MEMORY_SETTINGS.topK;
  }
  return Math.min(8, Math.max(1, Math.round(num)));
}

function normalizeKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const keyword = item.trim().slice(0, KEYWORD_LIMIT);
    if (!keyword || seen.has(keyword)) {
      continue;
    }
    seen.add(keyword);
    out.push(keyword);
    if (out.length >= KEYWORDS_LIMIT) {
      break;
    }
  }
  return out;
}

function normalizeEpisode(value: unknown): MemoryEpisode | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Partial<MemoryEpisode>;
  const title = typeof raw.title === "string" ? raw.title.trim().slice(0, TITLE_LIMIT) : "";
  const summary = typeof raw.summary === "string" ? raw.summary.trim().slice(0, SUMMARY_LIMIT) : "";
  if (!title && !summary) {
    return null;
  }
  const createdAt = Number(raw.createdAt) || Date.now();
  const messageCount = Math.max(0, Math.trunc(Number(raw.messageCount) || 0));
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : randomUUID(),
    sessionId: typeof raw.sessionId === "string" ? raw.sessionId : "",
    workspaceId: typeof raw.workspaceId === "string" ? raw.workspaceId : "",
    title: title || summary.slice(0, 40),
    summary: summary || title,
    keywords: normalizeKeywords(raw.keywords),
    messageCount,
    pinned: raw.pinned === true,
    edited: raw.edited === true,
    createdAt,
    updatedAt: Number(raw.updatedAt) || createdAt,
  };
}

function normalizeFact(value: unknown): MemoryFact | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Partial<MemoryFact>;
  const text = typeof raw.text === "string" ? raw.text.trim().slice(0, FACT_TEXT_LIMIT) : "";
  if (!text || !isFactKind(raw.kind)) {
    return null;
  }
  const createdAt = Number(raw.createdAt) || Date.now();
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : randomUUID(),
    kind: raw.kind,
    text,
    source: raw.source === "user" ? "user" : "auto",
    pinned: raw.pinned === true,
    ...(typeof raw.sessionId === "string" && raw.sessionId ? { sessionId: raw.sessionId } : {}),
    createdAt,
    updatedAt: Number(raw.updatedAt) || createdAt,
  };
}

/** 超量丢最旧的未置顶条目；列表顺序 = 置顶在前 + 更新时间倒序 */
function limitEpisodes(list: MemoryEpisode[]): MemoryEpisode[] {
  const sorted = [...list].sort((a, b) => b.updatedAt - a.updatedAt);
  const pinned = sorted.filter((item) => item.pinned);
  const rest = sorted.filter((item) => !item.pinned);
  return [...pinned, ...rest].slice(0, EPISODES_LIMIT);
}

function limitFacts(list: MemoryFact[]): MemoryFact[] {
  const sorted = [...list].sort((a, b) => b.updatedAt - a.updatedAt);
  const pinned = sorted.filter((item) => item.pinned);
  const rest = sorted.filter((item) => !item.pinned);
  return [...pinned, ...rest].slice(0, FACTS_LIMIT);
}

async function readEpisodes(): Promise<MemoryEpisode[]> {
  const parsed = await readJsonFile(episodesFile());
  if (!Array.isArray(parsed)) {
    return [];
  }
  return limitEpisodes(
    parsed.map(normalizeEpisode).filter((item): item is MemoryEpisode => item !== null),
  );
}

async function readFacts(): Promise<MemoryFact[]> {
  const parsed = await readJsonFile(factsFile());
  if (!Array.isArray(parsed)) {
    return [];
  }
  return limitFacts(parsed.map(normalizeFact).filter((item): item is MemoryFact => item !== null));
}

function sanitizeModelRef(value: unknown): MemoryModelRef | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Partial<MemoryModelRef>;
  if (typeof raw.providerId !== "string" || !raw.providerId.trim()) {
    return null;
  }
  if (typeof raw.modelId !== "string" || !raw.modelId.trim()) {
    return null;
  }
  return { providerId: raw.providerId.trim(), modelId: raw.modelId.trim() };
}

/** 设置清洗：非白名单字段丢弃，非法值回落到 fallback（topK 夹到 1–8） */
function sanitizeSettings(
  value: unknown,
  fallback: ConversationMemorySettings = DEFAULT_CONVERSATION_MEMORY_SETTINGS,
): ConversationMemorySettings {
  const raw = (value && typeof value === "object" ? value : {}) as Partial<ConversationMemorySettings>;
  const model =
    raw.model === null
      ? null
      : raw.model === undefined
        ? fallback.model
        : sanitizeModelRef(raw.model) ?? fallback.model;
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : fallback.enabled,
    autoSummarize: typeof raw.autoSummarize === "boolean" ? raw.autoSummarize : fallback.autoSummarize,
    autoExtractFacts:
      typeof raw.autoExtractFacts === "boolean" ? raw.autoExtractFacts : fallback.autoExtractFacts,
    recall: typeof raw.recall === "boolean" ? raw.recall : fallback.recall,
    topK: raw.topK === undefined ? fallback.topK : clampTopK(raw.topK),
    model,
  };
}

interface SettingsFile {
  settings: ConversationMemorySettings;
  lastError: string;
}

async function readSettingsFile(): Promise<SettingsFile> {
  const parsed = await readJsonFile(settingsFile());
  const record = (parsed && typeof parsed === "object" ? parsed : {}) as {
    settings?: unknown;
    lastError?: unknown;
  };
  // 兼容直接把设置写在根上的旧/手写文件
  const raw = record.settings ?? parsed;
  return {
    settings: sanitizeSettings(raw),
    lastError: typeof record.lastError === "string" ? record.lastError : "",
  };
}

async function writeSettingsFile(file: SettingsFile): Promise<void> {
  await writeJsonAtomic(settingsFile(), file);
}

export async function readConversationSettings(): Promise<ConversationMemorySettings> {
  try {
    return (await readSettingsFile()).settings;
  } catch {
    return { ...DEFAULT_CONVERSATION_MEMORY_SETTINGS };
  }
}

/** 记下最近一次自动摘要/提取失败原因并广播（供设置页内联提示） */
export async function recordConversationMemoryError(message: string): Promise<void> {
  try {
    const current = await readSettingsFile();
    await writeSettingsFile({ settings: current.settings, lastError: message.slice(0, 300) });
    notifyChanged();
  } catch {
    // 记录失败原因本身失败：静默，不能反过来影响主流程
  }
}

async function readPersona(): Promise<string> {
  try {
    return (await readFile(personaFile(), "utf8")).slice(0, PERSONA_LIMIT);
  } catch {
    return "";
  }
}

export async function listConversationMemory(query?: unknown): Promise<ConversationMemoryList> {
  try {
    const [episodes, facts] = await Promise.all([readEpisodes(), readFacts()]);
    const keyword = typeof query === "string" ? query.trim().toLowerCase() : "";
    if (!keyword) {
      return { episodes, facts };
    }
    return {
      episodes: episodes.filter((item) =>
        `${item.title} ${item.summary} ${item.keywords.join(" ")}`.toLowerCase().includes(keyword),
      ),
      facts: facts.filter((item) => item.text.toLowerCase().includes(keyword)),
    };
  } catch {
    return { episodes: [], facts: [] };
  }
}

function statsOf(episodes: MemoryEpisode[], facts: MemoryFact[], personaChars: number): ConversationMemoryStats {
  return { episodes: episodes.length, facts: facts.length, personaChars };
}

export async function readConversationMemoryState(): Promise<ConversationMemoryState> {
  try {
    const [file, episodes, facts, persona] = await Promise.all([
      readSettingsFile(),
      readEpisodes(),
      readFacts(),
      readPersona(),
    ]);
    return {
      settings: file.settings,
      stats: statsOf(episodes, facts, persona.length),
      lastError: file.lastError,
    };
  } catch {
    return {
      settings: { ...DEFAULT_CONVERSATION_MEMORY_SETTINGS },
      stats: { episodes: 0, facts: 0, personaChars: 0 },
      lastError: "",
    };
  }
}

// ---------------------------------------------------------------------------
// 手动编辑：全部入参按 unknown 校验，非法值直接返回当前列表（不抛、不落盘）
// ---------------------------------------------------------------------------

export async function updateConversationEpisode(
  id: unknown,
  patch: unknown,
): Promise<ConversationMemoryList> {
  try {
    const episodes = await readEpisodes();
    if (typeof id !== "string" || !id) {
      return { episodes, facts: await readFacts() };
    }
    const target = episodes.find((item) => item.id === id);
    if (!target) {
      return { episodes, facts: await readFacts() };
    }
    const raw = (patch && typeof patch === "object" ? patch : {}) as Record<string, unknown>;
    let edited = target.edited;
    let changed = false;
    if (typeof raw["title"] === "string") {
      const title = raw["title"].trim().slice(0, TITLE_LIMIT);
      if (title && title !== target.title) {
        target.title = title;
        edited = true;
        changed = true;
      }
    }
    if (typeof raw["summary"] === "string") {
      const summary = raw["summary"].trim().slice(0, SUMMARY_LIMIT);
      if (summary && summary !== target.summary) {
        target.summary = summary;
        edited = true;
        changed = true;
      }
    }
    if (typeof raw["pinned"] === "boolean" && raw["pinned"] !== target.pinned) {
      target.pinned = raw["pinned"];
      changed = true;
    }
    if (!changed) {
      // 没有任何有效改动：不重排、不重写，直接返回当前列表
      return { episodes, facts: await readFacts() };
    }
    target.edited = edited;
    target.updatedAt = Date.now();
    const next = limitEpisodes(episodes);
    await writeJsonAtomic(episodesFile(), next);
    notifyChanged();
    return { episodes: next, facts: await readFacts() };
  } catch {
    return { episodes: [], facts: [] };
  }
}

export async function upsertConversationFact(input: unknown): Promise<ConversationMemoryList> {
  try {
    const facts = await readFacts();
    const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    const text = typeof raw["text"] === "string" ? raw["text"].trim().slice(0, FACT_TEXT_LIMIT) : "";
    if (!text || !isFactKind(raw["kind"])) {
      return { episodes: await readEpisodes(), facts };
    }
    const id = typeof raw["id"] === "string" ? raw["id"] : "";
    const existing = id ? facts.find((item) => item.id === id) : undefined;
    const now = Date.now();
    if (existing) {
      existing.text = text;
      existing.kind = raw["kind"];
      if (typeof raw["pinned"] === "boolean") {
        existing.pinned = raw["pinned"];
      }
      existing.updatedAt = now;
    } else {
      facts.push({
        id: id || randomUUID(),
        kind: raw["kind"],
        text,
        // 用户手写/粘贴的条目标记 user，自动提取的标记 auto（界面据此区分来源）
        source: "user",
        pinned: raw["pinned"] === true,
        createdAt: now,
        updatedAt: now,
      });
    }
    const next = limitFacts(facts);
    await writeJsonAtomic(factsFile(), next);
    notifyChanged();
    return { episodes: await readEpisodes(), facts: next };
  } catch {
    return { episodes: [], facts: [] };
  }
}

export async function removeConversationMemoryItem(
  kind: unknown,
  id: unknown,
): Promise<ConversationMemoryList> {
  try {
    const [episodes, facts] = await Promise.all([readEpisodes(), readFacts()]);
    if (typeof id !== "string" || !id || (kind !== "episode" && kind !== "fact")) {
      return { episodes, facts };
    }
    if (kind === "episode") {
      const next = episodes.filter((item) => item.id !== id);
      await writeJsonAtomic(episodesFile(), next);
      notifyChanged();
      return { episodes: next, facts };
    }
    const next = facts.filter((item) => item.id !== id);
    await writeJsonAtomic(factsFile(), next);
    notifyChanged();
    return { episodes, facts: next };
  } catch {
    return { episodes: [], facts: [] };
  }
}

export async function setConversationMemorySettings(
  patch: unknown,
): Promise<ConversationMemoryState> {
  try {
    const current = await readSettingsFile();
    const raw = (patch && typeof patch === "object" ? patch : {}) as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...current.settings };
    // 白名单：其它字段一律忽略
    for (const key of ["enabled", "autoSummarize", "autoExtractFacts", "recall", "topK", "model"]) {
      if (Object.prototype.hasOwnProperty.call(raw, key)) {
        merged[key] = raw[key];
      }
    }
    const next = sanitizeSettings(merged, current.settings);
    if (JSON.stringify(next) !== JSON.stringify(current.settings)) {
      await writeSettingsFile({ settings: next, lastError: current.lastError });
      notifyChanged();
    }
    const [episodes, facts, persona] = await Promise.all([readEpisodes(), readFacts(), readPersona()]);
    return { settings: next, stats: statsOf(episodes, facts, persona.length), lastError: current.lastError };
  } catch {
    return {
      settings: { ...DEFAULT_CONVERSATION_MEMORY_SETTINGS },
      stats: { episodes: 0, facts: 0, personaChars: 0 },
      lastError: "",
    };
  }
}

/** 用户档案 → 系统提示词块（空档案返回 undefined；超长截断，避免挤占上下文） */
export async function readPersonaBlock(): Promise<string | undefined> {
  const persona = (await readConversationPersona()).trim();
  if (!persona) {
    return undefined;
  }
  const clipped = persona.length > PERSONA_PROMPT_LIMIT
    ? `${persona.slice(0, PERSONA_PROMPT_LIMIT)}\n…（档案已截断）`
    : persona;
  return `用户档案（用户自己写的背景，回答时据此调整称呼与做法）：\n${clipped}`;
}

export async function readConversationPersona(): Promise<string> {
  return readPersona();
}

export async function setConversationPersona(text: unknown): Promise<{ ok: boolean }> {
  if (typeof text !== "string") {
    return { ok: false };
  }
  try {
    await writeTextAtomic(personaFile(), text.trim().slice(0, PERSONA_LIMIT));
    notifyChanged();
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// 会话摘要 + 事实提取（ingest）
// ---------------------------------------------------------------------------

const INGEST_SYSTEM_PROMPT = [
  "你是对话记忆提取器。阅读用户与助手的对话记录，产出一段会话摘要和关于用户的长期事实。",
  '只输出单个 JSON 对象：{"title":string,"summary":string,"keywords":string[],"facts":[{"kind":"identity|preference|project|goal|note","text":string}]}',
  "约束：title ≤ 30 字；summary ≤ 600 字，写清做了什么、结论与未决问题；keywords ≤ 8 个短词；facts ≤ 8 条，每条 ≤ 100 字。",
  "facts 只记录关于用户本人的长期信息（身份、偏好、项目、目标），不记录一次性任务细节，不编造，不重复临时状态。",
  "输出必须以 { 开头、以 } 结尾，是单个完整可直接解析的 JSON；禁止任何解释、前缀、Markdown 围栏，绝不截断。",
].join("");

/** 空消息 / 工具报错回显不算对话内容 */
function isErrorLikeMessage(content: string): boolean {
  return /^(错误|error|请求失败|运行失败|\[error\])[:：\s]/i.test(content.trim());
}

/** 过滤空消息与 error 消息，只留 user/assistant 正文 */
function cleanMessages(messages: unknown): MemoryIngestMessage[] {
  if (!Array.isArray(messages)) {
    return [];
  }
  const out: MemoryIngestMessage[] = [];
  for (const item of messages) {
    const message = item as Partial<MemoryIngestMessage> | null;
    if (!message || (message.role !== "user" && message.role !== "assistant")) {
      continue;
    }
    if (typeof message.content !== "string") {
      continue;
    }
    const content = message.content.trim();
    if (!content || isErrorLikeMessage(content)) {
      continue;
    }
    out.push({ role: message.role, content });
  }
  return out;
}

/** 括号配平截取第一段完整 JSON；未闭合（被输出预算截断）返回 null */
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

/** 解析模型输出：必须是单个完整 JSON 对象；截断/不可解析统一抛错（调用方不落盘） */
function parseIngestJson(raw: string): Record<string, unknown> {
  const text = raw.trim();
  const start = text.indexOf("{");
  if (start < 0) {
    throw new Error(
      `模型输出不是完整 JSON（收到 ${text.length} 字符，疑似被输出预算截断）。可重试一次，或换用非推理/轻量模型`,
    );
  }
  const slice = sliceBalancedJson(text, start);
  if (!slice) {
    throw new Error(
      `模型输出不是完整 JSON（收到 ${text.length} 字符，疑似被输出预算截断）。可重试一次，或换用非推理/轻量模型`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(slice);
  } catch {
    throw new Error("模型输出不是可解析的 JSON，请重试或换用其它模型");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("模型输出不是 JSON 对象，请重试或换用其它模型");
  }
  return parsed as Record<string, unknown>;
}

/** 对话正文：保留最近的内容，超长从尾部截断（新消息信息量更大） */
function transcriptOf(messages: MemoryIngestMessage[]): string {
  const lines = messages.map((message) => `[${message.role}] ${message.content}`);
  let text = lines.join("\n");
  if (text.length > INGEST_INPUT_CHARS) {
    text = `…（前文省略）\n${text.slice(-INGEST_INPUT_CHARS)}`;
  }
  return text;
}

/** 归一化：去空白/标点/大小写，用于判断「完全相同」 */
function normalizeFactText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

/** 最长公共子串长度（DP 单行滚动；两条事实都 ≤ 200 字，代价可忽略） */
export function longestCommonSubstringLength(a: string, b: string): number {
  if (!a || !b) {
    return 0;
  }
  let previous = new Array<number>(b.length + 1).fill(0);
  let current = new Array<number>(b.length + 1).fill(0);
  let best = 0;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const value = a[i - 1] === b[j - 1] ? (previous[j - 1] ?? 0) + 1 : 0;
      current[j] = value;
      if (value > best) {
        best = value;
      }
    }
    // 滚动数组：上一行换成当前行，旧行清零复用
    [previous, current] = [current, previous];
    current.fill(0);
  }
  return best;
}

/** 事实去重：归一化完全相同，或字符级重合度 ≥ 0.85（近似同义复述） */
export function isDuplicateFact(text: string, existing: MemoryFact[]): boolean {
  const normalized = normalizeFactText(text);
  if (!normalized) {
    return true;
  }
  return existing.some((fact) => {
    const other = normalizeFactText(fact.text);
    if (!other) {
      return false;
    }
    if (other === normalized) {
      return true;
    }
    const shorter = Math.min(normalized.length, other.length);
    if (shorter < 8) {
      // 太短的条目（如「用户叫 Ray」）不宜按重合度判定，避免误杀
      return false;
    }
    return longestCommonSubstringLength(normalized, other) / shorter >= FACT_DUPLICATE_RATIO;
  });
}

/** 摘要/提取用的模型：设置里显式指定 → 缺省用当前选择（= 会话模型），都没有才报错 */
async function resolveIngestModel(
  settings: ConversationMemorySettings,
): Promise<{ providerId: string; modelId: string } | null> {
  if (settings.model) {
    return settings.model;
  }
  try {
    const selection = await getSelection();
    if (selection.providerId && selection.modelId) {
      return { providerId: selection.providerId, modelId: selection.modelId };
    }
  } catch {
    // 读取当前模型失败按「未配置」处理
  }
  return null;
}

/** 手动 ingest 不知道 workspaceId 时的兜底记录（自动摘要会带上） */
const sessionWorkspaces = new Map<string, string>();

/**
 * 用一段会话生成摘要与事实。
 * - force: 忽略「太短」门槛，并允许在 autoExtractFacts 关闭时写入 facts（用户显式点了总结）
 * - 模型输出不可解析/被截断：返回 {ok:false}，且不写任何文件
 */
export async function ingestConversationMemory(
  sessionId: string,
  messages: unknown,
  options: { force?: boolean; workspaceId?: string } = {},
): Promise<MemoryIngestResult> {
  if (typeof sessionId !== "string" || !sessionId) {
    return { ok: false, error: "invalid sessionId", factsAdded: 0 };
  }
  const cleaned = cleanMessages(messages);
  const totalChars = cleaned.reduce((sum, message) => sum + message.content.length, 0);
  if (!options.force && (cleaned.length < INGEST_MIN_MESSAGES || totalChars < INGEST_MIN_CHARS)) {
    return { ok: false, skipped: "too-short", factsAdded: 0 };
  }
  if (!cleaned.length) {
    return { ok: false, skipped: "too-short", factsAdded: 0 };
  }
  const settings = await readConversationSettings();
  const model = await resolveIngestModel(settings);
  if (!model) {
    return { ok: false, error: "请先在记忆设置里选择模型", factsAdded: 0 };
  }

  const [episodes, facts] = await Promise.all([readEpisodes(), readFacts()]);
  const existing = episodes
    .filter((item) => item.sessionId === sessionId)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];

  const context: string[] = [];
  if (existing) {
    context.push(
      existing.edited
        ? `已有会话摘要（用户已手改，不要重写，仅用于理解上下文）：\n标题：${existing.title}\n摘要：${existing.summary}\n`
        : `已有会话摘要（可在此基础上补全）：\n标题：${existing.title}\n摘要：${existing.summary}\n`,
    );
  }
  const prompt = `${context.join("\n")}对话记录：\n${transcriptOf(cleaned)}`;

  let raw: string;
  try {
    raw = await completeOnce(prompt, {
      system: INGEST_SYSTEM_PROMPT,
      maxTokens: INGEST_MAX_TOKENS,
      // 摘要/提取是结构输出任务，降到最低推理档，避免思考吃掉输出预算后 JSON 被截断
      reasoningEffort: "lowest",
      timeoutMs: 180_000,
      providerId: model.providerId,
      modelId: model.modelId,
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      factsAdded: 0,
    };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parseIngestJson(raw);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      factsAdded: 0,
    };
  }

  const title = typeof parsed["title"] === "string" ? parsed["title"].trim().slice(0, TITLE_LIMIT) : "";
  const summary =
    typeof parsed["summary"] === "string" ? parsed["summary"].trim().slice(0, SUMMARY_LIMIT) : "";
  const keywords = normalizeKeywords(parsed["keywords"]);
  if (!title && !summary) {
    return { ok: true, episode: null, factsAdded: 0, skipped: "no-content" };
  }

  const now = Date.now();
  const workspaceId = options.workspaceId ?? sessionWorkspaces.get(sessionId) ?? "";
  let nextEpisodes = episodes;
  let episode: MemoryEpisode;
  if (existing) {
    episode = existing;
    if (!existing.edited) {
      // 用户没手改过：合并更新（摘要用新的，关键词为空时保留旧的）
      episode = {
        ...existing,
        title: title || existing.title,
        summary: summary || existing.summary,
        keywords: keywords.length ? keywords : existing.keywords,
        messageCount: cleaned.length,
        updatedAt: now,
      };
      nextEpisodes = episodes.map((item) => (item.id === existing.id ? episode : item));
    }
    // edited === true：用户改过摘要，只新增事实、不动摘要
  } else {
    episode = {
      id: randomUUID(),
      sessionId,
      workspaceId,
      title: title || summary.slice(0, 40),
      summary: summary || title,
      keywords,
      messageCount: cleaned.length,
      pinned: false,
      edited: false,
      createdAt: now,
      updatedAt: now,
    };
    nextEpisodes = [...episodes, episode];
  }

  const canWriteFacts = settings.autoExtractFacts || options.force === true;
  const rawFacts = Array.isArray(parsed["facts"]) ? parsed["facts"] : [];
  let nextFacts = facts;
  let factsAdded = 0;
  if (canWriteFacts) {
    for (const item of rawFacts) {
      const candidate = normalizeFact({
        ...(item && typeof item === "object" ? (item as Record<string, unknown>) : {}),
        id: randomUUID(),
        source: "auto",
        sessionId,
        createdAt: now,
        updatedAt: now,
      });
      if (!candidate || isDuplicateFact(candidate.text, nextFacts)) {
        continue;
      }
      nextFacts = [candidate, ...nextFacts];
      factsAdded += 1;
    }
    nextFacts = limitFacts(nextFacts);
  }

  const episodesChanged = nextEpisodes !== episodes;
  try {
    if (episodesChanged) {
      await writeJsonAtomic(episodesFile(), limitEpisodes(nextEpisodes));
    }
    if (factsAdded > 0) {
      await writeJsonAtomic(factsFile(), nextFacts);
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      factsAdded: 0,
    };
  }
  if (episodesChanged || factsAdded > 0) {
    notifyChanged();
  }
  if (existing && !episodesChanged) {
    return { ok: true, episode: existing, factsAdded };
  }
  return { ok: true, episode, factsAdded };
}

/** 自动摘要节流表：sessionId → 上次触发的 ms */
const autoIngestAt = new Map<string, number>();

/** 自动摘要：run 正常结束后后台调用；内部节流，任何失败只记 lastError，不影响聊天 */
export async function maybeAutoIngest(
  sessionId: string,
  workspaceId: string,
  messages: unknown,
): Promise<void> {
  try {
    if (typeof sessionId !== "string" || !sessionId) {
      return;
    }
    const settings = await readConversationSettings();
    if (!settings.enabled || !settings.autoSummarize) {
      return;
    }
    const list = Array.isArray(messages) ? messages : [];
    if (list.length < AUTO_INGEST_MIN_MESSAGES) {
      return;
    }
    const now = Date.now();
    if (now - (autoIngestAt.get(sessionId) ?? 0) < AUTO_INGEST_MIN_INTERVAL_MS) {
      return;
    }
    // 先占位再请求：并发/连续触发同一会话时只跑一次
    autoIngestAt.set(sessionId, now);
    if (workspaceId) {
      sessionWorkspaces.set(sessionId, workspaceId);
    }
    const result = await ingestConversationMemory(sessionId, list, {
      force: false,
      workspaceId,
    });
    if (!result.ok && !result.skipped) {
      await recordConversationMemoryError(result.error ?? "自动摘要失败");
    }
  } catch (error) {
    await recordConversationMemoryError(
      error instanceof Error ? error.message : String(error),
    );
  }
}

/** 仅测试用：清空自动摘要节流与 session→workspace 缓存 */
export function resetConversationMemoryRuntimeState(): void {
  autoIngestAt.clear();
  sessionWorkspaces.clear();
}

// ---------------------------------------------------------------------------
// 召回：纯本地词法打分（CJK 2-gram + 拉丁词），不引入向量依赖、不调模型
// ---------------------------------------------------------------------------

/** 词法切分：CJK 连续片段取 2-gram，拉丁/数字按词切（小写、≥2 字符） */
export function tokenizeForRecall(text: string): string[] {
  const lowered = typeof text === "string" ? text.toLowerCase() : "";
  const tokens = new Set<string>();
  for (const word of lowered.match(/[a-z0-9][a-z0-9+#._-]*/g) ?? []) {
    if (word.length >= 2) {
      tokens.add(word);
    }
  }
  for (const run of lowered.match(/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g) ?? []) {
    for (let index = 0; index + 1 < run.length; index += 1) {
      tokens.add(run.slice(index, index + 2));
    }
  }
  return [...tokens];
}

/** score = 命中词数 / sqrt(候选词数)，pinned 再加 0.5；0 命中不参与召回 */
function scoreTokens(queryTokens: string[], candidateText: string, pinned: boolean): number {
  const candidateTokens = new Set(tokenizeForRecall(candidateText));
  if (!candidateTokens.size) {
    return 0;
  }
  let hits = 0;
  for (const token of queryTokens) {
    if (candidateTokens.has(token)) {
      hits += 1;
    }
  }
  if (!hits) {
    return 0;
  }
  return hits / Math.sqrt(candidateTokens.size) + (pinned ? 0.5 : 0);
}

export async function recallConversationMemory(
  query: string,
  topK = DEFAULT_CONVERSATION_MEMORY_SETTINGS.topK,
): Promise<MemoryRecallHit[]> {
  const queryTokens = tokenizeForRecall(query);
  if (!queryTokens.length) {
    return [];
  }
  const limit = clampTopK(topK);
  const [episodes, facts] = await Promise.all([readEpisodes(), readFacts()]);
  const episodeHits: MemoryRecallHit[] = episodes
    .map((episode) => ({
      kind: "episode" as const,
      id: episode.id,
      title: episode.title || episode.summary.slice(0, 40),
      text: episode.summary,
      score: scoreTokens(
        queryTokens,
        `${episode.title} ${episode.summary} ${episode.keywords.join(" ")}`,
        episode.pinned,
      ),
    }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  const factHits: MemoryRecallHit[] = facts
    .map((fact) => ({
      kind: "fact" as const,
      id: fact.id,
      title: fact.kind,
      text: fact.text,
      score: scoreTokens(queryTokens, fact.text, fact.pinned),
    }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return [...episodeHits, ...factHits].sort((a, b) => b.score - a.score);
}

/**
 * 召回 → 注入系统提示词的文本块；总长 ≤ 1200 字。
 * recall 关闭或无命中返回 undefined（不注入）。
 */
export async function renderRecallBlock(
  settings: ConversationMemorySettings,
  query: string,
): Promise<string | undefined> {
  if (!settings?.enabled || !settings.recall) {
    return undefined;
  }
  const hits = await recallConversationMemory(query, clampTopK(settings.topK));
  if (!hits.length) {
    return undefined;
  }
  const lines: string[] = [];
  let used = 0;
  for (const hit of hits) {
    const line = (
      hit.kind === "episode"
        ? `- [对话记忆] ${hit.title}：${hit.text}`
        : `- [关于用户] ${hit.text}`
    ).replace(/\s+/g, " ");
    // used 记录已用字符数（含换行），保证 join("\n") 后总长不超过上限
    const nextUsed = used + (lines.length ? 1 : 0) + line.length;
    if (nextUsed > RECALL_BLOCK_LIMIT) {
      if (!lines.length) {
        lines.push(line.slice(0, RECALL_BLOCK_LIMIT));
      }
      break;
    }
    lines.push(line);
    used = nextUsed;
  }
  return lines.length ? lines.join("\n") : undefined;
}

// ---------------------------------------------------------------------------
// 导出 / 清空
// ---------------------------------------------------------------------------

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function toMarkdown(
  settings: ConversationMemorySettings,
  episodes: MemoryEpisode[],
  facts: MemoryFact[],
  persona: string,
): string {
  const lines: string[] = ["# 对话记忆导出", ""];
  lines.push(`导出时间：${new Date().toISOString()}`, "");
  lines.push("## 设置", "", "```json", JSON.stringify(settings, null, 2), "```", "");
  lines.push("## 用户档案", "", persona.trim() || "_（空）_", "");
  lines.push(`## 会话摘要（${episodes.length}）`, "");
  for (const episode of episodes) {
    lines.push(`### ${episode.pinned ? "📌 " : ""}${episode.title}`, "");
    lines.push(`- 会话：${episode.sessionId || "-"}${episode.edited ? "（已手改）" : ""}`);
    lines.push(`- 更新时间：${new Date(episode.updatedAt).toISOString()}`);
    if (episode.keywords.length) {
      lines.push(`- 关键词：${episode.keywords.join("、")}`);
    }
    lines.push("", episode.summary, "");
  }
  lines.push(`## 事实（${facts.length}）`, "");
  for (const fact of facts) {
    lines.push(
      `- ${fact.pinned ? "📌 " : ""}[${fact.kind}][${fact.source}] ${fact.text}`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

export async function exportConversationMemory(
  format: unknown,
): Promise<{ ok: boolean; path?: string; error?: string }> {
  if (format !== "json" && format !== "md") {
    return { ok: false, error: "invalid format" };
  }
  try {
    const [settings, episodes, facts, persona] = await Promise.all([
      readConversationSettings(),
      readEpisodes(),
      readFacts(),
      readPersona(),
    ]);
    const file = join(zenMemoryDir(), `export-${timestampSlug()}.${format}`);
    const text =
      format === "json"
        ? JSON.stringify({ exportedAt: Date.now(), settings, episodes, facts, persona }, null, 2)
        : toMarkdown(settings, episodes, facts, persona);
    await writeTextAtomic(file, text);
    return { ok: true, path: file };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** 清空会话摘要与事实（persona 与设备/习惯备注保留） */
export async function clearConversationMemory(): Promise<ConversationMemoryList> {
  try {
    await Promise.all([writeJsonAtomic(episodesFile(), []), writeJsonAtomic(factsFile(), [])]);
    notifyChanged();
    return { episodes: [], facts: [] };
  } catch {
    return listConversationMemory();
  }
}
