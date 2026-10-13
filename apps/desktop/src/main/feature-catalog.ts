import { ipcMain } from "electron";

import type { FeatureCatalogEntry, FeatureCatalogResult, FeatureStatus } from "@zen/shared";

/**
 * 可选能力目录（运行时分发，竞品 DimAgent 的 feature catalog）：
 * - 静态注册表声明目录条目；probe 按 probeKey 注册（abilities/ipc 接线四件套），
 *   缺省视为「未安装」；
 * - 可选能力模块（voice / ocr / cua 等）落地时调用 registerFeatureProbe
 *   注册自己的检测函数，目录即自动亮起，无需改这里；
 * - IPC：feature:list 返回目录 + probe 结果（平台过滤 + 可用状态）。
 */

type FeatureProbe = () => boolean | Promise<boolean>;

const probes = new Map<string, FeatureProbe>();

/** 可选能力模块注册安装状态检测（模块加载期调用一次；重复注册后者覆盖） */
export function registerFeatureProbe(probeKey: string, probe: FeatureProbe): void {
  if (probeKey) {
    probes.set(probeKey, probe);
  }
}

/**
 * 目录条目：与本机可选能力一一对应（probe 由 abilities/ipc 接线）。
 * name/description/usage 为兜底文案，渲染层优先走 i18n（features.*）。
 */
const FEATURE_CATALOG: FeatureCatalogEntry[] = [
  {
    id: "voice",
    name: "语音输入",
    description: "对话输入框语音转文字，支持长按说话与实时转写",
    usage: "输入框底部麦克风按钮：点击开始/停止录音，识别结果自动填入输入框",
    category: "input",
    platforms: [],
    probeKey: "voice",
  },
  {
    id: "tts",
    name: "语音播报",
    description: "把助手回复朗读出来，长回复可随时停止",
    usage: "助手消息气泡右下角的喇叭按钮：点击朗读 / 再次点击停止",
    category: "output",
    platforms: [],
    probeKey: "tts",
  },
  {
    id: "ocr",
    name: "屏幕文字识别",
    description: "截图与屏幕区域文字识别（OCR），识别结果直接进入对话",
    usage: "发送图片后，消息气泡附件上的「识别文字」按钮：识别结果插入输入框",
    category: "multimodal",
    platforms: [],
    probeKey: "ocr",
  },
  {
    id: "cua",
    name: "电脑操作（CUA）",
    description: "Agent 直接观察并操作屏幕上的应用（点击/输入/滚动）",
    usage: "设置 → 权限 → 桌面自动化开启后，对话里直接让 Agent 操作屏幕（高危能力，默认关闭）",
    category: "automation",
    platforms: [],
    probeKey: "cua",
  },
];

/** 单条目录探测：平台不符直接灰态（不跑 probe）；probe 未注册视为未安装 */
async function probeEntry(entry: FeatureCatalogEntry): Promise<FeatureStatus> {
  const platform = process.platform;
  const supported =
    entry.platforms.length === 0 || (entry.platforms as string[]).includes(platform);
  if (!supported) {
    return { ...entry, available: false, reason: "unsupported-platform" };
  }
  const probe = probes.get(entry.probeKey);
  if (!probe) {
    return { ...entry, available: false, reason: "not-installed" };
  }
  let available = false;
  try {
    available = await probe();
  } catch {
    available = false;
  }
  return { ...entry, available, ...(available ? {} : { reason: "not-installed" as const }) };
}

/** 全目录探测（feature:list 用；并发跑，单项失败不影响其余） */
export async function probeFeatures(): Promise<FeatureCatalogResult> {
  const entries = await Promise.all(FEATURE_CATALOG.map(probeEntry));
  return { ok: true, platform: process.platform as "darwin" | "win32" | "linux", entries };
}

export function registerFeatureCatalogIpc(): void {
  ipcMain.handle("feature:list", () => probeFeatures());
}
